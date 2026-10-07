# Publicar o LearnUp de graça no Render

Guia passo a passo. Leia a coluna **Você** e a coluna **Como conferir**.

O site roda em três peças, todas no plano gratuito do Render:

| Peça | O que é | Plano |
|---|---|---|
| **Vitrine** (frontend) | Só as telas que o visitante vê | Static Site (grátis, não dorme) |
| **Cérebro** (API) | Login, compra, matrícula | Web Service Docker (grátis, dorme após 15 min sem visitas) |
| **Caderno** (banco) | Guarda alunos, pedidos, cursos | Render Postgres (grátis, 1 GB) |

> Enquanto estiver assim, os pagamentos são **simulados** e o site mostra o aviso
> "Ambiente de demonstração". Ninguém é cobrado.

---

## 1. Criar as contas

- Conta no **GitHub** (grátis) — guarda o código.
- Conta no **Render** (grátis, entrar com o GitHub) — hospeda o site.

Não precisa de cartão de crédito nesta fase.

---

## 2. Enviar o código para o GitHub

O repositório de destino é `https://github.com/ismael319/LearnUp`.

```powershell
cd "$HOME\OneDrive\Desktop\LearnUp"
git remote set-url origin https://github.com/ismael319/LearnUp.git
git push -u origin main
```

Se pedir login, use um **Personal Access Token** do GitHub (Settings → Developer
settings → Tokens) como senha.

---

## 3. Criar o banco de dados

No painel do Render: **New → Postgres**.

- Name: `learnup-db`
- Region: a mesma que você usará nos outros dois (ex.: Ohio)
- Plan: `Free`

Depois de criado, abra o banco e copie a **Internal Database URL**.

---

## 4. Criar o Cérebro (API)

**New → Web Service** → escolha o repositório `LearnUp`.

- Name: `learnup-api` (vira `https://learnup-api.onrender.com`)
- Language: **Docker**
- Dockerfile Path: `backend/Dockerfile`
- Docker Context Directory: `backend`
- Region: **a mesma do banco**
- Instance Type: `Free`
- Health Check Path: `/health`
- Start Command: `sh -c "node src/db/migrate.js up && node src/server.js"`

> NÃO defina `PORT`. O Render injeta essa variável sozinho e a API já a usa.

### Variáveis de ambiente (Environment → Add Environment Variable)

| Chave | Valor |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | a **Internal Database URL** do passo 3 |
| `PGSSL` | `false` |
| `JWT_SECRET` | veja `deploy-secrets.local.txt` (linha `JWT_SECRET=`) |
| `JWT_REFRESH_SECRET` | veja `deploy-secrets.local.txt` (linha `JWT_REFRESH_SECRET=`) |
| `COOKIE_SECURE` | `true` |
| `TRUST_PROXY` | `true` |
| `CORS_ORIGIN` | o endereço da Vitrine (preencha após o passo 5) |
| `PAYMENT_PROVIDER` | `mock` |

> **Nunca** coloque esse arquivo `deploy-secrets.local.txt` no GitHub. Ele já está
> no `.gitignore`.

Clique em **Create Web Service**. Ao final, abra
`https://learnup-api.onrender.com/health` — deve responder
`{"status":"ok","database":"up",...}`.

---

## 5. Criar a Vitrine (site)

**New → Static Site** → mesmo repositório.

- Name: `learnup` (vira `https://learnup.onrender.com`)
- Root Directory: `frontend`
- Build Command: `npm ci && npm run build`
- Publish Directory: `dist`
- Environment Variable: `VITE_API_URL` = `https://learnup-api.onrender.com/api/v1`

Depois de publicado, volte no Cérebro (passo 4) e ajuste
`CORS_ORIGIN` para o endereço da Vitrine (ex.: `https://learnup.onrender.com`).
O Render reinicia a API sozinho.

---

## 6. Primeiro acesso e conta de administrador

O banco nasce só com as tabelas. Para criar o administrador, no Render abra o
Cérebro → **Shell** e rode:

```bash
node src/db/seed.js --clean
```

Isso cria **apenas** o admin e o instrutor de exemplo (sem alunos falsos).
A senha inicial dos dois é `learnup123`.

Entre em `https://learnup.onrender.com`, faça login com
`admin@learnup.dev` / `learnup123` e **troque a senha imediatamente** em
**Minha conta → Perfil → Alterar senha**.

---

## 7. Quando quiser cobrar de verdade

1. No Render, mude o plano do Cérebro de **Free** para pago (US$ 7/mês) para ele
   parar de dormir.
2. Crie a conta no **Mercado Pago** e gere as credenciais do aplicativo.
3. Troque as variáveis do Cérebro:
   - `PAYMENT_PROVIDER` = `mercadopago`
   - `MERCADOPAGO_ACCESS_TOKEN` = token de produção
   - `MERCADOPAGO_WEBHOOK_SECRET` = assinatura secreta
4. No painel do Mercado Pago, cadastre o webhook:
   `https://learnup-api.onrender.com/api/v1/payments/webhook/mercadopago`
5. No painel do admin do LearnUp, desligue **Modo demonstração** em Ajustes.
6. Faça uma compra de teste de R$ 1 e confirme que a matrícula é liberada.

---

## Problemas comuns

| Sintoma | Causa | Solução |
|---|---|---|
| O primeiro acesso demora ~1 min | O plano grátis dorme | Esperar. No plano pago não acontece |
| `Configuração inválida (.env)` no log | Faltou `JWT_*` ou `COOKIE_SECURE=true` | Revisar as variáveis do passo 4 |
| Erro de conexão/SSL com o banco | URL externa + `PGSSL=false` | Use a **Internal Database URL** ou mude `PGSSL` para `true` |
| Site abre mas as telas dão erro | `CORS_ORIGIN` ou `VITE_API_URL` errados | Conferir os endereços do passo 5 |
| `route_not_found` ao abrir `/api/v1` | É só o prefixo, sem rota | Normal. O site é a Vitrine, não a API |
