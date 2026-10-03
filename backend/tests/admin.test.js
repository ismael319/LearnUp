/**
 * Testes da governança administrativa: as oito frentes que o painel expõe.
 *
 *   1. cursos e transições        5. categorias e badges
 *   2. pedidos                    6. moderação
 *   3. matrículas e certificados   7. relatórios
 *   4. usuários (bloqueio)        8. configurações e auditoria
 *
 * Requer o banco migrado e populado (npm run db:reset).
 * Se a API não estiver no ar, o próprio teste sobe e derruba o servidor.
 *
 * O que estes testes tentam provar, em uma frase: as ações destrutivas ou
 * irreversíveis não deixam o sistema num estado que o admin não consiga
 * explicar depois. Por isso a maioria das asserções é sobre o estado
 * persistido (progresso preservado, certificado revogado, log escrito) e não
 * sobre o código de retorno.
 *
 * Todo cenário monta o próprio estado (curso novo, compra pelo provedor mock,
 * conta nova) em vez de depender de linhas específicas do seed, para que uma
 * mudança no seed não faça o teste passar sem verificar nada — e para que o
 * arquivo possa ser rodado várias vezes seguidas sem o estado anterior atrapalhar.
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = process.env.API_URL ?? 'http://localhost:4000/api/v1';
const ORIGIN = API.replace(/\/api\/v1\/?$/, '');
const PASSWORD = 'learnup123';
/** O banco recusa `limit` acima de 60; usar mais só produz um 400 silencioso. */
const MAX_LIMIT = 60;
const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const stamp = randomUUID().replace(/-/g, '').slice(0, 10);
const unique = (prefix) => `${prefix}${stamp}${randomUUID().replace(/-/g, '').slice(0, 4)}`;

let server = null;
let adminToken;
let adminId;
let instructorToken;
let studentToken;
let studentEmail;
let studentId;
let studentPassword;
let refundedOrderId = null;

