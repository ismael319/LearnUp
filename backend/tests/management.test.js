/**
 * Testes da área de gestão: cursos do instrutor e painel do administrador.
 *
 * Requer o banco migrado e populado (npm run db:reset).
 * Se a API não estiver no ar, o próprio teste sobe e derruba o servidor.
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signAccessToken } from '../src/modules/auth/tokens.js';

const API = process.env.API_URL ?? 'http://localhost:4000/api/v1';
const ORIGIN = API.replace(/\/api\/v1\/?$/, '');
const PASSWORD = 'learnup123';
const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');

const stamp = randomUUID().replace(/-/g, '').slice(0, 10);
let server = null;

async function reachable() {
  try {
    const res = await fetch(`${ORIGIN}/health`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

let instructorToken;
let adminToken;
let adminId;
let studentToken;
let strangerInstructorToken;

// Um único `before`: subir o servidor e autenticar as contas na mesma etapa,
// como em smoke.test.js. Com dois hooks separados o runner dispara os testes
// antes das contas estarem prontas.
before(async () => {
  if (!(await reachable())) {
    server = spawn(process.execPath, ['src/server.js'], {
      cwd: rootDir,
      stdio: 'ignore',
      env: { ...process.env, NODE_ENV: 'test', RATE_LIMIT: 'false' },
    });

    let up = false;
    for (let i = 0; i < 40; i += 1) {
      if (await reachable()) {
        up = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    if (!up) {
      server?.kill();
      throw new Error('A API não subiu. Rode "npm run db:reset" antes dos testes.');
    }
  }

  instructorToken = await loginAs('bruno@learnup.dev');
  adminToken = await loginAs('admin@learnup.dev');
  // Guardado para conferir que a aprovação registra QUEM aprovou, não só que
  // sobrou uma data na linha do curso.
  adminId = (await loginUser('admin@learnup.dev')).id;
  studentToken = await registerStudent('Aluno Gestao', `gestao.${stamp}@learnup.dev`);
  // Instrutor "fantasma": existe como papel, mas não é dono de nada.
  strangerInstructorToken = signAccessToken({
    id: randomUUID(),
    email: `fantasma.${stamp}@learnup.dev`,
    role: 'instructor',
    name: 'Instrutor Fantasma',
  });
});

after(() => {
  server?.kill();
});

/** Sem `token`, a requisição sai anônima. */
async function call(method, path, { body, token } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

async function loginAs(email, password = PASSWORD) {
  const { status, data } = await call('POST', '/auth/login', { body: { email, password } });
  assert.equal(status, 200, `login de ${email} falhou`);
  return data.accessToken;
}

/** Login devolvendo o usuário, para quando o teste precisa do id. */
async function loginUser(email, password = PASSWORD) {
  const { status, data } = await call('POST', '/auth/login', { body: { email, password } });
  assert.equal(status, 200, `login de ${email} falhou`);
  return data.user;
}

async function registerStudent(name, email, password = 'senha1234') {
  const { status } = await call('POST', '/auth/register', {
    body: { name, email, password, acceptTerms: true },
  });
  assert.equal(status, 201, `cadastro de ${email} falhou`);
  return loginAs(email, password);
}

// --- /courses/mine --------------------------------------------------------

test('GET /courses/mine exige autenticacao e papel de gestao', async () => {
  assert.equal((await call('GET', '/courses/mine')).status, 401);
  assert.equal((await call('GET', '/courses/mine', { token: studentToken })).status, 403);
  assert.equal((await call('GET', '/courses/mine', { token: adminToken })).status, 200);
  assert.equal((await call('GET', '/courses/mine', { token: instructorToken })).status, 200);
});

test('GET /courses/mine nao e interpretado como id de curso', async () => {
  const { status, data } = await call('GET', '/courses/mine', { token: instructorToken });
  assert.equal(status, 200);
  // Se a rota tivesse caído em /:id, a resposta seria 404 de curso.
  assert.ok(Array.isArray(data.courses), 'esperava a lista de cursos, nao um curso');
});

test('GET /courses/mine do instrutor traz os cursos dele, inclusive rascunhos', async () => {
  const { data } = await call('GET', '/courses/mine', { token: instructorToken });
  const mine = data.courses;

  assert.ok(mine.length > 0, 'o instrutor do seed deveria ter cursos');
  assert.ok(mine.every((c) => c.ownedByMe), 'todo curso listado deve ser do proprio instrutor');
  assert.ok(mine.every((c) => c.instructorName === 'Bruno Galvão'));

  // O catalogo publico esconde rascunhos; a area de gestao precisa mostrar.
  const { data: created } = await call('POST', '/courses', {
    token: instructorToken,
    body: { title: `Rascunho de teste ${stamp}`, status: 'draft' },
  });

  const { data: after } = await call('GET', '/courses/mine', { token: instructorToken });
  const draft = after.courses.find((c) => c.id === created.course.id);
  assert.ok(draft, 'o rascunho precisa aparecer para o instrutor');
  assert.equal(draft.status, 'draft');
  assert.equal(draft.ownedByMe, true);
  assert.equal(typeof draft.studentsCount, 'number');
  assert.equal(typeof draft.revenueCents, 'number');
});

test('admin ve todos os cursos em /courses/mine, os seus marcados como tal', async () => {
  const { data } = await call('GET', '/courses/mine', { token: adminToken });
  assert.ok(data.courses.length > 1, 'o admin deve ver cursos de mais de um dono');
  assert.ok(data.courses.every((c) => c.ownedByMe === (c.instructorName === 'Equipe LearnUp')));
});

// --- Criacao e edicao de curso -------------------------------------------

test('POST /courses cria o curso com o dono sendo quem o criou', async () => {
  const { status, data } = await call('POST', '/courses', {
    token: instructorToken,
    body: { title: `Curso proprio ${stamp}`, status: 'draft' },
  });
  assert.equal(status, 201);
  assert.match(data.course.slug, /^curso-proprio-/);

  // A posse e conferida pela lista de gestao, nao pelo formato da resposta.
  const { data: list } = await call('GET', '/courses/mine', { token: instructorToken });
  const criado = list.courses.find((c) => c.id === data.course.id);
  assert.ok(criado, 'o curso criado deve aparecer para o proprio instrutor');
  assert.equal(criado.ownedByMe, true);
  assert.equal(criado.instructorName, 'Bruno Galvão');
});

test('instrutor nao pode sequestrar o curso de outro pelo slug', async () => {
  const { data: target } = await call('GET', '/courses/mine', { token: instructorToken });
  const alheio = target.courses[0];

  const { status } = await call('POST', '/courses', {
    token: strangerInstructorToken,
    body: { title: ` sequestro ${stamp}`, slug: alheio.slug },
  });
  assert.equal(status, 403, 'usar o slug de outro curso deve ser recusado');
});

test('PATCH /courses/:id so aceita o dono ou o admin', async () => {
  const { data: created } = await call('POST', '/courses', {
    token: instructorToken,
    body: { title: `Curso editavel ${stamp}`, status: 'draft' },
  });
  const path = `/courses/${created.course.id}`;

  assert.equal((await call('PATCH', path, { token: studentToken, body: { title: ' hackeado' } })).status, 403);
  assert.equal(
    (await call('PATCH', path, { token: strangerInstructorToken, body: { title: ' hackeado' } })).status,
    403,
    'instrutor que nao e dono nao pode editar',
  );
  assert.equal((await call('PATCH', path, { token: adminToken, body: { title: ' hackeado' } })).status, 200);
});

test('PATCH /courses/:id atualiza os campos e preserva os ausentes', async () => {
  const { data: created } = await call('POST', '/courses', {
    token: instructorToken,
    body: { title: `Curso metadados ${stamp}`, status: 'draft' },
  });
  const path = `/courses/${created.course.id}`;
  const publishPath = `/admin/courses/${created.course.id}/publish`;

  // Publicação é ato do admin (regra de governança): o instrutor edita o
  // conteúdo, mas não controla se o curso entra no catálogo.
  const instructorPublish = await call('PATCH', path, {
    token: instructorToken,
    body: { title: `Curso publicado ${stamp}`, status: 'published', priceCents: 9900, durationMinutes: 240 },
  });
  assert.equal(instructorPublish.status, 403, 'instrutor não pode publicar o próprio curso');
  assert.match(
    instructorPublish.data?.error?.message ?? '',
    /admin|publica/i,
    'a resposta deve explicar que a publicação é do admin',
  );

  // Publicação pelo painel: o mesmo estado, com rastro de quem aprovou.
  const { status: publishStatus, data: approved } = await call('POST', publishPath, {
    token: adminToken,
    body: { reason: 'aprovado no teste' },
  });
  assert.equal(publishStatus, 200);
  assert.equal(approved.course.status, 'published');
  // O painel admin trabalha em camelCase, ao contrário do PATCH legado de curso.
  assert.ok(approved.course.approvedAt, 'aprovar registra quando');
  assert.equal(approved.course.approvedBy, adminId, 'aprovar registra quem');

  // Publicado, o instrutor volta a editar os metadados normalmente.
  const { status, data } = await call('PATCH', path, {
    token: instructorToken,
    body: { title: `Curso publicado ${stamp}`, priceCents: 9900, durationMinutes: 240 },
  });
  assert.equal(status, 200);
  assert.equal(data.course.title, `Curso publicado ${stamp}`);
  assert.equal(data.course.price_cents, 9900);
  assert.ok(data.course.published_at, 'publicar precisa registrar a data');

  const firstPublishedAt = data.course.published_at;
  const { data: again } = await call('PATCH', path, {
    token: instructorToken,
    body: { subtitle: 'so o subtitulo muda' },
  });
  assert.equal(again.course.subtitle, 'so o subtitulo muda');
  assert.equal(again.course.title, `Curso publicado ${stamp}`, 'campo ausente deve ser preservado');
  assert.equal(again.course.published_at, firstPublishedAt, 'a data de publicacao nao pode ser zerada');
});

test('GET /courses/:id/manage so abre para o dono ou o admin', async () => {
  const { data: created } = await call('POST', '/courses', {
    token: instructorToken,
    body: { title: `Curso editor ${stamp}` },
  });
  const path = `/courses/${created.course.id}/manage`;

  assert.equal((await call('GET', path)).status, 401);
  assert.equal((await call('GET', path, { token: studentToken })).status, 403);
  assert.equal((await call('GET', path, { token: strangerInstructorToken })).status, 403);
  assert.equal((await call('GET', path, { token: adminToken })).status, 200);
  assert.equal((await call('GET', path, { token: instructorToken })).status, 200);
});

// --- Curriculo: o ponto que nao pode perder progresso --------------------

test('salvar o curriculo preserva o progresso das aulas que continuam', async () => {
  const { data: created } = await call('POST', '/courses', {
    token: instructorToken,
    body: { title: `Curso progresso ${stamp}`, status: 'draft', priceCents: 0 },
  });
  const courseId = created.course.id;

  // Matrícula só existe em curso publicado, e publicação é ato do admin.
  await call('POST', `/admin/courses/${courseId}/publish`, {
    token: adminToken,
    body: { reason: 'aprovado no teste' },
  });

  const { data: first } = await call('PUT', `/courses/${courseId}/curriculum`, {
    token: instructorToken,
    body: {
      modules: [{ title: 'Modulo 1', lessons: [{ title: 'Aula A', type: 'video', durationSeconds: 60 }] }],
    },
  });
  assert.equal(first.moduleCount, 1);

  const { data: forEdit } = await call('GET', `/courses/${courseId}/manage`, { token: instructorToken });
  const lessonA = forEdit.course.modules[0].lessons[0];

  // Matricula gratuita do aluno de teste.
  const enroll = await call('POST', '/enrollments', { token: studentToken, body: { courseId } });
  assert.equal(enroll.status, 201);

  const progress = await call('PUT', `/enrollments/${courseId}/lessons/${lessonA.id}`, {
    token: studentToken,
    body: { completed: true, positionSeconds: 60 },
  });
  assert.equal(progress.status, 200);

  // O instrutor renomeia a aula e acrescenta outra, reenviando os ids atuais.
  const { status, data: saved } = await call('PUT', `/courses/${courseId}/curriculum`, {
    token: instructorToken,
    body: {
      modules: [
        {
          id: forEdit.course.modules[0].id,
          title: 'Modulo 1',
          lessons: [
            { ...lessonA, title: 'Aula A renomeada' },
            { title: 'Aula B nova', type: 'text', content: 'conteudo' },
          ],
        },
      ],
    },
  });
  assert.equal(status, 200);
  assert.equal(saved.lessonCount, 2);

  // A aula original foi atualizada no lugar, nao recriada: o progresso sobrou.
  const { data: outline } = await call('GET', `/enrollments/${courseId}/outline`, { token: studentToken });
  const flat = outline.modules.flatMap((m) => m.lessons);
  const renamed = flat.find((l) => l.id === lessonA.id);
  assert.ok(renamed, 'a aula original deve continuar com o mesmo id');
  assert.equal(renamed.title, 'Aula A renomeada');
  assert.equal(renamed.completed, true, 'o progresso nao pode ser apagado ao salvar o curriculo');

  const { data: after } = await call('GET', `/courses/${courseId}/manage`, { token: instructorToken });
  assert.equal(after.course.modules[0].lessons.length, 2);
});

test('aulas removidas do curriculo somem do banco', async () => {
  const { data: created } = await call('POST', '/courses', {
    token: instructorToken,
    body: { title: `Curso limpeza ${stamp}` },
  });
  const courseId = created.course.id;

  await call('PUT', `/courses/${courseId}/curriculum`, {
    token: instructorToken,
    body: { modules: [{ title: 'Keep', lessons: [{ title: 'Some' }] }] },
  });

  const { data: forEdit } = await call('GET', `/courses/${courseId}/manage`, { token: instructorToken });
  const moduleId = forEdit.course.modules[0].id;
  const lessonId = forEdit.course.modules[0].lessons[0].id;

  // Modulo novo, sem a aula antiga: aula e modulo devem ser removidos.
  // O resumo do PUT vem solto no corpo (não dentro de `summary`).
  const { data: saved } = await call('PUT', `/courses/${courseId}/curriculum`, {
    token: instructorToken,
    body: { modules: [{ title: 'So este', lessons: [{ title: 'Nova' }] }] },
  });
  assert.equal(saved.moduleCount, 1);
  assert.equal(saved.lessonCount, 1);

  const { data: after } = await call('GET', `/courses/${courseId}/manage`, { token: instructorToken });
  assert.notEqual(after.course.modules[0].id, moduleId);
  assert.equal(after.course.modules[0].lessons[0].id === lessonId, false);
});

// --- /admin ---------------------------------------------------------------

test('/admin e inacessivel para quem nao e admin', async () => {
  for (const path of ['/admin/overview', '/admin/users']) {
    assert.equal((await call('GET', path)).status, 401, `${path} sem sessao`);
    assert.equal((await call('GET', path, { token: studentToken })).status, 403, `${path} como aluno`);
    assert.equal((await call('GET', path, { token: instructorToken })).status, 403, `${path} como instrutor`);
    assert.equal((await call('GET', path, { token: adminToken })).status, 200, `${path} como admin`);
  }
});

test('GET /admin/overview devolve os numeros da plataforma', async () => {
  const { data } = await call('GET', '/admin/overview', { token: adminToken });
  const o = data.overview;
  assert.ok(o.users.students >= 1);
  assert.ok(o.users.instructors >= 1);
  assert.ok(o.users.admins >= 1);
  assert.ok(o.courses.total >= 1);
  assert.equal(typeof o.enrollments, 'number');
  assert.equal(typeof o.revenueCents, 'number');
});

test('GET /admin/users filtra e pagina', async () => {
  const { data: todos } = await call('GET', '/admin/users?limit=5', { token: adminToken });
  assert.equal(todos.users.length, 5);
  assert.ok(todos.meta.total > 5);
  assert.equal(todos.meta.hasNext, true);

  const { data: filtrados } = await call('GET', '/admin/users?role=admin', { token: adminToken });
  assert.ok(filtrados.users.length >= 1);
  assert.ok(filtrados.users.every((u) => u.role === 'admin'));

  const { data: buscados } = await call('GET', `/admin/users?search=gestao.${stamp}`, { token: adminToken });
  assert.equal(buscados.users.length, 1);
  assert.match(buscados.users[0].email, /gestao\./);
});

test('busca de usuario ignora acentos nos dois sentidos', async () => {
  // A conta foi cadastrada como "Aluno Gestao" (sem acento)...
  const semAcento = await call('GET', '/admin/users?search=gestao', { token: adminToken });
  assert.ok(semAcento.data.users.some((u) => u.email.startsWith(`gestao.${stamp}`)));

  // ...e a busca com acento precisa encontrá-la do mesmo jeito.
  const comAcento = await call('GET', '/admin/users?search=gest%C3%A3o', { token: adminToken });
  assert.ok(
    comAcento.data.users.some((u) => u.email.startsWith(`gestao.${stamp}`)),
    'buscar por "gestão" deveria achar "Gestao"',
  );
});

test('PATCH /admin/users/:id/role troca o papel e o novo papel vale no login seguinte', async () => {
  const token = await registerStudent('Aluno Promovido', `promovido.${stamp}@learnup.dev`);
  const { data: me } = await call('GET', '/auth/me', { token });
  const userId = me.user.id;

  assert.equal(
    (await call('PATCH', `/admin/users/${userId}/role`, { token: studentToken, body: { role: 'admin' } })).status,
    403,
    'aluno nao pode se promover',
  );

  const { status, data } = await call('PATCH', `/admin/users/${userId}/role`, {
    token: adminToken,
    body: { role: 'instructor' },
  });
  assert.equal(status, 200);
  assert.equal(data.user.role, 'instructor');

  // O token antigo continua válido (é JWT), mas a sessão foi revogada: o
  // usuário precisa logar de novo, e aí já recebe o papel novo.
  const relogin = await call('POST', '/auth/login', {
    body: { email: `promovido.${stamp}@learnup.dev`, password: 'senha1234' },
  });
  assert.equal(relogin.status, 200);
  assert.equal(relogin.data.user.role, 'instructor');

  // E o papel novo já libera o acesso de gestão.
  assert.equal((await call('GET', '/courses/mine', { token: relogin.data.accessToken })).status, 200);
});

test('papel invalido e rejeitado pela validacao', async () => {
  const { status, data } = await call('PATCH', '/admin/users/00000000-0000-0000-0000-000000000000/role', {
    token: adminToken,
    body: { role: 'superusuario' },
  });
  assert.equal(status, 400);
  assert.ok(Array.isArray(data.error.details), 'o erro de validacao deve listar os campos');
});

test('admin nao pode remover o proprio acesso de administrador', async () => {
  const { data: me } = await call('GET', '/auth/me', { token: adminToken });
  const { status, data } = await call('PATCH', `/admin/users/${me.user.id}/role`, {
    token: adminToken,
    body: { role: 'student' },
  });
  assert.equal(status, 400);
  assert.match(data.error.message, /próprio acesso/);

  // O admin continua intacto depois da tentativa.
  const { data: depois } = await call('GET', '/auth/me', { token: adminToken });
  assert.equal(depois.user.role, 'admin');
});

test('o seed entrega exatamente uma conta de administrador', async () => {
  const { data } = await call('GET', '/admin/users?role=admin', { token: adminToken });
  assert.equal(data.users.length, 1, 'deve existir so o admin@learnup.dev');
  assert.equal(data.users[0].email, 'admin@learnup.dev');
});
