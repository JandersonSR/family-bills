# Contas da Família

App web (PWA) para acompanhar **o dinheiro enviado**, **as contas pagas** e **o saldo** (positivo ou negativo) do mês e do ano, com comprovantes anexados. Até 4 pessoas compartilham os mesmos registros. Feito para ser fácil para pessoas idosas: letras grandes, botões grandes, perguntas de "Sim/Não" e confirmação depois de cada ação.

## O que tem

- **Tela do mês:** enviado, pago, sobrou/faltou, saldo total, contas atrasadas e resumo do ano.
- **Contas do mês:** as contas de todo mês (luz, água, aluguel…) aparecem numa lista com vencimento. Para dar baixa, é só tocar em **Paguei** (o valor já vem preenchido).
- **"Incluir no orçamento do mês?"** (padrão: Sim). Uma conta marcada "Não" fica registrada, mas não entra no saldo (ex.: paga com outro dinheiro).
- **Relatório mensal:**
  - arquivo **Word** com os comprovantes, que vai direto para o **WhatsApp**
  - **resumo em texto** para o WhatsApp
  - versão para **imprimir** ou salvar em PDF
  - seção dos **últimos 6 meses** com o valor total faltante para depósito
  - opção de incluir as contas fora do orçamento (padrão: não)
- **Ajudas para quem tem dificuldade com tecnologia:**
  - tamanho da letra ajustável (A / A+ / A++)
  - aviso "✓ Salvo!" depois de cada ação
  - alerta quando algo parece já ter sido registrado
  - botão ✕ para apagar o valor digitado
  - aviso antes de o mês mais antigo ser apagado

- **Frontend:** React 19 + TypeScript + Vite. Instalável no celular (PWA), sem biblioteca de UI e sem roteador externo.
- **Backend:** Supabase: Auth (e-mail e senha), Postgres com RLS, Storage privado, Edge Function e pg_cron.

## Como funciona

| Conceito | Regra |
|---|---|
| **Grupo** | É a "sessão compartilhada". Quem cria o grupo é o administrador e convida pelo e-mail. O limite é de **4 pessoas**, contando os convites pendentes, e vale também no banco. |
| **Registro** | Pode ser um **Dinheiro enviado** (entrada) ou uma **Conta** (saída). Uma conta pode estar "Já foi paga" ou "Ainda vou pagar". |
| **Saldo do mês** | Enviado − pago no mês. |
| **Saldo total** | Saldo dos meses anteriores + saldo do mês. É o dinheiro enviado que ainda não foi usado, ou quanto falta repor. |
| **Saldo previsto** | Saldo total − contas "a pagar" do mês. |
| **Saldo do ano** | Soma de janeiro até o mês selecionado. A tela "Resumo do ano" mostra mês a mês. |
| **Contas de todo mês** | Ficam cadastradas (nunca são apagadas) e aparecem mês a mês para dar baixa. Cada conta só pode ter **uma baixa por mês**, garantido no banco: se duas pessoas tocarem em "Paguei", só a primeira vale. Uma conta paga atrasada (a de agosto paga em setembro) conta para agosto na lista e sai do saldo de setembro, que é quando o dinheiro saiu. |
| **Fora do orçamento** | O pagamento fica registrado, mas não entra em "Contas pagas" nem no saldo. No relatório, só aparece se a opção for marcada. |
| **Retenção** | Os registros e comprovantes ficam por **6 meses** (o mês atual + os 5 anteriores). Depois disso são apagados todo dia às 03:00 de Brasília. |
| **Totais preservados** | A tabela `resumos_mensais` é mantida por trigger e **não é apagada**. Por isso o saldo total e o do ano continuam corretos depois da limpeza. |

A data que conta é a **data do registro** (pagamento, envio ou vencimento), não a data em que ele foi criado. Um boleto de março lançado hoje sai junto com março.

## Estrutura

```
supabase/
  migrations/20260924000000_inicial.sql  ← tabelas, triggers, RPCs, RLS, bucket
  migrations/20260925000000_contas_fixas_orcamento.sql ← contas de todo mês + orçamento
  functions/limpeza/index.ts             ← Edge Function da limpeza diária
  agendamento.sql                        ← pg_cron que chama a função (rodar 1x)
  tests/                                 ← testes do SQL em Postgres puro (52 casos)
src/
  lib/          supabase, datas, dinheiro, resumo, dados (painel do mês e contas em aberto),
                relatorio (dados + texto WhatsApp + comprovantes), relatorioDocx (Word),
                aviso ("Salvo!"), preferencias (tamanho da letra), arquivo, rotas
  contexto/     sessão (Auth) e grupo atual
  paginas/      Entrar, CriarConta, EsqueciSenha, NovaSenha, BoasVindas,
                Mes (tela principal), Registro (criar/editar/dar baixa), ContasFixas,
                Relatorio, Ano, Grupo
public/         manifest, service worker, ícones
```

## Passo a passo para colocar no ar

### 1. Supabase

