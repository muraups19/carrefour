# Cartão Carrefour

Web app (mobile-first, estilo iOS 26) para controlar a fatura do cartão.
Os dados ficam numa **planilha do Google**, e cada alteração feita no site é gravada nela na hora.

```
GitHub Pages (index.html)  ──POST JSON──▶  Apps Script (API)  ──▶  Planilha do Google
```

## Estrutura

| Arquivo | O que é |
|---|---|
| `index.html` | O site inteiro (HTML + CSS + JS) |
| `config.js` | URL da API do Apps Script |
| `manifest.webmanifest`, `*.png` | Ícone e modo app na tela de início |
| `apps-script/Code.gs` | Backend. **Não roda no GitHub**: é colado no Apps Script da planilha |

## Configuração

### 1. API na planilha
1. Abra a planilha e vá em **Extensões → Apps Script**.
2. Cole o conteúdo de `apps-script/Code.gs` no arquivo `Código.gs`.
3. Em **⚙️ Configurações do projeto → Propriedades do script**, adicione a propriedade `TOKEN` com o valor do PIN (ex.: `4821`).
4. Vá em **Implantar → Nova implantação → App da Web**:
   - Executar como: **Eu**
   - Quem pode acessar: **Qualquer pessoa** (obrigatório para o GitHub Pages conseguir chamar a API; o PIN protege os dados)
5. Copie a URL que termina em `/exec`.

> Ao alterar o `Code.gs` depois: **Implantar → Gerenciar implantações → ✏️ → Versão: Nova versão**. Assim a URL continua a mesma.

### 2. Site no GitHub Pages
1. Cole a URL `/exec` em `config.js`.
2. Faça commit e push para o repositório.
3. Em **Settings → Pages**, escolha *Deploy from a branch* → `main` / `root`.
4. No iPhone, abra o link no Safari e toque em **Compartilhar → Adicionar à Tela de Início**.

Sem URL no `config.js`, o site abre em **modo demonstração**, com dados de exemplo.

## Funcionalidades
- **Lançamentos:** criar, editar, apagar (arrastar a linha para a esquerda → Editar / Apagar) e mover para outra fatura.
- **Confirmar:** toque no círculo, e isso marca a coluna Flag. Itens confirmados ficam fora do “A pagar”.
- **Novo mês:** toque no **+** no fim da lista de meses. A aba escolhida é copiada com a mesma formatação; itens mensais continuam, parcelas avançam (7/12 → 8/12) e parcelas quitadas ficam de fora.
- **Fechamento / vencimento** (⚙️): com os dias definidos, o site abre na fatura em aberto, mostra as datas de cada mês e escolhe a fatura certa pela **data da compra** (compras a partir do dia do fechamento vão para a fatura seguinte). Os dias ficam salvos nas propriedades do script (`FECHAMENTO`, `VENCIMENTO`).
- **Por pessoa:** soma por responsável, dividindo nomes como “Marcio e Rerusca” em partes iguais.

## Como a planilha é lida
- Cada aba é um mês, com o cabeçalho da tabela na **linha 3**.
- As colunas são encontradas pelo nome: `Reponsavel`, `Total de parcelas`, `Parcela atual`, `Descrição`, `Valor`, `Flag`.
- A tabela termina 2 linhas acima do cabeçalho `Valor total` (tabela por pessoa).
- **Flag marcada** = confirmado, e o item fica fora do valor “A pagar”. Se a aba não tem a coluna Flag, ela é criada na primeira confirmação.
- Uma compra parcelada nova pode ser replicada automaticamente nas abas dos meses seguintes.
- Nomes das abas: `NOVEMBRO` (sem ano) = ano anterior ao da primeira aba com ano (`JANEIRO 27` → abas sem ano são de 2026). Meses novos seguem o padrão `ABRIL 27`.

## Segurança
- O `config.js` é público, mas **o PIN não fica no repositório**. Ele é digitado no aparelho e guardado só no navegador.
- Use um repositório **privado** se não quiser expor a URL da API (GitHub Pages em repositório privado exige plano pago).