async function reachable() {
  try {
    const res = await fetch(`${ORIGIN}/health`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

// Um único `before`: subir o servidor e autenticar as contas na mesma etapa.
// Com dois hooks separados o runner dispara os testes antes das contas existirem.
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

  adminToken = await loginAs('admin@learnup.dev');
  adminId = (await loginUser('admin@learnup.dev')).id;
  instructorToken = await loginAs('bruno@learnup.dev');

  studentEmail = `governanca.${stamp}@learnup.dev`;
  studentPassword = 'senha1234';
  studentToken = await registerStudent('Aluno Governança', studentEmail, studentPassword);
  studentId = (await loginUser(studentEmail, studentPassword)).id;
});

after(() => {
  server?.kill();
});

/** Sem `token`, a requisição sai anônima. `data` é o corpo já interpretado. */
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

const asAdmin = (method, path, body) => call(method, path, { token: adminToken, body });
const asStudent = (method, path, body) => call(method, path, { token: studentToken, body });

async function loginAs(email, password = PASSWORD) {
  const { status, data } = await call('POST', '/auth/login', { body: { email, password } });
  assert.equal(status, 200, `login de ${email} falhou`);
  return data.accessToken;
}

async function loginUser(email, password = PASSWORD) {
  const { status, data } = await call('POST', '/auth/login', { body: { email, password } });
  assert.equal(status, 200, `login de ${email} falhou`);
  return data.user;
}

/** Cadastra uma conta e devolve `{ token, user }`. */
async function createUser(name, email, password) {
  const { status, data } = await call('POST', '/auth/register', {
    body: { name, email, password, acceptTerms: true },
  });
  assert.equal(status, 201, `cadastro de ${email} falhou: ${JSON.stringify(data)}`);
  const token = await loginAs(email, password);
  return { token, user: (await loginUser(email, password)) };
}

const registerStudent = async (name, email, password) =>
  (await createUser(name, email, password)).token;

/** Curso novo do instrutor, para não mexer no catálogo do seed. */
async function newCourse(overrides = {}) {
  const { status, data } = await call('POST', '/courses', {
    token: instructorToken,
    body: {
      title: `Governança ${unique('')}`,
      status: 'draft',
      ...overrides,
    },
  });
  assert.equal(status, 201, `criação do curso falhou: ${JSON.stringify(data)}`);
  return data.course;
}

const transition = (courseId, action, reason) => asAdmin('POST', `/admin/courses/${courseId}/${action}`, { reason });

/** O instrutor pede publicação com um PATCH de status; não existe rota /submit. */
async function submitForReview(courseId) {
  const { status } = await call('PATCH', `/courses/${courseId}`, {
    token: instructorToken,
    body: { status: 'in_review' },
  });
  assert.equal(status, 200, 'o instrutor deveria conseguir pedir publicação');
}

const publishCourse = async (courseId) => {
  assert.equal((await transition(courseId, 'publish')).status, 200, 'o curso deveria ter publicado');
};

/** Compra real pelo provedor mock: pendente primeiro, pago na confirmação. */
async function checkout(courseId) {
  const { status, data } = await call('POST', '/payments/orders', {
    token: studentToken,
    body: { courseId, method: 'pix' },
  });
  assert.equal(status, 201, `checkout falhou: ${JSON.stringify(data)}`);
  return data.order;
}

async function payMock(orderId) {
  const { status, data } = await call('POST', `/payments/mock/${orderId}/confirm`, { token: studentToken });
  assert.equal(status, 200, `confirmação do mock falhou: ${JSON.stringify(data)}`);
  return data.order;
}

/** Matrícula direta: só existe em curso publicado e gratuito. */
async function enrollFree(courseId) {
  const { status, data } = await asStudent('POST', '/enrollments', { courseId });
  assert.equal(status, 201, `matrícula falhou: ${JSON.stringify(data)}`);
  return data.enrollment;
}

const courseStatus = async (courseId) => (await asAdmin('GET', `/admin/courses/${courseId}`)).data.course.status;

/** Último log de uma ação, para conferir o que a auditoria guardou. */
async function lastAudit(action) {
  const { data } = await asAdmin('GET', `/admin/audit-logs?action=${action}&limit=1`);
  return data.logs[0];
}

/**
 * A listagem admin busca por título (o `search` não cobre id), e o título de
 * cada curso do teste é único — então dá para achar a linha pelo título e
 * conferir o id, sem depender de a linha caber na primeira página.
 */
const courseRow = async (course) => {
  const { data } = await asAdmin(
    'GET',
    `/admin/courses?search=${encodeURIComponent(course.title)}&limit=${MAX_LIMIT}`,
  );
  return data.courses.find((c) => c.id === course.id);
};

const enrollmentOf = async (userId, courseId) => {
  const { data } = await asAdmin('GET', `/admin/enrollments?userId=${userId}&courseId=${courseId}`);
  return data.enrollments[0];
};

const certificateOf = async (userId, courseId) => {
  const { data } = await asAdmin('GET', `/admin/certificates?userId=${userId}&courseId=${courseId}&limit=${MAX_LIMIT}`);
  return data.certificates[0];
};

const pickQueue = async (resource, { seeded = 1 } = {}) => {
  const { data } = await asAdmin('GET', `/admin/${resource}?visibility=visible&limit=1`);
  assert.ok(data[resource].length, `o seed precisa ter ${resource} visível (ajuste --seeded em pickQueue)`);
  return data[resource][0];
};

// ===========================================================================
// 1. Cursos e transições
// ===========================================================================

test('instrutor pede publicação, admin aprova e o curso fica publicado', async () => {
  const course = await newCourse();
  assert.equal(course.status, 'draft');

  await submitForReview(course.id);
  assert.equal(await courseStatus(course.id), 'in_review');

  // Aprovar publica: o admin não precisa de um segundo clique.
  assert.equal((await transition(course.id, 'approve')).status, 200);
  assert.equal(await courseStatus(course.id), 'published');
});

test('devolver curso leva de in_review para draft', async () => {
  const course = await newCourse();
  await submitForReview(course.id);

  assert.equal((await transition(course.id, 'reject', 'Falta exercício prático')).status, 200);
  assert.equal(await courseStatus(course.id), 'draft');

  const log = await lastAudit('course.reject');
  assert.equal(log.entityId, course.id);
  assert.equal(log.after.reason, 'Falta exercício prático');
});

test('transicao impossivel devolve 409 e nao mexe no status', async () => {
  const course = await newCourse();

  // Não há como despublicar um rascunho: o status de origem não é `published`.
  const { status, data } = await transition(course.id, 'unpublish', 'teste');
  assert.equal(status, 409);
  assert.ok(data.error.message, 'o 409 precisa explicar por que a transição não vale');

  assert.equal(await courseStatus(course.id), 'draft');
});

test('auditoria da transicao registra quem decidiu e por que', async () => {
  const course = await newCourse();
  await transition(course.id, 'publish', 'Publicado para a turma de segunda');

  const log = await lastAudit('course.publish');
  assert.equal(log.entityId, course.id);
  assert.equal(log.actorId, adminId, 'a auditoria precisa dizer quem decidiu, não só o que sobrou');
  assert.equal(log.actorEmail, 'admin@learnup.dev');
  assert.match(log.summary, /Governança/);
  assert.equal(log.after.reason, 'Publicado para a turma de segunda');
});

test('arquivar esconde o curso do catálogo sem cancelar matrícula, e restaurar volta para rascunho', async () => {
  const course = await newCourse();
  await publishCourse(course.id);
  await enrollFree(course.id);

  assert.equal((await transition(course.id, 'archive', 'Conteúdo antigo')).status, 200);
  assert.equal(await courseStatus(course.id), 'archived');

  // Arquivar some do catálogo...
  const { data: catalog } = await call('GET', `/courses?search=${encodeURIComponent(course.id)}&limit=${MAX_LIMIT}`);
  assert.ok(!catalog.courses.some((c) => c.id === course.id), 'curso arquivado não pode aparecer no catálogo');

  // ...mas o aluno continua matriculado e com acesso.
  const enrollment = await enrollmentOf(studentId, course.id);
  assert.equal(enrollment.status, 'active', 'arquivar é esconder do catálogo, não expulsar o aluno');
  assert.equal((await asStudent('GET', `/enrollments/${course.id}/outline`)).status, 200);

  // Restore não devolve direto para publicado: passa de novo por revisão.
  assert.equal((await transition(course.id, 'restore')).status, 200);
  assert.equal(await courseStatus(course.id), 'draft');
});

test('excluir curso com matrícula é recusado e o erro aponta o arquivamento', async () => {
  const course = await newCourse();
  await publishCourse(course.id);
  await enrollFree(course.id);

  const { status, data } = await asAdmin('DELETE', `/admin/courses/${course.id}`);
  assert.equal(status, 409);
  assert.match(data.error.message, /matrícula/i);
  assert.match(data.error.message, /arquive/i, 'o erro precisa oferecer a alternativa segura');
  assert.equal((await asAdmin('GET', `/admin/courses/${course.id}`)).status, 200, 'o curso continua no banco');
});

test('excluir curso com pedido é recusado mesmo sem matrícula', async () => {
  // Regressão: a guarda existia só para matrículas. Um curso com pedido
  // aberto e nenhuma matrícula passava, e o pedido ficava sem curso.
  const course = await newCourse({ priceCents: 4900 });
  await publishCourse(course.id);
  const order = await checkout(course.id); // fica em `pending`: sem matrícula

  const row = await courseRow(course);
  assert.equal(row.studentsCount, 0, 'precondição do teste: nenhuma matrícula');
  assert.equal(row.orderCount, 1, 'a listagem precisa expor orderCount para a UI desabilitar o botão');

  const { status, data } = await asAdmin('DELETE', `/admin/courses/${course.id}`);
  assert.equal(status, 409);
  assert.match(data.error.message, /pedido/i);
  assert.equal((await asAdmin('GET', `/admin/orders/${order.id}`)).status, 200, 'o pedido sobrevive à recusa');
});

test('excluir curso sem histórico funciona e o motivo fica na auditoria', async () => {
  const course = await newCourse();
  const reason = `Curso de teste ${stamp}, criado por engano`;

  const { status } = await asAdmin('DELETE', `/admin/courses/${course.id}`, { reason });
  assert.equal(status, 200);
  assert.equal((await asAdmin('GET', `/admin/courses/${course.id}`)).status, 404);

  // A exclusão não tem volta: o motivo é a única pista sobre por que sumiu.
  const log = await lastAudit('course.delete');
  assert.equal(log.entityId, course.id);
  assert.equal(log.after.reason, reason);
  assert.match(log.summary, /excluído definitivamente/);
});

// ===========================================================================
// 2. Pedidos
// ===========================================================================

test('confirmar pedido pendente paga o pedido e cria a matrícula', async () => {
  const course = await newCourse({ priceCents: 3900 });
  await publishCourse(course.id);
  const order = await checkout(course.id);
  assert.equal(order.status, 'pending');

  assert.equal((await asAdmin('POST', `/admin/orders/${order.id}/confirm`)).status, 200);

  const { data } = await asAdmin('GET', `/admin/orders/${order.id}`);
  assert.equal(data.order.status, 'paid');
  assert.ok(data.order.paidAt, 'confirmar à mão precisa carimbar a data do pagamento');

  const enrollment = await enrollmentOf(studentId, course.id);
  assert.equal(enrollment.status, 'active', 'pagar é o que dá acesso ao curso');
});

test('cancelar pedido estorna sem devolver dinheiro e não cria matrícula', async () => {
  const course = await newCourse({ priceCents: 3900 });
  await publishCourse(course.id);
  const order = await checkout(course.id);

  assert.equal((await asAdmin('POST', `/admin/orders/${order.id}/cancel`, { reason: 'Comprador desistiu' })).status, 200);

  const { data } = await asAdmin('GET', `/admin/orders/${order.id}`);
  assert.equal(data.order.status, 'canceled');
  assert.equal(await enrollmentOf(studentId, course.id), undefined, 'pedido cancelado não dá acesso');

  const log = await lastAudit('order.cancel');
  assert.equal(log.after.reason, 'Comprador desistiu');
});

test('reembolso estorna o pedido, cancela o acesso e preserva o progresso', async () => {
  const course = await newCourse({ priceCents: 3900 });
  await publishCourse(course.id);
  const order = await checkout(course.id);
  await payMock(order.id);
  refundedOrderId = order.id;

  // Progresso real antes do reembolso, para comparar depois.
  const { data: outline } = await asStudent('GET', `/enrollments/${course.id}/outline`);
  const lesson = outline.modules?.flatMap((m) => m.lessons ?? [])[0];
  if (lesson) {
    await asStudent('POST', `/progress/lessons/${lesson.id}`, { positionSeconds: 120, isCompleted: true });
  }
  const before = await enrollmentOf(studentId, course.id);

  const reason = 'Comprador desistiu dentro do prazo de garantia';
  assert.equal((await asAdmin('POST', `/admin/orders/${order.id}/refund`, { reason })).status, 200);

  const { data: after } = await asAdmin('GET', `/admin/orders/${order.id}`);
  assert.equal(after.order.status, 'refunded');

  const enrollment = await enrollmentOf(studentId, course.id);
  assert.notEqual(enrollment.status, 'active', 'reembolso precisa tirar o acesso');
  assert.equal(
    enrollment.progressPercent,
    before.progressPercent,
    'reembolso não pode zerar o progresso: se a pessoa voltar, não recomeça',
  );
  // O status da linha não é o mesmo que o acesso: o curso precisa sair do
  // alcance da pessoa, senão o reembolso só muda um rótulo.
  assert.equal(
    (await asStudent('GET', `/enrollments/${course.id}/outline`)).status,
    403,
    'reembolsado não pode continuar abrindo as aulas',
  );

  const log = await lastAudit('order.refund');
  assert.equal(log.entityId, order.id);
  assert.equal(log.after.reason, reason);
});

test('reembolso repetido é recusado', async () => {
  // Depende do pedido reembolsado no teste anterior, e não do seed: assim o
  // cenário não depende de o banco já ter vindo sujo de uma execução passada.
  assert.ok(refundedOrderId, 'o teste anterior deveria ter reembolsado um pedido');

  const { status } = await asAdmin('POST', `/admin/orders/${refundedOrderId}/refund`, { reason: 'de novo' });
  assert.equal(status, 409, 'estornar duas vezes o mesmo pedido duplicaria o dinheiro');
});

// ===========================================================================
// 3. Matrículas e certificados
// ===========================================================================

test('cancelar matrícula tira o acesso e reativar devolve', async () => {
  const course = await newCourse();
  await publishCourse(course.id);
  const enrollment = await enrollFree(course.id);

  assert.equal((await asAdmin('POST', `/admin/enrollments/${enrollment.id}/cancel`, { reason: 'Solicitação do aluno' })).status, 200);
  assert.equal((await enrollmentOf(studentId, course.id)).status, 'canceled');
  assert.equal((await asStudent('GET', `/enrollments/${course.id}/outline`)).status, 403);

  assert.equal((await asAdmin('POST', `/admin/enrollments/${enrollment.id}/reactivate`)).status, 200);
  assert.equal((await enrollmentOf(studentId, course.id)).status, 'active');
  assert.equal((await asStudent('GET', `/enrollments/${course.id}/outline`)).status, 200);
});

test('certificado revogado carrega o motivo e restaurar limpa o motivo', async () => {
  const { data: certs } = await asAdmin('GET', `/admin/certificates?revoked=false&limit=${MAX_LIMIT}`);
  assert.ok(certs.certificates.length, 'nenhum certificado válido: o cenário não tem como rodar');

  const cert = certs.certificates[0];
  const reason = 'Emitido para aluno que não concluiu o módulo final';

  assert.equal((await asAdmin('PATCH', `/admin/certificates/${cert.id}`, { revoked: true, reason })).status, 200);

  const revoked = await certificateOf(cert.userId, cert.courseId);
  assert.equal(revoked.id, cert.id);
  assert.ok(revoked.revokedAt, 'o certificado precisa sair da lista de válidos');
  assert.equal(revoked.revokedReason, reason, 'o motivo precisa sobreviver para a tela e para a auditoria');

  // Restaurar limpa o motivo: um certificado válido não exibe a justificativa antiga.
  assert.equal((await asAdmin('PATCH', `/admin/certificates/${cert.id}`, { revoked: false })).status, 200);
  const back = await certificateOf(cert.userId, cert.courseId);
  assert.equal(back.revokedAt, null);
  assert.equal(back.revokedReason, null);
});

test('filtro de certificado separa válidos de revogados e some sem valor', async () => {
  // Regressão: `z.coerce.boolean()` tratava a string "false" como `true`, e o
  // filtro respondia exatamente o contrário do que a tela pedia.
  const { data: all } = await asAdmin('GET', `/admin/certificates?limit=${MAX_LIMIT}`);
  const { data: valid } = await asAdmin('GET', `/admin/certificates?revoked=false&limit=${MAX_LIMIT}`);
  const { data: revoked } = await asAdmin('GET', `/admin/certificates?revoked=true&limit=${MAX_LIMIT}`);

  assert.equal(
    valid.certificates.length + revoked.certificates.length,
    all.certificates.length,
    'sem o filtro, o total precisa ser a soma dos dois lados',
  );
  assert.ok(valid.certificates.every((c) => c.revokedAt === null), '`revoked=false` tem que devolver os válidos');
  assert.ok(revoked.certificates.every((c) => c.revokedAt !== null), '`revoked=true` tem que devolver os revogados');
});

// ===========================================================================
// 4. Usuários
// ===========================================================================

test('bloquear conta derruba o login e o token antigo, e o desbloqueio devolve o acesso', async () => {
  const { token, user } = await createUser('Aluno Bloqueio', `bloqueio.${unique('')}@learnup.dev`, 'senha1234');

  assert.equal((await asAdmin('POST', `/admin/users/${user.id}/block`, { reason: 'Teste de bloqueio' })).status, 200);

  // Bloqueio é visível: a API responde 403 `account_blocked` com o motivo, em
  // vez de disfarçar de senha errada — a pessoa precisa saber o que aconteceu
  // para procurar a administração.
  const blocked = await call('POST', '/auth/login', { body: { email: user.email, password: 'senha1234' } });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.data.error.code, 'account_blocked');
  assert.match(blocked.data.error.message, /bloqueada/i);

  // Senha errada, essa sim, não revela nada.
  const wrongPassword = await call('POST', '/auth/login', { body: { email: user.email, password: 'senhaerrada' } });
  assert.equal(wrongPassword.status, 401);
  assert.ok(
    !/bloqueada/i.test(wrongPassword.data.error.message),
    'senha errada não pode revelar que a conta existe e está bloqueada',
  );

  // Token emitido antes do bloqueio também deixa de valer: o `authenticate`
  // confere `blocked_at` a cada requisição, então não depende de expiração.
  const withOldToken = await call('GET', '/auth/me', { token });
  assert.equal(withOldToken.status, 403);
  assert.equal(withOldToken.data.error.code, 'account_blocked');

  assert.equal((await asAdmin('POST', `/admin/users/${user.id}/unblock`)).status, 200);
  assert.equal((await call('POST', '/auth/login', { body: { email: user.email, password: 'senha1234' } })).status, 200);
});