1. Crie um projeto em [supabase.com](https://supabase.com). O plano gratuito é suficiente.
2. Rode as migrações **na ordem**, por um destes caminhos:
   - **SQL Editor:** cole e execute `supabase/migrations/20260924000000_inicial.sql` e depois `20260925000000_contas_fixas_orcamento.sql`.
   - **CLI:** `supabase link --project-ref SEU_REF` e depois `supabase db push`.
3. Em **Authentication → URL Configuration**:
   - **Site URL:** o endereço onde o app vai ficar (ex.: `https://contas.seudominio.com.br/`)
   - **Redirect URLs:** o mesmo endereço, e também `http://localhost:5173/` para desenvolvimento.
4. (Recomendado) Em **Authentication → Email Templates**, traduza os e-mails de confirmação e de recuperação de senha para português.
5. (Recomendado) O e-mail padrão do Supabase tem limite baixo de envios por hora. Para uso real, configure um SMTP em **Authentication → SMTP Settings** (Resend, Brevo etc.).

### 2. Limpeza automática (6 meses)

```bash
supabase functions deploy limpeza --no-verify-jwt
supabase secrets set LIMPEZA_SECRET="$(openssl rand -hex 32)"
# opcional: outro período de retenção
# supabase secrets set MESES_RETENCAO=6
```

Depois abra `supabase/agendamento.sql`, troque a URL do projeto e o segredo (o mesmo valor de `LIMPEZA_SECRET`) e rode no SQL Editor.

Para testar na hora:

```bash
curl -X POST https://SEU_REF.supabase.co/functions/v1/limpeza -H "x-limpeza-secret: SEU_SEGREDO"
```

> A função apaga os arquivos pelo Storage API. Apagar direto em `storage.objects` via SQL deixaria os arquivos órfãos, e o Supabase bloqueia isso.

Se mudar o `MESES_RETENCAO`, ajuste também `MESES_RETENCAO` em `src/lib/datas.ts`. Ela só controla o aviso "os registros deste mês já foram apagados".

### 3. Rodar o app

```bash
cp .env.example .env     # preencha a URL e a chave publishable/anon
npm install
npm run dev              # http://localhost:5173
npm run build            # gera dist/
```

### 4. Hospedar

O app usa roteamento por hash (`#/ano`, `#/grupo`) e caminhos relativos. Por isso funciona em qualquer hospedagem estática, sem configurar redirecionamentos:

- **Vercel / Netlify:** importe o repositório. Build `npm run build`, pasta de saída `dist`, e as variáveis `VITE_SUPABASE_URL` e `VITE_SUPABASE_KEY`.
- **HostGator (cPanel):** rode `npm run build` e envie o conteúdo de `dist/` para `public_html/` (ou uma subpasta). É **necessário HTTPS** para instalar como app e para o `crypto.randomUUID`.

### 5. Primeiro uso

1. Você cria sua conta e o grupo ("Contas da Mãe").
2. Na engrenagem ⚙︎, convide o e-mail da sua mãe (e de até mais 2 pessoas).
3. Ela cria a conta **com o mesmo e-mail**, confirma pelo link e, ao entrar, toca em **Aceitar**.
4. No celular dela: abra o site → menu do navegador → **Adicionar à tela inicial**.

## Segurança

- **RLS em todas as tabelas.** Cada pessoa só lê e escreve nos grupos de que participa. Resumos são somente leitura (só a trigger escreve).
- **Comprovantes em bucket privado.** O acesso é por URL assinada de 10 minutos, e as políticas checam o grupo pelo caminho `<grupo_id>/...`.
- **Grupo e convites só mudam por RPCs** (`security definer`) que validam permissão e limite.
- **A limpeza só roda com `service_role`**, via Edge Function protegida por segredo.
- **Uploads:** fotos são reduzidas no aparelho (máx. 1600px, JPEG 80%). O bucket aceita até 5 MB, em JPG, PNG, WEBP, HEIC ou PDF.

## Testes

```bash
# SQL: sobe a migração num Postgres local com um stub de auth/storage
PGHOST=localhost PGPORT=5432 PGUSER=postgres ./supabase/tests/rodar.sh
```

Os testes cobrem: perfil criado no cadastro, limite de 4 (convites e membros), convite só para o e-mail certo, isolamento entre grupos (tabelas e arquivos), resumo ao criar/editar/pagar/apagar, depósito nunca pendente, limpeza que preserva totais e retorna os arquivos, e exclusão de conta ou grupo.

## Relatório: detalhes

- **Word (.docx):** é montado no próprio celular. Ao tocar em "Enviar pelo WhatsApp", abre a tela de compartilhar do aparelho. Se o navegador não permitir compartilhar arquivo, ele baixa o arquivo e explica como anexar no WhatsApp.
- **Comprovantes em PDF** não viram imagem dentro do Word: aparecem como "(comprovante em PDF)". Fotos (JPG, PNG) entram normalmente.
- **Últimos 6 meses:** vai do mês mais antigo guardado até o mês atual. Mostra enviado, pago e saldo de cada mês, os totais, quantos meses fecharam no positivo e no negativo, o saldo de antes desse período, o saldo total de hoje, as contas em aberto, o **valor total faltante para depósito** e quanto depositar para pagar também as contas em aberto.

## Próximos passos sugeridos

- **Lembrete de vencimento:** avisar 2 dias antes por e-mail ou notificação. No iPhone, a notificação só funciona com o app instalado na tela inicial.
- **Leitura automática de comprovante com IA:** a foto vira valor e data, e a pessoa só confere.
- **Converter comprovantes em PDF para imagem** no envio, para aparecerem dentro do relatório.
- **Atualização em tempo real** (Supabase Realtime) quando duas pessoas estão com o app aberto.
- **Excluir a própria conta** direto no app (LGPD). Hoje isso é feito pelo painel do Supabase.
