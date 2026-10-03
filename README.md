# LearnUp

Plataforma de cursos online completa: API REST em Node/Express + PostgreSQL e SPA em React.

Do catálogo à conclusão: matrícula, player com progresso salvo, quizzes corrigidos no servidor,
pontuação, badges, fórum, certificados em PDF e verificação pública por código.

---

## Sumário

- [Stack](#stack)
- [Estrutura](#estrutura)
- [Como rodar](#como-rodar)
  - [1. Instalar o PostgreSQL (uma vez, no Windows)](#1-instalar-o-postgresql-uma-vez-no-windows)
  - [2. Instalar e rodar o projeto](#2-instalar-e-rodar-o-projeto)
  - [3. Opção: subir tudo em containers (Docker)](#3-opção-subir-tudo-em-containers-docker)
- [Contas de demonstração](#contas-de-demonstração)
- [Painel administrativo](#painel-administrativo)
- [Pagamentos](#pagamentos)
- [Endpoints principais](#endpoints-principais)
- [Testes](#testes)
- [Variáveis de ambiente](#variáveis-de-ambiente)
- [Decisões técnicas](#decisões-técnicas)
- [Limitações conhecidas](#limitações-conhecidas)

---

## Stack

| Camada | Tecnologia |
| --- | --- |
| API | Node.js 22+, Express 4 |
| Banco | PostgreSQL 16 (com `pgcrypto`, `citext`, `unaccent`) |
| Autenticação | JWT (access) + refresh token opaco com rotação, bcrypt |
| Validação | Zod |
| Pagamentos | Provider `mock` (padrão), Stripe, Mercado Pago |
| Frontend | React 18, Vite 5, React Router 6, CSS puro |
| PDF | PDFKit (certificados) |
| Testes | `node:test` (E2E contra a API real) |

---

## Estrutura

```
learnup/
├── docker-compose.yml         # PostgreSQL + API + nginx
├── backend/
│   ├── Dockerfile
│   ├── .env.example
│   └── src/
│       ├── server.js          # bootstrap
│       ├── app.js             # middlewares e rotas
│       ├── config/            # env e pool do Postgres
│       ├── db/
│       │   ├── migrations/    # 001_init, 002_view_types, 003_search_unaccent,
│       │   │                  # 004_course_progress_empty_courses,
│       │   │                  # 005_course_status_in_review,
│       │   │                  # 006_admin_governance, 007_moderate_comments,
│       │   │                  # 008_moderation_reason,
│       │   │                  # 009_certificate_revoked_reason
│       │   ├── migrate.js     # runner (up/down/status/reset)
│       │   └── seed.js        # dados de demonstração
│       ├── middleware/        # auth, validate, errorHandler, pagination
│       ├── services/          # regras de negócio
│       └── modules/           # auth, courses, enrollments, certificates,
│                              # quizzes, forum, gamification, payments, admin,
│                              # health
└── frontend/
    ├── Dockerfile + nginx.conf
    └── src/
        ├── api/               # cliente HTTP + download autenticado
        ├── components/        # header, footer, cards, alerts, feedback
        │   └── admin/         # AdminLayout, DataTable, ConfirmDialog, ui
        ├── context/           # AuthContext (sessão e revalidação)
        ├── hooks/             # useApi, useSubmit, useDebounced
        ├── pages/             # home, catálogo, curso, checkout, player,
        │                      # conta, fórum, ranking, verificação, 404
        │   └── admin/         # as 10 telas do painel + página 404 do admin
        ├── styles/global.css  # design tokens + responsividade
        └── utils/format.js    # moeda, data, duração
```

---

## Como rodar

Você só precisa de duas coisas instaladas: **Node.js 20+** e **PostgreSQL 14+**.
O banco roda **direto no seu Windows**, sem Docker.

> **Resumo:** instale o PostgreSQL uma vez, crie o usuário e os dois bancos,
> e na pasta `LearnUp` rode `npm run instalar` e depois `npm run dev`.

### 1. Instalar o PostgreSQL (uma vez, no Windows)

1. Baixe o instalador do PostgreSQL 16 em
   <https://www.postgresql.org/download/windows/> e execute.
2. Na tela de componentes, marque **Command Line Tools** para o `psql`
   ficar disponível no terminal.
3. Mantenha a **porta 5432** e anote a senha do superusuário `postgres`.
4. Ao terminar, o Windows já registra o banco como serviço e ele **liga
   sozinho** com o computador.

#### Criar o usuário e os dois bancos

Abra o **SQL Shell do PostgreSQL** (menu Iniciar) e rode:

```sql
CREATE ROLE learnup LOGIN CREATEDB PASSWORD 'learnup';
CREATE DATABASE learnup      OWNER learnup ENCODING 'UTF8';
CREATE DATABASE learnup_test OWNER learnup ENCODING 'UTF8';
```

O banco `learnup` é o da aplicação; o `learnup_test` é o que a suíte de
testes usa (está em `backend/.env.test`).

#### Se o Windows bloquear o psql (Smart App Control)

Alguns Windows 11 com **Smart App Control** ligado bloqueiam a `libpq.dll`
do PostgreSQL porque ela não vem assinada digitalmente. O sintoma é o
comando `psql`/`initdb` não abrir, ou o serviço do banco não iniciar.

Duas formas de resolver:

**a) Desligar o Smart App Control** (o Windows reinicia):
*Configurações → Segurança do Windows → Segurança do Windows →
Controle de Aplicativos e Navegador → Controle de Aplicativos →
Avaliação de Aplicativos → Smart App Control*.

**b) Assinar a `libpq.dll` com um certificado local.** Abra o PowerShell
**como administrador** e rode (ajuste o caminho se o PostgreSQL estiver em
outro lugar):

```powershell
$bin = "C:\Program Files\PostgreSQL\16\bin"
$cert = New-SelfSignedCertificate -Type CodeSigningCert `
  -Subject "CN=LearnUp" -CertStoreLocation Cert:\CurrentUser\My `
  -KeyUsage DigitalSignature -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.3")
Get-ChildItem $bin -Filter *.dll | ForEach-Object {
  Set-AuthenticodeSignature $_.FullName -Certificate $cert | Out-Null }
Restart-Service postgresql-x64-16
```

Vale saber: a API usa a biblioteca `pg`, que é JavaScript puro e **não**
depende da `libpq.dll`. Se a API subir e o site funcionar, mesmo com os
comandos do PostgreSQL quebrados, o projeto está pronto para usar.

### 2. Instalar e rodar o projeto

Tudo acontece na pasta `LearnUp`, com dois comandos:

```bash
npm run instalar     # instala dependências, cria as tabelas e popula com dados de exemplo
npm run dev          # liga a API e o site juntos (Ctrl+C para parar)
```

Abra **http://localhost:5173**. A API responde em http://localhost:4000
e o health check em http://localhost:4000/health.

O que os comandos fazem por baixo:

```bash
npm install --prefix backend     # dependências da API
npm install --prefix frontend    # dependências do site
npm run db:reset --prefix backend   # migrations + seed
```

Se algo estiver errado, `npm run conferir` aponta exatamente o que falta
e o comando para resolver.

### 3. Opção: subir tudo em containers (Docker)

Só para quem quiser o projeto inteiro em container. Não é preciso para
desenvolver.

```bash
cp .env.example .env             # defina os dois segredos JWT obrigatórios
docker compose up -d --build

# cria o schema e popula com dados de demonstração
docker compose exec api npm run migrate
docker compose exec api npm run seed
```

Para desligar:

```bash
docker compose down          # mantém o banco
docker compose down -v       # apaga também o volume do Postgres
```

### Detalhes do frontend

O `.env.local` do frontend usa o **proxy do Vite**: `VITE_API_URL=/api/v1`
(mesma origem) e `VITE_PROXY_TARGET=http://localhost:4000` (para onde o
Vite repassa). Assim o browser nunca faz cross-origin e o CORS da API
nem entra na conta em desenvolvimento. Se apontar `VITE_API_URL` direto
para `http://localhost:4000/api/v1`, funciona também — a API aceita
`http://localhost:5173` no CORS —, mas aí a chamada vira cross-origin.

### Scripts da pasta LearnUp

| Comando | O que faz |
| --- | --- |
| `npm run instalar` | instalação completa: dependências, `.env`, tabelas e seed |
| `npm run dev` | liga API (4000) e site (5173) juntos |
| `npm run conferir` | diagnostica o ambiente e diz o que falta |
| `npm run banco` | confere o PostgreSQL local e explica como instalar se faltar |
| `npm run db:reset` | recria as tabelas e coloca os dados de exemplo |
| `npm run db:status` | lista as migrations já aplicadas |
| `npm test` | roda a suíte E2E do backend |
| `npm run build` | build de produção do site |

### Scripts

| Backend | O que faz |
| --- | --- |
| `npm run dev` | API com reload (`--watch`) |
| `npm start` | API em produção local |
| `npm run migrate` | aplica migrations pendentes |
| `npm run migrate:down` | reverte a última migration aplicada |
| `npm run migrate:status` | lista o que está aplicado |
| `npm run seed` | popula o banco (idempotente por `ON CONFLICT`) |
| `npm run db:reset` | `TRUNCATE` + migrations + seed |
| `npm test` | suíte E2E (sobe a API se não houver no ar) |

| Frontend | O que faz |
| --- | --- |
| `npm run dev` | Vite em desenvolvimento com HMR |
| `npm run build` | build de produção em `dist/` |
| `npm run preview` | serve o `dist/` localmente |

---

## Contas de demonstração

Criadas por `npm run seed`. **Senha para todas: `learnup123`**

| E-mail | Papel | Observação |
| --- | --- | --- |
| `ana@learnup.dev` | aluno | já tem cursos em andamento, certificado e badges |
| `carlos@learnup.dev` | aluno | primeiro usuário, muita atividade no fórum |
| `dana@learnup.dev` | aluno | cursos concluídos |
| `bruno@learnup.dev` | instrutor | único instrutor, dono dos cursos do catálogo |
| `admin@learnup.dev` | admin | administra a plataforma (pessoas e papéis) |
| `visitante@learnup.dev` | visitante | conta sem matrícula, útil para ver os estados vazios |

Na tela de login há botões que preenchem essas contas automaticamente.

---

## Painel administrativo

Rota `/admin`, atrás de `RequireRole`: só quem tem papel `admin` entra, e o
guard vale no roteador do frontend **e** em cada rota da API.

| Rota | O que resolve |
| --- | --- |
| `/admin` | visão geral: números da plataforma e fila de trabalho |
| `/admin/cursos` | transições de status, arquivamento e exclusão com motivo |
| `/admin/usuarios` | papéis, bloqueio, desbloqueio e redefinição de senha |
| `/admin/pedidos` | confirmação, cancelamento e reembolso |
| `/admin/matriculas` | cancelamento/reativação e revogação de certificados |
| `/admin/conteudo` | categorias e conquistas |
| `/admin/moderacao` | ocultar, reexibir e excluir avaliações, posts e comentários |
| `/admin/relatorios` | receita, rankings, conclusão e atividade |
| `/admin/configuracoes` | configurações da plataforma |
| `/admin/auditoria` | histórico imutável de todas as decisões |

O painel tem layout próprio (`AdminLayout`): o `Header`/`Footer` públicos não
aparecem, e o menu vira gaveta abaixo de 992px.

### Regras que a tela não consegue inventar

- **Exclusão de curso é bloqueada** se houver qualquer matrícula **ou qualquer
  pedido**. O caminho seguro é arquivar, e a mensagem de erro diz isso. O
  motivo da exclusão é obrigatório e vai para a auditoria.
- **O ciclo de vida do curso tem dono**: o instrutor move `draft → in_review`; a
  partir daí só o admin decide (`approve`, `reject`, `unpublish`, `archive`,
  `restore`). `restore` volta para `draft`, nunca direto para `published`.
- **Arquivar não expulsa ninguém**: some do catálogo, mas a matrícula e o
  acesso continuam.
- **Reembolso tira acesso, não apaga histórico**: a matrícula vai para
  `refunded`, o certificado é revogado e o **progresso é preservado** — quem
  volta não recomeça do zero.
- **Cancelar ≠ concluir**: existe o status `canceled` separado de `completed_at`,
  e só `active` abre as aulas. Uma matrícula cancelada não libera o player.
- **Bloquear** encerra as sessões na hora (o refresh token é apagado e o access
  token deixa de ser aceito) e a resposta de login passa a ser `403
  account_blocked` com o motivo — a pessoa precisa saber o que aconteceu para
  procurar o suporte.
- **O admin não pode rebaixar a própria conta** nem remover a última conta de
  admin da plataforma.
- **Conceder uma conquista credita os pontos**, e retirar estorna — o valor vem
  da própria badge, tanto no caminho manual quanto no automático.

### Auditoria

Toda ação de escrita do admin grava uma linha em `audit_logs` com ator, ação,
entidade, resumo e o antes/depois. O log é **append-only**: a API só lê, e a
rota de criação não existe. Os motivos obrigatórios (exclusão de curso, bloqueio,
cancelamento, reembolso) ficam também em `after.reason`, para o diff da tela
mostrar o campo em vez de só o texto do resumo.

---

## Pagamentos

O provider é escolhido por `PAYMENT_PROVIDER`.

**`mock` (padrão, recomendado para desenvolvimento)**

- Gera um pedido com **QR Code e código PIX copia-e-cola** no formato EMV/BR Code.
- A confirmação é manual: o botão "Já paguei · confirmar pagamento" chama
  `POST /payments/mock/:orderId/confirm`, que substitui o webhook do gateway.
- Nenhum valor real é cobrado.

**`stripe`** — `POST /payments/orders` cria uma Checkout Session e devolve
`checkoutUrl`. O webhook fica em `POST /api/v1/payments/webhook/stripe`.

**`mercadopago`** — cria uma preferência de pagamento via API do Mercado Pago.

> PayPal não tem provider próprio: em qualquer provider, o método `paypal`
> aparece como opção e segue o mesmo fluxo de confirmação do ambiente atual.

Ao confirmar o pagamento, o backend é **idempotente**: matcula o aluno,
credita os pontos, avalia as badges e **emite o certificado** se o curso já
tiver 100% das aulas concluídas.

---

## Endpoints principais

Base: `/api/v1` · Autenticação: `Authorization: Bearer <accessToken>`

<details>
<summary><strong>Auth</strong></summary>

| Método | Rota | Descrição |
| --- | --- | --- |
| POST | `/auth/register` | cria conta e já devolve tokens |
| POST | `/auth/login` | devolve access + refresh token |
| POST | `/auth/refresh` | rotaciona o refresh token |
| POST | `/auth/logout` | revoga a sessão |
| GET | `/auth/me` | dados do usuário logado |
| PATCH | `/auth/me` | atualiza nome, bio, telefone |
| POST | `/auth/change-password` | troca de senha |

</details>

<details>
<summary><strong>Cursos</strong></summary>

| Método | Rota | Descrição |
| --- | --- | --- |
| GET | `/courses` | catálogo com filtros: `search`, `category`, `level`, `minPrice`, `maxPrice`, `free`, `sort`, `page`, `limit` |
| GET | `/courses/categories` | categorias com contagem de cursos |
| GET | `/courses/instructors` | instrutores |
| GET | `/courses/:idOuSlug` | detalhe + módulos + se está matriculado |
| GET | `/courses/:id/reviews` | avaliações |
| POST | `/courses/:id/reviews` | avalia (exige matrícula) |
| GET | `/courses/:id/related` | cursos relacionados |

A busca é **full-text em português e sem acento** (`search=gestao` encontra "Gestão").

</details>

<details>
<summary><strong>Gestão de cursos e administração</strong></summary>

| Método | Rota | Quem | Descrição |
| --- | --- | --- | --- |
| GET | `/courses/mine` | instrutor, admin | cursos sob gestão, incluindo rascunhos |
| POST | `/courses` | instrutor, admin | cria (ou atualiza, se o slug já for seu) |
| GET | `/courses/:id/manage` | dono, admin | curso completo para edição |
| PATCH | `/courses/:id` | dono, admin | metadados (título, preço, capa, status…) |
| PUT | `/courses/:id/curriculum` | dono, admin | salva módulos e aulas |
| GET | `/admin/overview` | admin | números da plataforma |
| GET | `/admin/users` | admin | lista com `search`, `role`, `status`, `orderBy`, paginação |
| GET | `/admin/users/:id` | admin | ficha: resumo, cursos, matrículas, certificados, badges |
| PATCH | `/admin/users/:id/role` | admin | troca o papel e encerra a sessão do alvo |
| POST | `/admin/users/:id/block` | admin | bloqueia (`{ reason }`) e derruba as sessões |
| POST | `/admin/users/:id/unblock` | admin | devolve o acesso |
| POST | `/admin/users/:id/reset-password` | admin | define uma senha nova |
| GET | `/admin/courses` | admin | lista com `studentsCount` e `orderCount` |
| GET | `/admin/courses/:id` | admin | detalhe: matrículas, pedidos, avaliações, receita |
| POST | `/admin/courses/:id/{approve\|reject\|publish\|unpublish\|archive\|restore}` | admin | transições; algumas exigem `{ reason }` |
| DELETE | `/admin/courses/:id` | admin | exclusão definitiva, exige `{ reason }` |
| GET | `/admin/orders` | admin | pedidos com filtros por `status` e `method` |
| POST | `/admin/orders/:id/{confirm\|cancel\|refund}` | admin | `cancel` e `refund` exigem `{ reason }` |
| GET | `/admin/enrollments` | admin | matrículas com filtros por `status`, `userId`, `courseId` |
| POST | `/admin/enrollments/:id/{cancel\|reactivate}` | admin | cancelamento e reativação |
| GET | `/admin/certificates` | admin | certificados, com `revoked=true\|false` |
| PATCH | `/admin/certificates/:id` | admin | revoga (`{ reason }`) ou restaura |
| GET/POST/PATCH/DELETE | `/admin/categories[/:id]` | admin | categorias; excluir recusa se houver curso |
| POST | `/admin/categories/:id/uncategorize` | admin | desvincula os cursos em bloco |
| GET/POST/PATCH/DELETE | `/admin/badges[/:id]` | admin | conquistas (`criteria` vem do catálogo do backend) |
| POST | `/admin/badges/:id/{award\|revoke}` | admin | concede/retira e credita/estorna os pontos |
| GET | `/admin/{reviews\|posts\|comments}` | admin | filas de moderação, `visibility=visible\|hidden` |
| POST | `/admin/{reviews\|posts\|comments}/:id/visibility` | admin | oculta (`{ hidden, reason }`) ou reexibe |
| DELETE | `/admin/{reviews\|posts\|comments}/:id` | admin | exclusão definitiva |
| GET | `/admin/reports/{summary\|revenue\|top-courses\|top-instructors\|completion\|activity}` | admin | relatórios |
| GET | `/admin/reports/course/:id/funnel` | admin | funil de um curso |
| GET/PATCH | `/admin/settings` | admin | lê e salva as configurações |
| GET | `/admin/audit-logs` | admin | histórico, com `search`, `action`, `entityType`, `actorId` |

Regras que valem mais que a tela:

- Ninguém edita o curso de outro. O slug é único, e informar o slug de um curso
  alheio é recusado — inclusive no `POST`.
- O admin pode mudar qualquer papel, menos o próprio (e não pode remover o
  último admin da plataforma).
- Ao salvar o currículo, aulas e módulos que continuam são **atualizados no
  lugar**: o `id` é preservado, então o progresso dos alunos não é apagado.
  A constraint `UNIQUE (course_id, position)` é contornada estacionando as
  linhas antes de gravar as posições finais.

</details>

<details>
<summary><strong>Aprendizado</strong></summary>

| Método | Rota | Descrição |
| --- | --- | --- |
| GET | `/enrollments` | minhas matrículas (`status=all\|in_progress\|completed`) |
| POST | `/enrollments` | matrícula em curso **gratuito** |
| GET | `/enrollments/:courseId/outline` | tudo que o player precisa (exige matrícula) |
| GET | `/enrollments/:courseId/progress` | progresso agregado |
| PUT | `/enrollments/:courseId/lessons/:lessonId` | salva posição / conclui a aula |
| GET | `/quizzes/lessons/:lessonId` | quiz **sem** gabarito |
| POST | `/quizzes/lessons/:lessonId/attempts` | envia respostas; recebe nota, pontos e badges |

Assistir a **≥ 90%** da duração marca a aula como concluída automaticamente.
Concluir a última aula fecha o curso: credita o bônus, avalia badges e
emite o certificado.

</details>

<details>
<summary><strong>Certificados, fórum e gamificação</strong></summary>

| Método | Rota | Descrição |
| --- | --- | --- |
| GET | `/certificates` | meus certificados |
| GET | `/certificates/verify/:code` | **público**: valida um certificado |
| GET | `/certificates/:code/download` | PDF do certificado |
| GET | `/forum/posts` | listagem (`search`, `sort=recent\|top\|unanswered`) |
| GET | `/forum/posts/:id` | detalhe + comentários |
| POST | `/forum/posts` | publica (ganha pontos) |
| POST | `/forum/posts/:id/comments` | responde |
| GET | `/gamification/me` | pontos, nível, badges e estatísticas |
| GET | `/gamification/leaderboard` | ranking público |
| GET | `/gamification/badges` | catálogo de badges e regras |

</details>

<details>
<summary><strong>Pagamentos</strong></summary>

| Método | Rota | Descrição |
| --- | --- | --- |
| GET | `/payments/methods` | métodos do provider ativo |
| POST | `/payments/orders` | cria o pedido (`courseId`, `method`, `discountCents`) |
| GET | `/payments/orders` | meus pedidos |
| POST | `/payments/mock/:orderId/confirm` | confirma pagamento (só `mock`) |
| POST | `/payments/webhook/:provider` | webhook do gateway (corpo cru) |

</details>

---

## Testes

```bash
cd backend
npm run db:reset   # banco limpo e populado
npm test
```

Execute a suíte E2E depois de subir e popular o PostgreSQL.

A suíte E2E de verdade — sobe a API contra o Postgres, faz cadastro, login,
compra com Pix, confirmação, player, quiz, fórum, gamificação e certificado.
São três arquivos:

| Arquivo | Cobre |
| --- | --- |
| `smoke.test.js` | o fluxo do aluno, ponta a ponta |
| `management.test.js` | área do instrutor e o painel do admin |
| `admin.test.js` | o painel administrativo inteiro, arquivo a arquivo |

Resultado verificado: **83 testes, 83 passando** (PostgreSQL 16,
`PAYMENT_PROVIDER=mock`), sendo 32 só do painel administrativo.

Detalhes que importam:

- Se já houver uma API em `localhost:4000`, o teste usa a instância existente;
  caso contrário ele sobe e derruba uma sozinha.
- Os testes criam contas descartáveis (`comprador.<timestamp>@…`), então podem
  rodar várias vezes seguidas sem `db:reset`.
- `admin.test.js` é autocontido: ele mesmo promove um `student` a `admin` com
  `PATCH /admin/users/:id/role` para ter com quem falar, e **devolve o papel ao
  final**. Sem esse cuidado, cada rodada deixaria um admin a mais no banco e a
  contagem de admins do `management.test.js` passaria a falhar.
- O runner de teste sobe a API com `NODE_ENV=test`, que **desliga o rate limit**
  — sem isso a própria suíte seria barrada pelo limiter que ela exercita.
- ⚠️ **Armadilha:** o `NODE_ENV=test` só vale para a API que o runner **sobe**.
  Se já existir uma instância sua em `localhost:4000`, a suíte a reaproveita
  rodando com o rate limit **ligado** — e então ela se barra sozinha no limiter
  de login, falhando em cascata com `401`. Antes de `npm test`, garanta que a
  porta 4000 está livre, ou aponte para outra porta:
  `PORT=4100 API_URL=http://localhost:4100/api/v1 npm test`.

---

## Variáveis de ambiente

`backend/.env` (copie de `.env.example`):

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `NODE_ENV` | `development` | `test` desliga o rate limit |
| `PORT` | `4000` | porta da API |
| `API_PREFIX` | `/api/v1` | prefixo das rotas |
| `DATABASE_URL` | — | **obrigatória** |
| `JWT_SECRET` | — | **obrigatória**, min. 16 chars |
| `JWT_REFRESH_SECRET` | — | **obrigatória** e diferente da anterior |
| `JWT_ACCESS_TTL` | `15m` | validade do access token |
| `JWT_REFRESH_TTL_DAYS` | `30` | validade do refresh token |
| `BCRYPT_ROUNDS` | `10` | custo do hash de senha |
| `CORS_ORIGIN` | `http://localhost:5173` | origens permitidas, separada por vírgula |
| `COOKIE_SECURE` | `false` | `true` em produção com HTTPS |
| `TRUST_PROXY` | `false` | ative se houver proxy reverso |
| `RATE_LIMIT` | `auto` | `true`, `false` ou `auto` (off em `test`) |
| `PAYMENT_PROVIDER` | `mock` | `mock`, `stripe` ou `mercadopago` |
| `STRIPE_SECRET_KEY` | — | só com `PAYMENT_PROVIDER=stripe` |
| `STRIPE_WEBHOOK_SECRET` | — | valida a assinatura do webhook Stripe |
| `MERCADOPAGO_ACCESS_TOKEN` | — | só com `PAYMENT_PROVIDER=mercadopago` |

O app **recusa a subir em produção** se `JWT_SECRET` e `JWT_REFRESH_SECRET`
 forem iguais ou começarem com `dev-secret`.

`frontend/.env.local`:

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `VITE_API_URL` | `/api/v1` | base da API; vazia = usa o proxy do Vite |
| `VITE_PROXY_TARGET` | `http://localhost:4000` | destino do proxy de `/api` e `/health` |

---

## Decisões técnicas

**Access token curto + refresh token opaco em cookie httpOnly.** O access token
vive 15 minutos; o refresh fica em cookie `httpOnly`, guardado apenas como hash
no banco e rotacionado a cada uso. Reutilizar um token já rotacionado revoga as
sessões ainda válidas do usuário.

**Pontos idempotentes.** Toda pontuação vai para `point_ledger` com um índice
único parcial em `(user_id, reason, ref_type, ref_id)`. Concluir a mesma aula
duas vezes, ou receber o mesmo webhook duas vezes, não duplica pontos.

**Busca sem acento.** O PostgreSQL 16 não deixa `unaccent` ser usado em índice
(funcional sem `IMMUTABLE`). A migration 003 cria `unaccent_immutable`, e a
busca usa `to_tsvector` + `ILIKE` com essa função nos dois lados.

**Webhooks com corpo cru.** A assinatura do Stripe é calculada sobre os bytes
exatos. Por isso `POST /payments/webhook/*` é montado **antes** do
`express.json()` global, num router separado — se fosse depois, o corpo já
estaria parseado e a validação sempre falharia.

**Rate limit configurável.** O limiter de login (20 req / 15 min) existe para
frear força bruta, mas desligar em `test` evita que a suíte se auto-bloqueie.

**Booleanos na query não podem usar `z.coerce.boolean()`.** Query string é
texto, e `z.coerce.boolean()` aplica `Boolean()`, que trata `"false"`, `"0"` e
`""` como `true` — um filtro `?revoked=false` responderia com os revogados. O
`utils/helpers.js` tem um `booleanFlag()` que reconhece só as formas
inesquívocas (`true`/`sim`/`1` e `false`/`não`/`nao`/`no`/`0`) e devolve
`undefined` quando o filtro não veio. O mesmo vale para a query e para o corpo,
onde a query do PostgreSQL continua sendo montada com o valor booleano de
verdade.

**Front sem dependência de UI.** CSS próprio com design tokens em
`styles/global.css` e layout mobile-first nos breakpoints 480/768/992/1280:
o grid do player vira duas colunas só acima de 992px, e o menu do header
vira gaveta abaixo de 768px.

**Tema escuro com acento verde.** O fundo é navy (`--ink-50: #001133`) e as
superfícies claras são `#00194a`. A escala `--ink-*` é **invertida de
propósito**: `50` é a superfície mais escura e `900` o texto mais claro,
o que permite que texto e fundo compartilhem o mesmo par de tokens.
O acento é o verde `#63bf13` (`--brand-600`), e **todo fill verde usa texto
navy** — branco sobre `#63bf13` daria 2.3:1, reprovando em contraste.

**Ícones em SVG inline.** `components/Icon.jsx` desenha os símbolos num
viewBox 24x24 com `currentColor`, no lugar de emoji ou de uma biblioteca
de ícones: o mesmo peso visual da referência sem dependência nova.

**Download autenticado.** O PDF exige `Authorization`, e um `<a href>` não
envia header. Por isso o frontend faz `fetch` + `blob` + object URL
(`api/download.js`).

---

## Limitações conhecidas

- **PayPal é simulado.** Não há integração real; o método existe no fluxo de
  pagamento mas usa o provider ativo.
- **As aulas do seed não têm vídeo.** `video_url` é nulo, então o player cai
  num modo de demonstração com o texto da aula. Para testar o player de
  verdade, cadastre uma URL real em `lessons.video_url`.
- **O quiz não é editável pela interface.** O editor monta a aula do tipo quiz,
  mas as perguntas continuam sendo criadas no banco.
- **Sem e-mail.** Não há envio de e-mail: recuperação de senha, verificação de
  endereço e newsletter não existem (o campo do rodapé é apenas visual).
- **Sem upload de arquivos.** Capas e avatares usam URLs externas.
