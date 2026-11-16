/**
 * Cartão Carrefour — backend (Google Apps Script vinculado à planilha).
 * Cada aba = um mês. Cabeçalho da tabela de lançamentos na linha 3.
 * Colunas localizadas pelo NOME do cabeçalho, então a ordem não importa.
 */

const HEADER_ROW = 3;
const HEADERS = {
  resp:  ['reponsavel', 'responsavel'],
  total: ['total de parcelas'],
  atual: ['parcela atual'],
  desc:  ['descricao'],
  valor: ['valor'],
  flag:  ['flag', 'confirmado', 'pago']
};
const MESES = ['JANEIRO','FEVEREIRO','MARÇO','ABRIL','MAIO','JUNHO','JULHO','AGOSTO','SETEMBRO','OUTUBRO','NOVEMBRO','DEZEMBRO'];

/* ---------- API (chamada pelo site no GitHub Pages) ----------
 * O site faz POST com corpo JSON: { token, fn, args }.
 * O PIN fica em: Configurações do projeto → Propriedades do script → TOKEN
 */

const API = { getInitial: getInitial, getMonth: getMonth, setFlag: setFlag, saveEntry: saveEntry, deleteEntry: deleteEntry,
  createMonth: createMonth, saveSettings: saveSettings };

function doPost(e) {
  let out;
  try {
    const req = JSON.parse(e.postData.contents || '{}');
    const token = PropertiesService.getScriptProperties().getProperty('TOKEN');
    if (!token) throw new Error('Defina a propriedade TOKEN no Apps Script.');
    if (String(req.token) !== String(token)) { out = { ok: false, auth: true, error: 'PIN incorreto.' }; }
    else if (!API[req.fn]) { throw new Error('Função inválida: ' + req.fn); }
    else { out = { ok: true, data: API[req.fn].apply(null, req.args || []) }; }
  } catch (err) {
    out = { ok: false, error: err.message || String(err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return ContentService.createTextOutput(JSON.stringify({ ok: true, msg: 'API do Cartão Carrefour no ar.' }))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ---------- Leitura ---------- */

function getInitial() {
  const months = listMonths_();
  const current = guessCurrentMonth_(months);
  return { months: months, current: current, data: getMonth(current), people: knownPeople_(months), settings: getSettings_() };
}

/* ---------- Configurações (fechamento / vencimento) ---------- */

function getSettings_() {
  const p = PropertiesService.getScriptProperties();
  return { fechamento: Number(p.getProperty('FECHAMENTO')) || null, vencimento: Number(p.getProperty('VENCIMENTO')) || null };
}

function saveSettings(s) {
  const p = PropertiesService.getScriptProperties();
  ['fechamento', 'vencimento'].forEach(function (k) {
    const v = Math.round(Number(s && s[k]));
    if (v >= 1 && v <= 31) p.setProperty(k.toUpperCase(), String(v)); else p.deleteProperty(k.toUpperCase());
  });
  return getSettings_();
}

/* ---------- Novo mês ---------- */

function createMonth(name, from, carry) {
  return withLock_(function () {
    name = String(name || '').trim().toUpperCase();
    if (!name) throw new Error('Informe o nome do mês.');
    const ss = SpreadsheetApp.getActive();
    if (ss.getSheetByName(name)) throw new Error('Já existe uma aba "' + name + '".');
    const months = listMonths_();
    if (!months.length) throw new Error('Nenhuma aba de mês para usar como modelo.');
    const src = sheet_(from && months.indexOf(from) >= 0 ? from : months[months.length - 1]);

    // Mensais continuam; parcelas avançam 1; parcelas finalizadas ficam de fora
    const carried = carry ? getMonth(src.getName()).rows.map(nextEntry_).filter(Boolean) : [];

    const sh = src.copyTo(ss).setName(name);
    const last = sheet_(months[months.length - 1]);
    ss.setActiveSheet(sh);
    ss.moveActiveSheet(last.getIndex() + 1);

    const L = layout_(sh);
    // Título (linhas 1-2) com o nome do mês de origem → novo nome
    const srcName = src.getName(), srcBase = srcName.replace(/\s+\d{2,4}$/, '');
    const top = sh.getRange(1, 1, 2, L.lastCol), tv = top.getValues();
    tv.forEach(function (r, i) {
      r.forEach(function (v, j) {
        if (v !== '' && (norm_(v) === norm_(srcName) || norm_(v) === norm_(srcBase))) sh.getRange(i + 1, j + 1).setValue(name);
      });
    });
    // Limpa os lançamentos copiados
    for (let r = HEADER_ROW + 1; r <= L.endRow; r++) clearRow_(sh, L, r);
    carried.forEach(function (e) { writeEntry_(sh, L, freeRow_(sh, L), e); });

    return { months: listMonths_(), data: getMonth(name) };
  });
}

function nextEntry_(e) {
  const base = { resp: e.resp, desc: e.desc, valor: e.valor, flag: false };
  const total = Number(e.total), atual = Number(e.atual);
  if (!(total > 0)) { base.total = ''; base.atual = ''; return base; }   // mensal
  if (!(atual < total)) return null;                                     // última parcela já foi
  base.total = total; base.atual = atual + 1;
  return base;
}

function getMonth(name) {
  const sh = sheet_(name);
  const L = layout_(sh);
  const n = L.endRow - HEADER_ROW;
  const rows = [];
  if (n > 0) {
    const vals = sh.getRange(HEADER_ROW + 1, 1, n, L.lastCol).getValues();
    vals.forEach(function (r, i) {
      const e = rowToEntry_(r, L);
      if (e.resp || e.desc || e.valor !== '') {
        e.row = HEADER_ROW + 1 + i;
        rows.push(e);
      }
    });
  }
  return { name: name, hasFlag: !!L.flag, rows: rows };
}

/* ---------- Escrita (cada chamada grava na hora) ---------- */

function setFlag(month, row, value, check) {
  return withLock_(function () {
    const sh = sheet_(month);
    let L = layout_(sh);
    verify_(sh, L, row, check);
    if (!L.flag) L = addFlagColumn_(sh, L);
    sh.getRange(row, L.flag).setValue(!!value);
    return getMonth(month);
  });
}

function saveEntry(month, entry, check, target) {
  return withLock_(function () {
    const sh = sheet_(month);
    const L = layout_(sh);
    let row = entry.row;

    // Mover para outro mês: apaga aqui e cria lá
    if (row && target && target !== month) {
      verify_(sh, L, row, check);
      const sh2 = sheet_(target), L2 = layout_(sh2);
      writeEntry_(sh2, L2, freeRow_(sh2, L2), entry);
      clearRow_(sh, L, row);
      return getMonth(month);
    }

    if (row) {
      verify_(sh, L, row, check);
    } else {
      row = freeRow_(sh, L);
    }
    writeEntry_(sh, L, row, entry);

    // Compra parcelada nova: replica nos meses seguintes com a parcela incrementada
    if (!entry.row && entry.propagate) propagate_(month, entry);
    return getMonth(month);
  });
}

function deleteEntry(month, row, check) {
  return withLock_(function () {
    const sh = sheet_(month);
    const L = layout_(sh);
    verify_(sh, L, row, check);
    clearRow_(sh, L, row);
    return getMonth(month);
  });
}

/* ---------- Helpers ---------- */

function withLock_(fn) {
  const lock = LockService.getDocumentLock();
  lock.waitLock(20000);
  try { const r = fn(); SpreadsheetApp.flush(); return r; }
  finally { lock.releaseLock(); }
}

function norm_(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
}

function sheet_(name) {
  const sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh) throw new Error('Aba "' + name + '" não encontrada.');
  return sh;
}

function layout_(sh) {
  const lastCol = Math.max(sh.getLastColumn(), 1);
  const lastRow = Math.max(sh.getLastRow(), HEADER_ROW + 1);
  const head = sh.getRange(HEADER_ROW, 1, 1, lastCol).getValues()[0].map(norm_);
  const L = { lastCol: lastCol };
  Object.keys(HEADERS).forEach(function (k) {
    const i = head.findIndex(function (h) { return HEADERS[k].indexOf(h) >= 0; });
    L[k] = i >= 0 ? i + 1 : null;
  });
  if (!L.resp || !L.valor) return null;

  // Fim da tabela de lançamentos = 2 linhas acima do cabeçalho "Valor total" (tabela por pessoa)
  L.endRow = lastRow;
  const all = sh.getRange(HEADER_ROW + 1, 1, lastRow - HEADER_ROW, lastCol).getValues();
  for (let i = 0; i < all.length; i++) {
    if (all[i].some(function (v) { return norm_(v) === 'valor total'; })) {
      L.endRow = HEADER_ROW + i - 1; // linha do nome da tabela fica entre as duas
      break;
    }
  }
  return L;
}

function listMonths_() {
  return SpreadsheetApp.getActive().getSheets()
    .filter(function (sh) { return layout_(sh); })
    .map(function (sh) { return sh.getName(); });
}

function guessCurrentMonth_(months) {
  const d = new Date();
  const base = MESES[d.getMonth()];
  const yy = String(d.getFullYear()).slice(-2);
  const up = months.map(function (m) { return m.toUpperCase(); });
  let i = up.indexOf(base + ' ' + yy);
  if (i < 0) i = up.indexOf(base);
  return months[i >= 0 ? i : months.length - 1];
}

function knownPeople_(months) {
  const set = {};
  months.forEach(function (m) {
    const sh = sheet_(m), L = layout_(sh);
    const n = L.endRow - HEADER_ROW;
    if (n <= 0) return;
    sh.getRange(HEADER_ROW + 1, L.resp, n, 1).getValues().forEach(function (r) {
      String(r[0]).split(/\s+e\s+|\s*&\s*|\s*,\s*/i).forEach(function (p) {
        p = String(p).trim();
        if (p && /[a-zà-ú]/i.test(p) && !set[norm_(p)]) set[norm_(p)] = p;
      });
    });
  });
  return Object.keys(set).map(function (k) { return set[k]; });
}

function rowToEntry_(r, L) {
  const g = function (k) { return L[k] ? r[L[k] - 1] : ''; };
  const v = g('valor');
  return {
    flag: g('flag') === true,
    resp: String(g('resp')).trim(),
    total: g('total') === '' ? '' : String(g('total')),
    atual: g('atual') === '' ? '' : String(g('atual')),
    desc: String(g('desc')).trim(),
    valor: typeof v === 'number' ? v : (v === '' ? '' : Number(String(v).replace(',', '.')) || 0)
  };
}

function verify_(sh, L, row, check) {
  if (!check) return;
  const e = rowToEntry_(sh.getRange(row, 1, 1, L.lastCol).getValues()[0], L);
  const same = norm_(e.resp) === norm_(check.resp) && norm_(e.desc) === norm_(check.desc) &&
    Math.abs((Number(e.valor) || 0) - (Number(check.valor) || 0)) < 0.005;
  if (!same) throw new Error('A planilha foi alterada em outro lugar. Recarregue e tente de novo.');
}

function freeRow_(sh, L) {
  const n = L.endRow - HEADER_ROW;
  if (n > 0) {
    const vals = sh.getRange(HEADER_ROW + 1, 1, n, L.lastCol).getValues();
    for (let i = 0; i < n; i++) {
      const e = rowToEntry_(vals[i], L);
      if (!e.resp && !e.desc && e.valor === '') return HEADER_ROW + 1 + i;
    }
  }
  // Tabela cheia: insere uma linha DENTRO da tabela (antes da última) para ela crescer
  const at = Math.max(L.endRow, HEADER_ROW + 1);
  sh.insertRowBefore(at);
  if (L.flag) sh.getRange(at, L.flag).insertCheckboxes();
  return at;
}

function clearRow_(sh, L, row) {
  ['resp', 'total', 'atual', 'desc', 'valor'].forEach(function (k) {
    if (L[k]) sh.getRange(row, L[k]).clearContent();
  });
  if (L.flag) sh.getRange(row, L.flag).setValue(false);
}

function writeEntry_(sh, L, row, e) {
  const parcelado = Number(e.total) > 0;
  const set = function (k, v) { if (L[k]) sh.getRange(row, L[k]).setValue(v); };
  set('resp', e.resp);
  set('desc', e.desc);
  set('valor', Number(e.valor) || 0);
  set('total', parcelado ? Number(e.total) : '-');
  set('atual', parcelado ? Number(e.atual) || 1 : '-');
  if (L.flag && e.flag !== undefined) sh.getRange(row, L.flag).setValue(!!e.flag);
}

function addFlagColumn_(sh, L) {
  // Insere ANTES da coluna Valor (dentro da tabela, assim ela cresce sem afetar a tabela por pessoa)
  sh.insertColumnBefore(L.valor);
  const col = L.valor;
  sh.getRange(HEADER_ROW, col).setValue('Flag');
  const n = L.endRow - HEADER_ROW;
  if (n > 0) sh.getRange(HEADER_ROW + 1, col, n, 1).insertCheckboxes();
  return layout_(sh);
}

function propagate_(month, e) {
  const total = Number(e.total), atual = Number(e.atual) || 1;
  if (!(total > atual)) return;
  const months = listMonths_();
  let idx = months.indexOf(month);
  for (let p = atual + 1; p <= total; p++) {
    idx++;
    if (idx >= months.length) break;
    const sh = sheet_(months[idx]);
    const L = layout_(sh);
    const row = freeRow_(sh, L);
    writeEntry_(sh, L, row, { resp: e.resp, desc: e.desc, valor: e.valor, total: total, atual: p, flag: false });
  }
}