test('admin não pode bloquear a própria conta, e a plataforma nunca fica sem admin', async () => {
  // Autoexílio é erro do admin (400), não conflito de estado (409).
  const self = await asAdmin('POST', `/admin/users/${adminId}/block`, { reason: 'autoexílio' });
  assert.equal(self.status, 400);
  assert.match(self.data.error.message, /própria conta/i);

  // Havendo outro admin, bloquear um deles é legítimo: ainda sobra quem administre
  // a plataforma. O que não pode é o reverso — ficar sem nenhum.
  const { user: twin } = await createUser('Admin Reserva', `reserva.${unique('')}@learnup.dev`, 'senha1234');
  assert.equal((await asAdmin('PATCH', `/admin/users/${twin.id}/role`, { role: 'admin' })).status, 200);

  assert.equal((await asAdmin('POST', `/admin/users/${twin.id}/block`, { reason: 'teste' })).status, 200);

  // Busca por e-mail: a listagem vem paginada, e o admin que sobrou é do seed,
  // ou seja, não está entre as contas mais recentes.
  const { data } = await asAdmin('GET', `/admin/users?search=${encodeURIComponent('admin@learnup.dev')}`);
  assert.equal(data.users[0].id, adminId, 'o admin que resta tem que continuar ativo');
  assert.equal(data.users[0].role, 'admin');

  // Devolve o papel: a suíte de management afirma que o seed tem exatamente um
  // admin, e as duas suítes dividem o mesmo banco. Deixar um admin a mais aqui
  // faria ela falhar por uma mudança que este teste fez.
  assert.equal((await asAdmin('PATCH', `/admin/users/${twin.id}/role`, { role: 'student' })).status, 200);
});

