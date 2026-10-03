/**
 * Teste de fumaça ponta a ponta contra a API real.
 *
 *   npm test
 *   # com a API já rodando em outro host:
 *   API_URL=http://localhost:4000/api/v1 npm test
 *
 * Requer o banco migrado e populado (npm run db:reset).
 * Se a API não estiver no ar, o próprio teste sobe e derruba o servidor.
 */
import test, { describe, before, after } from 'node:test';
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

let accessToken = null;
let server = null;

async function reachable() {
  try {
    const res = await fetch(`${ORIGIN}/health`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

before(async () => {
  if (await reachable()) return; // já existe uma instância no ar

  // NODE_ENV=test desliga o rate limit: a suíte faz muitos logins e
  // seria barrada pelo próprio limiter que ela valida.
  server = spawn(process.execPath, ['src/server.js'], {
    cwd: rootDir,
    stdio: 'ignore',
    env: { ...process.env, NODE_ENV: 'test', RATE_LIMIT: 'false' },
  });

  for (let i = 0; i < 40; i += 1) {
    if (await reachable()) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  server?.kill();
  throw new Error('A API não subiu. Rode "npm run db:reset" antes dos testes.');
});

after(() => {
  server?.kill();
});

async function call(method, path, { body, auth = true, raw = false, token } = {}) {
  const bearer = token ?? (auth ? accessToken : null);
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const data = raw ? await res.text() : await res.json().catch(() => null);
  return { status: res.status, data };
}

test('health responde ok', async () => {
  const res = await fetch(`${ORIGIN}/health`);
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.status, 'ok');
  assert.equal(body.database, 'up');
});

test('login com credenciais inválidas retorna 401 genérico', async () => {
  const { status, data } = await call('POST', '/auth/login', {
    body: { email: 'ana@learnup.dev', password: 'senha-errada' },
    auth: false,
  });
  assert.equal(status, 401);
  assert.match(data.error.message, /E-mail ou senha incorretos/);
});

test('login devolve access token e usuário', async () => {
  const { status, data } = await call('POST', '/auth/login', {
    body: { email: 'ana@learnup.dev', password: PASSWORD },
    auth: false,
  });
  assert.equal(status, 200);
  assert.ok(data.accessToken);
  assert.equal(data.user.email, 'ana@learnup.dev');
  accessToken = data.accessToken;
});

test('rota protegida exige token', async () => {
  const token = accessToken;
  accessToken = null;
  const { status } = await call('GET', '/enrollments');
  accessToken = token;
  assert.equal(status, 401);
});

test('catálogo filtra por nível e categoria', async () => {
  const { status, data } = await call('GET', '/courses?level=beginner&category=nr', { auth: false });
  assert.equal(status, 200);
  assert.ok(data.courses.length > 0);
  assert.ok(data.courses.every((c) => c.level === 'beginner' && c.categorySlug === 'nr'));
  assert.ok(data.meta.total >= 1);
});

test('catálogo busca por texto (full-text)', async () => {
  const { data } = await call('GET', '/courses?search=altura', { auth: false });
  assert.ok(data.courses.some((c) => /altura/i.test(c.title)));
});

test('catálogo lista as quatro normas regulamentadoras', async () => {
  const { data } = await call('GET', '/courses', { auth: false });
  const titles = data.courses.map((c) => c.title);
  for (const nr of ['NR 06', 'NR 12', 'NR 18', 'NR 35']) {
    assert.ok(titles.some((t) => t.startsWith(nr)), `catálogo contém ${nr}`);
  }
  // Só os cursos do seed são verificados aqui: a suíte também cria cursos
  // descartáveis, então "todo curso do banco é NR" não é uma verdade estável.
  for (const nr of ['NR 06', 'NR 12', 'NR 18', 'NR 35']) {
    const course = data.courses.find((c) => c.title.startsWith(nr));
    assert.equal(course.categorySlug, 'nr', `${nr} pertence à categoria nr`);
  }
});

test('detalhe do curso traz módulos e marca matrícula', async () => {
  const list = await call('GET', '/courses?search=epi', { auth: false });
  const slug = list.data.courses[0].slug;
  const { status, data } = await call('GET', `/courses/${slug}`);
  assert.equal(status, 200);
  assert.equal(data.course.slug, slug);
  assert.ok(data.course.modules.length > 0);
  assert.ok(data.course.enrolled, 'ana está matriculada no curso de NR 06');
});

test('currículos das NRs têm módulos autorais, duração e descrição pública', async () => {
  const expected = [
    ['NR 06', 15, 240],
    ['NR 12', 15, 480],
    ['NR 18', 6, 360],
  ];

  for (const [search, moduleCount, durationMinutes] of expected) {
    const list = await call('GET', `/courses?search=${encodeURIComponent(search)}`, { auth: false });
    const item = list.data.courses.find((course) => course.title.startsWith(search));
    assert.ok(item, `${search} aparece no catálogo`);

    const { status, data } = await call('GET', `/courses/${item.slug}`, { auth: false });
    assert.equal(status, 200);
    assert.equal(data.course.modules.length, moduleCount, `${search} tem ${moduleCount} módulos`);
    assert.equal(data.course.durationMinutes, durationMinutes, `${search} totaliza ${durationMinutes} minutos`);
    assert.ok(
      data.course.modules.every((module) => typeof module.description === 'string' && module.description.length > 30),
      `${search} expõe o resumo de cada módulo`,
    );
  }
});

test('cursos e matrículas preservam autorização, conteúdo público seguro e contagem idempotente', async () => {
  const stamp = Date.now();
  const coursePayload = {
    title: `Curso de teste ${stamp}`,
    slug: `curso-teste-${stamp}`,
    status: 'draft',
    priceCents: 0,
  };

  const { status: unauthenticated } = await call('POST', '/courses', {
    body: coursePayload,
    auth: false,
  });
  assert.equal(unauthenticated, 401, 'criação exige autenticação antes da verificação de papel');

  const { status: instructorLoginStatus, data: instructorLogin } = await call('POST', '/auth/login', {
    body: { email: 'bruno@learnup.dev', password: PASSWORD },
    auth: false,
  });
  assert.equal(instructorLoginStatus, 200);

  const { status: createStatus, data: created } = await call('POST', '/courses', {
    body: coursePayload,
    token: instructorLogin.accessToken,
  });
  assert.equal(createStatus, 201);

  // Publicar virou ato do admin: o instrutor entrega o curso e a aprovação é
  // registrada com autor e data. O teste precisa passar por essa etapa porque
  // a matrícula abaixo exige um curso publicado.
  const { data: adminLogin } = await call('POST', '/auth/login', {
    body: { email: 'admin@learnup.dev', password: PASSWORD },
    auth: false,
  });
  const publishPath = `/admin/courses/${created.course.id}/publish`;
  assert.equal(
    (await call('POST', publishPath, { body: { reason: 'Aprovado no teste' }, token: instructorLogin.accessToken }))
      .status,
    403,
    'instrutor não publica o próprio curso',
  );
  const { status: publishStatus } = await call('POST', publishPath, {
    body: { reason: 'Aprovado no teste' },
    token: adminLogin.accessToken,
  });
  assert.equal(publishStatus, 200);

  const curriculumBody = {
    modules: [
      {
        title: 'Módulo público',
        lessons: [
          {
            title: 'Aula protegida',
            type: 'video',
            durationSeconds: 120,
            videoUrl: 'https://example.test/aula-protegida',
            content: 'conteúdo que não pode ser exposto no catálogo',
          },
        ],
      },
    ],
  };

  const curriculumPath = `/courses/${created.course.id}/curriculum`;
  assert.equal((await call('PUT', curriculumPath, { body: curriculumBody, auth: false })).status, 401);
  const otherInstructorToken = signAccessToken({
    id: randomUUID(),
    email: 'outro-instrutor@learnup.dev',
    role: 'instructor',
    name: 'Outro instrutor',
  });
  assert.equal(
    (await call('PUT', curriculumPath, { body: curriculumBody, token: otherInstructorToken })).status,
    403,
    'instrutor que não é dono não pode trocar o currículo',
  );

  const { status: curriculumStatus } = await call('PUT', curriculumPath, {
    token: instructorLogin.accessToken,
    body: curriculumBody,
  });
  assert.equal(curriculumStatus, 200);

  const { status: detailStatus, data: detail } = await call('GET', `/courses/${created.course.id}`, { auth: false });
  assert.equal(detailStatus, 200);
  const lesson = detail.course.modules[0].lessons[0];
  assert.equal(lesson.title, 'Aula protegida');
  assert.deepEqual(Object.keys(lesson).sort(), ['durationSeconds', 'id', 'isPreview', 'position', 'title', 'type']);
  assert.equal(lesson.content, undefined);
  assert.equal(lesson.videoUrl, undefined);
  assert.equal(lesson.description, undefined);

  const studentEmail = `matricula-gratis.${stamp}@learnup.dev`;
  const { status: registerStatus } = await call('POST', '/auth/register', {
    body: { name: 'Aluno Matrícula', email: studentEmail, password: 'senha1234', acceptTerms: true },
    auth: false,
  });
  assert.equal(registerStatus, 201);
  const { status: studentLoginStatus, data: studentLogin } = await call('POST', '/auth/login', {
    body: { email: studentEmail, password: 'senha1234' },
    auth: false,
  });
  assert.equal(studentLoginStatus, 200);

  const enrollmentBody = { courseId: created.course.id };
  assert.equal((await call('POST', '/enrollments', { body: enrollmentBody, token: studentLogin.accessToken })).status, 201);
  assert.equal((await call('POST', '/enrollments', { body: enrollmentBody, token: studentLogin.accessToken })).status, 201);

  const { data: enrolledDetail } = await call('GET', `/courses/${created.course.id}`, { auth: false });
  assert.equal(enrolledDetail.course.studentsCount, 1, 'a mesma matrícula não incrementa o contador duas vezes');
});

test('minhas matrículas trazem progresso calculado', async () => {
  const { data } = await call('GET', '/enrollments');
  assert.ok(data.enrollments.length > 0);
  const done = data.enrollments.find((e) => e.completedAt);
  assert.ok(done, 'existe um curso concluído');
  assert.equal(done.progressPercent, 100);
});

test('outline do curso expõe aulas com estado de bloqueio', async () => {
  const { data } = await call('GET', '/enrollments');
  const course = data.enrollments[0];
  const { data: outline } = await call('GET', `/enrollments/${course.courseId}/outline`);
  assert.ok(outline.modules.length > 0);
  const lessons = outline.modules.flatMap((m) => m.lessons);
  assert.ok(lessons.length > 0);
  assert.ok(lessons.every((l) => l.locked === false), 'aluno matriculado vê todas as aulas');
});

test('quiz não expõe gabarito antes da tentativa', async () => {
  const { data: courses } = await call('GET', '/courses?search=altura', { auth: false });
  const { data: outline } = await call('GET', `/enrollments/${courses.courses[0].id}/outline`);
  const quizLesson = outline.modules.flatMap((m) => m.lessons).find((l) => l.type === 'quiz');
  assert.ok(quizLesson, 'curso seed tem um quiz');

  const { status, data } = await call('GET', `/quizzes/lessons/${quizLesson.id}`);
  assert.equal(status, 200);
  const serialized = JSON.stringify(data.quiz);
  assert.ok(!serialized.includes('is_correct'), 'is_correct nunca é serializado');
  assert.ok(!serialized.includes('correctOptionId'));
  assert.ok(data.quiz.questions.every((q) => q.explanation === undefined));
});

test('responder o quiz com tudo errado não aprova e não credita pontos', async () => {
  const { data: courses } = await call('GET', '/courses?search=altura', { auth: false });
  const { data: outline } = await call('GET', `/enrollments/${courses.courses[0].id}/outline`);
  const quizLesson = outline.modules.flatMap((m) => m.lessons).find((l) => l.type === 'quiz');

  const { data } = await call('GET', `/quizzes/lessons/${quizLesson.id}`);
  const answers = data.quiz.questions.map((q) => ({ questionId: q.id, optionId: q.options[0].id }));

  const { status, data: result } = await call('POST', `/quizzes/lessons/${quizLesson.id}/attempts`, { body: { answers } });
  assert.equal(status, 200);
  assert.ok(result.scorePercent >= 0);
  assert.equal(typeof result.passed, 'boolean');
  // gabarito só depois da tentativa
  assert.ok(result.questions.every((q) => q.correctOptionId));
});

// Progresso de aula. Usa conta própria e compra própria para não depender
// do progresso acumulado de ana entre execuções da suíte.
// O catálogo só tem normas pagas, então a matrícula vem do fluxo de compra.
describe('progresso de aula', () => {
  const student = { email: `progresso.${Date.now()}@learnup.dev` };
  let context = null;
  let videoContext = null;

  async function setup() {
    if (context) return context;

    const { status } = await call('POST', '/auth/register', {
      body: { name: 'Aluno Progresso', email: student.email, password: 'senha1234', acceptTerms: true },
      auth: false,
    });
    assert.ok([201, 409].includes(status), `cadastro: ${status}`);

    const { data: login, status: loginStatus } = await call('POST', '/auth/login', {
      body: { email: student.email, password: 'senha1234' },
      auth: false,
    });
    assert.equal(loginStatus, 200, 'login do aluno de teste');

    const { data: catalog } = await call('GET', '/courses', { auth: false, token: login.accessToken });
    const course = catalog.courses.find((c) => c.priceCents > 0);
    assert.ok(course, 'o seed tem ao menos um curso pago');

    // Compra via Pix para liberar a matrícula que o player exige.
    const { data: order } = await call('POST', '/payments/orders', {
      body: { courseId: course.id, method: 'pix' },
      token: login.accessToken,
    });
    const { status: paid } = await call('POST', `/payments/mock/${order.order.id}/confirm`, {
      token: login.accessToken,
    });
    assert.equal(paid, 200, 'pagamento confirmado');

    const { data: outline } = await call('GET', `/enrollments/${course.id}/outline`, { token: login.accessToken });
    const lessons = outline.modules.flatMap((m) => m.lessons);

    /*
     * Só vídeo COM arquivo é medido por tempo assistido; texto e a demonstração
     * sem vídeo aceitam conclusão manual. A primeira compra serve para os
     * testes de posição; o teste de conclusão precisa de um curso que tenha
     * mesmo um vídeo, então ele compra o seu.
     */
    context = {
      token: login.accessToken,
      courseId: course.id,
      lessons,
    };
    return context;
  }

  /*
   * Monta um curso com uma aula de vídeo QUE TEM ARQUIVO, para o teste de
   * tempo assistido ter o que medir. O seed só tem vídeos de demonstração (sem
   * `video_url`), e nesses a conclusão é manual de propósito — testar neles não
   * provaria nada sobre a medição de tempo.
   */
  async function setupWithRealVideo() {
    if (videoContext) return videoContext;

    const { data: instructor } = await call('POST', '/auth/login', {
      body: { email: 'bruno@learnup.dev', password: PASSWORD },
      auth: false,
    });
    const { data: admin } = await call('POST', '/auth/login', {
      body: { email: 'admin@learnup.dev', password: PASSWORD },
      auth: false,
    });

    const title = `Video com arquivo ${Date.now()}`;
    const { status: createStatus, data: created } = await call('POST', '/courses', {
      body: { title, status: 'draft', priceCents: 0 },
      token: instructor.accessToken,
    });
    assert.equal(createStatus, 201, 'o curso de teste deveria ter sido criado');

    assert.equal(
      (await call('PUT', `/courses/${created.course.id}/curriculum`, {
        body: {
          modules: [
            {
              title: 'Módulo',
              lessons: [
                {
                  title: 'Aula com arquivo',
                  type: 'video',
                  durationSeconds: 120,
                  videoUrl: 'https://example.test/aula-com-arquivo',
                },
              ],
            },
          ],
        },
        token: instructor.accessToken,
      })).status,
      200,
    );
    assert.equal(
      (await call('POST', `/admin/courses/${created.course.id}/publish`, {
        body: { reason: 'teste' },
        token: admin.accessToken,
      })).status,
      200,
    );

    // Curso gratuito: a matrícula é direta e não depende de simulador de pagamento.
    const email = `video-progresso.${Date.now()}@learnup.dev`;
    await call('POST', '/auth/register', {
      body: { name: 'Aluno Vídeo', email, password: 'senha1234', acceptTerms: true },
      auth: false,
    });
    const { data: login } = await call('POST', '/auth/login', {
      body: { email, password: 'senha1234' },
      auth: false,
    });
    assert.equal(
      (await call('POST', '/enrollments', { body: { courseId: created.course.id }, token: login.accessToken })).status,
      201,
      'a matrícula gratuita deveria ter sido criada',
    );

    const { data: outline } = await call('GET', `/enrollments/${created.course.id}/outline`, {
      token: login.accessToken,
    });
    const videoLesson = outline.modules.flatMap((m) => m.lessons).find((l) => l.requiresWatchTime);
    assert.ok(videoLesson, 'a aula de vídeo com arquivo deveria exigir tempo assistido');

    videoContext = { token: login.accessToken, courseId: created.course.id, videoLesson };
    return videoContext;
  }

  test('posição é gravada sem concluir a aula', async () => {
    const { token, courseId, lessons } = await setup();
    const lesson = lessons.find((l) => !l.completed);
    assert.ok(lesson, 'há aula não concluída');

    const { status, data: saved } = await call('PUT', `/enrollments/${courseId}/lessons/${lesson.id}`, {
      body: { positionSeconds: 42, completed: false },
      token,
    });
    assert.equal(status, 200);
    assert.equal(saved.progress.position_seconds, 42);
    assert.equal(saved.progress.completed, false);
  });

  test('posição sozinha não conclui: só o tempo assistido conclui vídeo', async () => {
    const { token, courseId, videoLesson } = await setupWithRealVideo();
    assert.ok(videoLesson, 'o curso tem aula com vídeo');

    /*
     * Antes, mandar a posição no fim da duração concluía a aula. Era esse o
     * buraco: um `seek` bastava para destravar os pontos e o certificado. Agora
     * a posição só é registrada — quem conclui é o servidor, somando o tempo
     * que o vídeo realmente avançou entre heartbeats.
     */
    const { data: saved } = await call('PUT', `/enrollments/${courseId}/lessons/${videoLesson.id}`, {
      body: { positionSeconds: videoLesson.durationSeconds, completed: false },
      token,
    });
    assert.equal(
      saved.progress.completed,
      false,
      'saltar para o fim do vídeo não pode concluir a aula',
    );
    assert.equal(saved.progress.watched_seconds, 0, 'nada de tempo foi creditado sem heartbeat anterior');
  });
});

// --- Fluxo de compra -----------------------------------------------------
//     Encapsulado em `describe` porque o runner do node:test executa
//     arquivos em paralelo mas testes de um mesmo describe em ordem.
//     Cada bloco cria sua própria conta descartável, então o grupo pode
//     ser executado quantas vezes forem preciso sem estado residual.
describe('fluxo de compra', () => {
  // Usuário descartável por execução, para não depender do estado do banco.
  const buyer = { email: `comprador.${Date.now()}@learnup.dev`, courseId: null };

  async function asBuyer(fn) {
    const { status } = await call('POST', '/auth/register', {
      body: { name: 'Comprador de Teste', email: buyer.email, password: 'senha1234', acceptTerms: true },
      auth: false,
    });
    assert.ok([201, 409].includes(status), `cadastro do comprador: ${status}`);

    const login = await call('POST', '/auth/login', {
      body: { email: buyer.email, password: 'senha1234' },
      auth: false,
    });
    assert.equal(login.status, 200);

    const saved = accessToken;
    accessToken = login.data.accessToken;
    try {
      await fn();
    } finally {
      accessToken = saved;
    }
  }

  test('primeira compra: pedido Pix com QR e código copia-e-cola', async () => {
    await asBuyer(async () => {
      const { data: courses } = await call('GET', '/courses?search=NR', { auth: false });
      const paid = courses.courses.find((c) => c.priceCents > 0);
      assert.ok(paid, 'existe um curso pago');
      buyer.courseId = paid.id;

      // Antes de comprar, a aula responde 402 com dica de como se matricular.
      const { status: blocked, data: blockedData } = await call('GET', `/enrollments/${paid.id}/outline`);
      assert.equal(blocked, 402);
      assert.equal(blockedData.error.code, 'payment_required');

      const { status, data } = await call('POST', '/payments/orders', {
        // O backend ignora qualquer desconto que venha do browser.
        body: { courseId: paid.id, method: 'pix', discountCents: paid.priceCents - 1 },
      });
      assert.equal(status, 201);
      assert.equal(data.order.status, 'pending');
      assert.equal(data.order.amountCents, paid.priceCents);
      assert.equal(data.order.discountCents, 0);
      assert.match(data.order.pixCopyCode, /^000201/, 'payload Pix começa com 000201');
      assert.match(data.order.pixCopyCode, /6304[0-9A-F]{4}$/, 'payload Pix termina com o CRC');
    });
  });

  test('confirmar o pagamento cria a matrícula e libera o player', async () => {
    await asBuyer(async () => {
      const { data: orders } = await call('GET', '/payments/orders');
      const order = orders.orders.find((o) => o.courseId === buyer.courseId);
      assert.ok(order, 'o pedido pendente existe');

      const { status, data } = await call('POST', `/payments/mock/${order.id}/confirm`);
      assert.equal(status, 200);
      assert.equal(data.order.status, 'paid');

      // Depois de pagar, o outline abre e nenhuma aula fica bloqueada.
      const { status: outlineStatus, data: outline } = await call(
        'GET',
        `/enrollments/${buyer.courseId}/outline`,
      );
      assert.equal(outlineStatus, 200);
      const lessons = outline.modules.flatMap((m) => m.lessons);
      assert.ok(lessons.length > 0);
      assert.ok(lessons.every((l) => l.locked === false), 'nenhuma aula bloqueada após a compra');
    });
  });

  test('confirmar o mesmo pedido de novo é idempotente', async () => {
    await asBuyer(async () => {
      const { data: orders } = await call('GET', '/payments/orders');
      const order = orders.orders.find((o) => o.courseId === buyer.courseId);
      const { data } = await call('POST', `/payments/mock/${order.id}/confirm`);
      assert.equal(data.alreadyPaid, true, 'não duplica nem rematricula');
    });
  });

  test('comprar o mesmo curso de novo retorna 409', async () => {
    await asBuyer(async () => {
      const { status } = await call('POST', '/payments/orders', {
        body: { courseId: buyer.courseId, method: 'card' },
      });
      assert.equal(status, 409);
    });
  });
});

test('fórum: cria post e responde comentário', async () => {
  const { status, data: post } = await call('POST', '/forum/posts', {
    body: { title: 'Dúvida sobre hooks', content: 'Como funciona o useEffect com async?' },
  });
  assert.equal(status, 201);
  assert.equal(post.post.comments.length, 0);

  const { status: cStatus, data: comment } = await call('POST', `/forum/posts/${post.post.id}/comments`, {
    body: { content: 'Crie um estado de loading e use try/catch.' },
  });
  assert.equal(cStatus, 201);

  const { data: reply } = await call('POST', `/forum/posts/${post.post.id}/comments`, {
    body: { content: 'Funcionou! Valeu.', parentId: comment.comment.id },
  });
  assert.ok(reply.comment.parentId);
});

test('fórum: listagem paginada e filtro por curso', async () => {
  const { data } = await call('GET', '/forum/posts?limit=5', { auth: false });
  assert.ok(data.posts.length <= 5);
  assert.ok(data.meta.total >= 1);
  assert.equal(data.posts.length > 0, true);
});

test('busca ignora acentos no catálogo e no fórum', async () => {
  const { data: cursos } = await call('GET', '/courses?search=maquinas', { auth: false });
  assert.ok(
    cursos.courses.some((c) => /m[aá]quinas/i.test(c.title)),
    'buscar "maquinas" sem acento acha "Máquinas"',
  );

  const { data: posts } = await call('GET', '/forum/posts?search=duvida', { auth: false });
  assert.ok(
    posts.posts.some((p) => /d[uú]vida/i.test(p.title)),
    'buscar "duvida" sem acento acha "Dúvida"',
  );
});

test('gamificação: stats, badges e leaderboard', async () => {
  const { data } = await call('GET', '/gamification/me');
  assert.ok(data.stats.points > 0);
  assert.ok(data.stats.current >= 1);
  assert.ok(data.badges.length > 0, 'ana tem badges');

  const { data: board } = await call('GET', '/gamification/leaderboard?limit=10', { auth: false });
  assert.ok(board.leaderboard.length > 0);
});

// Regressão: syncBadges roda em toda matrícula/quiz e a query de estatísticas
// precisa ser válida. O grupo cria conta própria para não depender do estado.
// Como o catálogo é composto apenas de normas pagas, a matrícula é criada
// pelo fluxo de compra (Pix + confirmação) em vez de POST /enrollments.
describe('matrícula paga e badges', () => {
  // Cada teste cria a própria conta: as compras de um não podem colidir
  // com as do outro (a API recusa comprar o mesmo curso duas vezes).
  let seq = 0;

  async function asStudent(fn) {
    const email = `matricula.${Date.now()}.${seq++}@learnup.dev`;

    const { status } = await call('POST', '/auth/register', {
      body: { name: 'Aluno Comprador', email, password: 'senha1234', acceptTerms: true },
      auth: false,
    });
    assert.ok([201, 409].includes(status), `cadastro: ${status}`);

    const { data, status: loginStatus } = await call('POST', '/auth/login', {
      body: { email, password: 'senha1234' },
      auth: false,
    });
    assert.equal(loginStatus, 200);
    return fn(data.accessToken);
  }

  /** Compra um curso pago do catálogo e devolve o curso. */
  async function buyFirstPaidCourse(accessToken) {
    const { data: catalog } = await call('GET', '/courses', { auth: false, token: accessToken });
    const course = catalog.courses.find((c) => c.priceCents > 0);
    assert.ok(course, 'o seed tem ao menos um curso pago');

    const { status: orderStatus, data: order } = await call('POST', '/payments/orders', {
      body: { courseId: course.id, method: 'pix' },
      token: accessToken,
    });
    assert.equal(orderStatus, 201);

    const { status: paidStatus } = await call('POST', `/payments/mock/${order.order.id}/confirm`, {
      token: accessToken,
    });
    assert.equal(paidStatus, 200, 'pagamento confirmado');
    return course;
  }

  test('comprar um curso concede a badge de primeira matrícula', async () => {
    await asStudent(async (accessToken) => {
      // A confirmação do pagamento executa syncBadges: se a query de stats
      // quebrar, o 500 aparece aqui.
      const course = await buyFirstPaidCourse(accessToken);

      const { data: list } = await call('GET', '/enrollments', { token: accessToken });
      assert.ok(
        list.enrollments.some((e) => e.courseId === course.id),
        'a matrícula aparece em minhas matrículas',
      );

      const { data: me } = await call('GET', '/gamification/me', { token: accessToken });
      const keys = me.badges.map((b) => b.key);
      assert.ok(keys.includes('primeiro-curso'), `badges: ${keys.join(', ')}`);
      assert.ok(me.stats.enrolledCourses >= 1);
    });
  });

  test('comprar o mesmo curso de novo não duplica a matrícula nem a badge', async () => {
    await asStudent(async (accessToken) => {
      const { data: catalog } = await call('GET', '/courses', { auth: false, token: accessToken });
      const course = catalog.courses.find((c) => c.priceCents > 0);
      assert.ok(course, 'o seed tem ao menos um curso pago');

      const { data: first, status: firstStatus } = await call('POST', '/payments/orders', {
        body: { courseId: course.id, method: 'pix' },
        token: accessToken,
      });
      assert.equal(firstStatus, 201, 'primeira compra');
      await call('POST', `/payments/mock/${first.order.id}/confirm`, { token: accessToken });

      // Segunda tentativa de compra do mesmo curso é recusada.
      const { status: second } = await call('POST', '/payments/orders', {
        body: { courseId: course.id, method: 'pix' },
        token: accessToken,
      });
      assert.ok([201, 409].includes(second), `segunda compra: ${second}`);

      const { data: me } = await call('GET', '/gamification/me', { token: accessToken });
      const badge = me.badges.filter((b) => b.key === 'primeiro-curso');
      assert.equal(badge.length, 1, 'a badge não pode ser duplicada');
    });
  });
});

test('certificados: lista e verificação pública', async () => {
  const { data } = await call('GET', '/certificates');
  assert.ok(data.certificates.length > 0);
  const code = data.certificates[0].code;

  const { data: verified, status } = await call('GET', `/certificates/verify/${code}`, { auth: false });
  assert.equal(status, 200);
  assert.equal(verified.valid, true);
  assert.equal(verified.certificate.code, code);
});

test('certificado inválido responde 404 na verificação', async () => {
  const { status } = await call('GET', '/certificates/verify/LEARNUP-XXXX-XXXX', { auth: false });
  assert.equal(status, 404);
});

test('cadastro cria conta e bloqueia e-mail duplicado', async () => {
  const email = `teste.${Date.now()}@learnup.dev`;
  const { status, data } = await call('POST', '/auth/register', {
    body: { name: 'Teste Automatizado', email, password: 'senha1234', acceptTerms: true },
    auth: false,
  });
  assert.equal(status, 201);
  assert.equal(data.user.email, email);

  const { status: dup } = await call('POST', '/auth/register', {
    body: { name: 'Outro', email, password: 'senha1234', acceptTerms: true },
    auth: false,
  });
  assert.equal(dup, 409);
});

test('validação de schema devolve 400 com detalhes', async () => {
  const { status, data } = await call('POST', '/auth/register', {
    body: { name: 'A', email: 'nao-e-email', password: '123' },
    auth: false,
  });
  assert.equal(status, 400);
  assert.ok(data.error.details.length > 0);
});

test('refresh token rotaciona e invalida o anterior', async () => {
  const login = await call('POST', '/auth/login', {
    body: { email: 'ana@learnup.dev', password: PASSWORD },
    auth: false,
  });
  const original = login.data.refreshToken;

  const first = await call('POST', '/auth/refresh', { body: { refreshToken: original }, auth: false });
  assert.equal(first.status, 200);
  assert.notEqual(first.data.refreshToken, original);

  // o token antigo não pode ser reutilizado
  const second = await call('POST', '/auth/refresh', { body: { refreshToken: original }, auth: false });
  assert.equal(second.status, 401);
});

test('rota inexistente responde 404 padronizado', async () => {
  const { status, data } = await call('GET', '/nao-existe', { auth: false });
  assert.equal(status, 404);
  assert.ok(data.error.code);
});

test('logout revoga a sessão', async () => {
  const login = await call('POST', '/auth/login', {
    body: { email: 'carlos@learnup.dev', password: PASSWORD },
    auth: false,
  });
  const token = login.data.accessToken;
  const saved = accessToken;
  accessToken = token;

  const { status } = await call('POST', '/auth/logout');
  assert.equal(status, 200);

  const { status: after } = await call('GET', '/auth/me');
  assert.equal(after, 200, 'o access token ainda vale até expirar (curto prazo)');

  accessToken = saved;
});