test('reset de senha pelo admin permite a pessoa entrar com a senha nova', async () => {
  const { user } = await createUser('Aluno Reset', `reset.${unique('')}@learnup.dev`, 'senha1234');

  const nova = 'outrasenha123';
  assert.equal((await asAdmin('POST', `/admin/users/${user.id}/reset-password`, { password: nova })).status, 200);

  assert.equal((await call('POST', '/auth/login', { body: { email: user.email, password: 'senha1234' } })).status, 401);
  assert.equal((await call('POST', '/auth/login', { body: { email: user.email, password: nova } })).status, 200);
});

test('aluno comum não acessa nenhuma rota administrativa', async () => {
  for (const path of ['/admin/overview', '/admin/users', '/admin/orders', '/admin/audit-logs', '/admin/settings']) {
    assert.equal((await call('GET', path, { token: studentToken })).status, 403, `${path} não pode ser público`);
  }
});

// ===========================================================================
// 5. Categorias e badges
// ===========================================================================

test('categoria em uso não pode ser excluída, mas pode ser desvinculada em bloco', async () => {
  const name = `Segurança ${unique('')}`.slice(0, 78);
  const { status, data } = await asAdmin('POST', '/admin/categories', { name, icon: 'shield' });
  assert.equal(status, 201, JSON.stringify(data));
  const categoryId = data.category.id;

  const course = await newCourse({ categoryId });
  assert.equal((await courseRow(course)).categoryId, categoryId);

  const blocked = await asAdmin('DELETE', `/admin/categories/${categoryId}`);
  assert.equal(blocked.status, 409, 'apagar a categoria deixaria o curso sem classificação nenhuma');

  assert.equal((await asAdmin('POST', `/admin/categories/${categoryId}/uncategorize`)).status, 200);
  const row = await courseRow(course);
  assert.equal(row.categoryId, null, 'os cursos continuam existindo, só sem categoria');
  assert.equal((await asAdmin('DELETE', `/admin/categories/${categoryId}`)).status, 200);
});

test('badge sem descrição nem ícone é criado com os padrões, não quebra', async () => {
  // Regressão: as colunas são NOT NULL e o serviço mandava `null` explícito,
  // o que anulava o DEFAULT do banco e resultava em 500.
  const key = unique('sem_descricao_').slice(0, 40);
  const { status, data } = await asAdmin('POST', '/admin/badges', {
    key,
    name: `Conquista sem descrição ${unique('')}`.slice(0, 78),
    criteria: 'enrollments >= 1',
    points: 5,
  });
  assert.equal(status, 201, JSON.stringify(data));
  assert.equal(data.badge.description, '');
  assert.equal(data.badge.icon, '🏅');
  assert.equal((await asAdmin('DELETE', `/admin/badges/${data.badge.id}`)).status, 200);
});

test('badge concede pontos e retirar devolve os pontos', async () => {
  const { status, data } = await asAdmin('POST', '/admin/badges', {
    key: unique('teste_').slice(0, 40),
    name: `Conquista de teste ${unique('')}`.slice(0, 78),
    // Critério que este aluno não cumpre: com `enrollments >= 1` a sincronização
    // automática (`syncBadges`) já teria concedido a badge sozinha, e a
    // concessão manual viraria um no-op que não prova nada.
    criteria: 'quizzes_passed >= 10',
    points: 25,
  });
  assert.equal(status, 201, JSON.stringify(data));
  const badgeId = data.badge.id;

  const { data: before } = await asAdmin('GET', `/admin/users/${studentId}`);
  const pointsBefore = before.user.points;

  // Conceder cria uma linha em `user_badges`, então 201 é o status certo.
  assert.equal((await asAdmin('POST', `/admin/badges/${badgeId}/award`, {
    userId: studentId,
    reason: 'Critério cumprido manualmente',
  })).status, 201);

  const { data: after } = await asAdmin('GET', `/admin/users/${studentId}`);
  assert.equal(after.user.points, pointsBefore + 25, 'conceder badge soma pontos');

  const { data: badges } = await asAdmin('GET', '/admin/badges');
  assert.equal(badges.badges.find((b) => b.id === badgeId).awardedCount, 1);

  assert.equal((await asAdmin('POST', `/admin/badges/${badgeId}/revoke`, { userId: studentId })).status, 200);
  const { data: restored } = await asAdmin('GET', `/admin/users/${studentId}`);
  assert.equal(restored.user.points, pointsBefore, 'retirar badge devolve os pontos, senão o total só sobe');
});

test('badge com critério inválido é recusado com a lista dos válidos', async () => {
  const { status, data } = await asAdmin('POST', '/admin/badges', {
    key: unique('criterio_ruim_').slice(0, 40),
    name: 'Critério ruim',
    criteria: 'nunca_acontece >= 99',
  });
  assert.equal(status, 400);
  assert.ok(data.error.details?.length, 'a validação precisa explicar o que é válido');
});

// ===========================================================================
// 6. Moderação
// ===========================================================================

test('ocultar avaliação tira do público e reexibir devolve', async () => {
  const review = await pickQueue('reviews');

  assert.equal((await asAdmin('POST', `/admin/reviews/${review.id}/visibility`, {
    hidden: true,
    reason: 'Conteúdo com dado pessoal',
  })).status, 200);

  const { data: hidden } = await asAdmin('GET', `/admin/reviews?visibility=hidden&limit=${MAX_LIMIT}`);
  assert.ok(hidden.reviews.some((r) => r.id === review.id));

  // Oculto não aparece mais para o público.
  const { data: publicReviews } = await call('GET', `/courses/${review.courseId}/reviews`);
  assert.ok(
    !publicReviews.reviews.some((r) => r.id === review.id),
    'avaliação oculta não pode aparecer na página do curso',
  );

  assert.equal((await asAdmin('POST', `/admin/reviews/${review.id}/visibility`, { hidden: false })).status, 200);
  const { data: back } = await call('GET', `/courses/${review.courseId}/reviews`);
  assert.ok(back.reviews.some((r) => r.id === review.id), 'reexibir precisa devolver ao público');

  const log = await lastAudit('review.hide');
  assert.equal(log.entityId, review.id);
  assert.equal(log.after.reason, 'Conteúdo com dado pessoal');
});

test('ocultar post e comentário funciona nos dois sentidos', async () => {
  const post = await pickQueue('posts');
  assert.equal((await asAdmin('POST', `/admin/posts/${post.id}/visibility`, { hidden: true, reason: 'Off-topic' })).status, 200);

  const { data: hiddenPosts } = await asAdmin('GET', `/admin/posts?visibility=hidden&limit=${MAX_LIMIT}`);
  assert.ok(hiddenPosts.posts.some((p) => p.id === post.id));
  assert.equal((await asAdmin('POST', `/admin/posts/${post.id}/visibility`, { hidden: false })).status, 200);

  const comment = await pickQueue('comments');
  assert.equal((await asAdmin('POST', `/admin/comments/${comment.id}/visibility`, { hidden: true, reason: 'Agressão' })).status, 200);

  const { data: hiddenComments } = await asAdmin('GET', `/admin/comments?visibility=hidden&limit=${MAX_LIMIT}`);
  assert.ok(hiddenComments.comments.some((c) => c.id === comment.id));
  assert.equal((await asAdmin('POST', `/admin/comments/${comment.id}/visibility`, { hidden: false })).status, 200);
});

test('excluir item de moderação some do banco e fica registrado', async () => {
  const comment = await pickQueue('comments');

  assert.equal((await asAdmin('DELETE', `/admin/comments/${comment.id}`)).status, 200);

  const { data: after } = await asAdmin('GET', `/admin/comments?limit=${MAX_LIMIT}`);
  assert.ok(!after.comments.some((c) => c.id === comment.id), 'excluído não pode continuar na fila');

  const log = await lastAudit('comment.delete');
  assert.equal(log.entityId, comment.id);
});

// ===========================================================================
// 7. Relatórios
// ===========================================================================

test('relatório de receita fecha com a soma dos dias', async () => {
  const { status, data } = await asAdmin('GET', '/admin/reports/revenue?days=30');
  assert.equal(status, 200);

  const sum = data.series.reduce((total, day) => total + (day.revenueCents ?? 0), 0);
  assert.equal(data.totals.paidCents, sum, 'o total precisa ser a soma da série, não outra consulta');
  assert.ok(
    data.series.every((day) => !Number.isNaN(Date.parse(day.day))),
    'cada ponto precisa de um dia identificável para o eixo do gráfico',
  );
});

test('rankings e conclusão vêm envelopeados, com a lista dentro da chave', async () => {
  // A tela faz `data.courses.map(...)`: se a API devolveu o array solto, a
  // página quebra em tempo de render. O envelope é o contrato.
  const { data: courses } = await asAdmin('GET', '/admin/reports/top-courses');
  assert.ok(Array.isArray(courses.courses), 'top-courses precisa devolver { courses }');
  if (courses.courses.length) {
    assert.ok(
      courses.courses.every((c) => typeof c.revenueCents === 'number' && typeof c.students === 'number'),
    );
  }

  const { data: instructors } = await asAdmin('GET', '/admin/reports/top-instructors');
  assert.ok(Array.isArray(instructors.instructors), 'top-instructors precisa devolver { instructors }');

  const { data: completion } = await asAdmin('GET', '/admin/reports/completion');
  assert.ok(Array.isArray(completion.courses), 'completion precisa devolver { courses }');
  for (const course of completion.courses) {
    assert.ok(course.avgProgress >= 0 && course.avgProgress <= 100, 'progresso médio fora de 0..100');
    assert.ok(course.completed <= course.students, 'ninguém conclui mais vezes do que se matriculou');
  }
});

// ===========================================================================
// 8. Configurações e auditoria
// ===========================================================================

test('configuração salva e volta com o valor novo, e a auditoria guarda o antes e o depois', async () => {
  const { data: before } = await asAdmin('GET', '/admin/settings');
  assert.ok(Array.isArray(before.settings), 'a tela de configuração monta a lista a partir do array');
  const target = before.settings.find((s) => s.type === 'text');
  assert.ok(target, 'o seed precisa ter ao menos uma configuração de texto');

  // O valor precisa ser diferente do atual, senão `before` e `after` ficam
  // iguais e o teste passa sem provar nada.
  const original = String(target.value);
  const next = original === `Mensagem de teste ${stamp}` ? `${original} (2)` : `Mensagem de teste ${stamp}`;

  assert.equal((await asAdmin('PATCH', '/admin/settings', { [target.key]: next })).status, 200);

  const { data: after } = await asAdmin('GET', '/admin/settings');
  const saved = after.settings.find((s) => s.key === target.key);
  assert.equal(saved.value, next, 'a alteração tem que sobreviver a uma releitura');

  // A auditoria precisa saber de onde veio o valor, não só para onde ele foi.
  const log = await lastAudit('settings.update');
  assert.equal(log.before[target.key], original);
  assert.equal(log.after[target.key], next);

  // Restaura, para não deixar o painel em modo de manutenção.
  await asAdmin('PATCH', '/admin/settings', { [target.key]: original });
  const { data: restored } = await asAdmin('GET', '/admin/settings');
  assert.equal(restored.settings.find((s) => s.key === target.key).value, original);
});

test('validade informativa do certificado é pública, limitada e auditada', async () => {
  const { data: before } = await asAdmin('GET', '/admin/settings');
  const validity = before.settings.find((setting) => setting.key === 'certificate.validity_years');
  assert.ok(validity, 'o prazo precisa aparecer nas configurações do admin');
  assert.equal(validity.type, 'number');
  assert.equal(validity.min, 1);
  assert.equal(validity.max, 10);
  const original = Number(validity.value);

  try {
    const initialPublic = await call('GET', '/platform/settings');
    assert.equal(initialPublic.status, 200);
    assert.equal(Number(initialPublic.data.settings['certificate.validity_years']), original);

    assert.equal((await asAdmin('PATCH', '/admin/settings', { 'certificate.validity_years': 0 })).status, 400);
    assert.equal((await asAdmin('PATCH', '/admin/settings', { 'certificate.validity_years': 11 })).status, 400);
    assert.equal((await asAdmin('PATCH', '/admin/settings', { 'certificate.validity_years': 2 })).status, 200);

    const publicAfter = await call('GET', '/platform/settings');
    assert.equal(publicAfter.status, 200);
    assert.equal(publicAfter.data.settings['certificate.validity_years'], 2);

    const log = await lastAudit('settings.update');
    assert.equal(log.before['certificate.validity_years'], original);
    assert.equal(log.after['certificate.validity_years'], 2);
  } finally {
    await asAdmin('PATCH', '/admin/settings', { 'certificate.validity_years': original });
  }
});

test('auditoria filtra por ação e por tipo de objeto', async () => {
  const { data: byAction } = await asAdmin('GET', '/admin/audit-logs?action=course.publish&limit=5');
  assert.ok(byAction.logs.every((log) => log.action === 'course.publish'));

  const { data: byEntity } = await asAdmin('GET', '/admin/audit-logs?entityType=course&limit=5');
  assert.ok(byEntity.logs.every((log) => log.entityType === 'course'));

  // A lista de ações vem do backend: é ela que alimenta os filtros da tela.
  assert.ok(byAction.actions.some((a) => a.value === 'order.refund'));
  assert.ok(byAction.actions.every((a) => a.label), 'toda ação precisa de rótulo em português');
});

test('auditoria recusa ação fora do catálogo e pagina', async () => {
  assert.equal((await asAdmin('GET', '/admin/audit-logs?action=course.acionamento')).status, 400);

  const { data } = await asAdmin('GET', '/admin/audit-logs?limit=2');
  assert.equal(data.logs.length, 2);
  assert.ok(data.meta.totalPages >= 1);
  assert.equal(data.meta.hasPrev, false);
  assert.ok(data.meta.hasNext, 'com mais de dois registros no seed, a segunda página existe');
});

test('a busca da auditoria ignora acento', async () => {
  const { data: withAccent } = await asAdmin('GET', `/admin/audit-logs?search=${encodeURIComponent('conteúdo')}&limit=5`);
  const { data: withoutAccent } = await asAdmin('GET', '/admin/audit-logs?search=conteudo&limit=5');
  assert.equal(withAccent.logs.length, withoutAccent.logs.length);
});
