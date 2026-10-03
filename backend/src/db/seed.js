#!/usr/bin/env node
/**
 * Popula o banco com dados de demonstração.
 *   node src/db/seed.js          -> não apaga nada, upsert por e-mail/slug
 *   node src/db/seed.js --reset  -> apaga tudo antes (modo destrutivo)
 */
import bcrypt from 'bcryptjs';
import { query, queryOne, queryAll, closeDatabaseAndExit } from '../config/database.js';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { POINTS } from '../services/gamification.js';

const PASSWORD = 'learnup123';
// `settings` fica de fora de propósito: as linhas são configuração de plataforma,
// e o reset de dados de demonstração não deve apagar as preferências que alguém
// configurou no painel admin. A ressalva é que a exclusão não basta: ver
// `reset()`.
const TABLES = [
  'audit_logs', 'payment_events', 'orders', 'certificates', 'quiz_attempts', 'quiz_options', 'quiz_questions', 'quizzes',
  'lesson_progress', 'enrollments', 'comments', 'posts', 'reviews', 'lessons', 'modules', 'courses',
  'categories', 'user_badges', 'point_ledger', 'badges', 'refresh_tokens', 'users',
];

/**
 * Apaga os dados de negócio e devolve as configurações para as repôr.
 *
 * `settings` fica de fora de `TABLES`, mas isso não a protege: `settings.updated_by`
 * referencia `users` e o PostgreSQL percorre o `CASCADE` por TODAS as chaves
 * estrangeiras, independentemente da acção `ON DELETE` de cada uma. Ou seja,
 * truncar `users` apaga as configurações na mesma e o seed nunca as recriava —
 * o `node src/db/seed.js --reset` deixava a plataforma sem nome, sem assinatura e
 * sem `catalog.page_size`. Por isso são guardadas e devolvidas aqui.
 */
async function reset() {
  logger.warn('Apagando todos os dados...');
  const settings = await queryAll('SELECT key, value, updated_at FROM settings');
  await query(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`);
  return settings;
}

/** Repõe as configurações capturadas por `reset()`. `updated_by` fica nulo porque
 *  aponta para um utilizador que acabou de ser apagado. */
async function restoreSettings(rows) {
  if (rows.length === 0) return;
  for (const s of rows) {
    await query(
      `INSERT INTO settings (key, value, updated_at, updated_by) VALUES ($1, $2, $3, NULL)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
      [s.key, s.value, s.updated_at],
    );
  }
  logger.info(`${rows.length} configurações da plataforma repostas.`);
}

async function upsertUser({ name, email, role = 'student', bio = null, avatar = null }) {
  const hash = await bcrypt.hash(PASSWORD, config.auth.bcryptRounds);
  const { rows } = await query(
    `INSERT INTO users (name, email, password_hash, role, bio, avatar_url)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role
     RETURNING *`,
    [name, email, hash, role, bio, avatar],
  );
  return rows[0];
}

const CATEGORIES = [
  ['Normas Regulamentadoras', 'nr', '🛡️'],
];

const BADGES = [
  { key: 'primeiro-curso', name: 'Primeiro passo', description: 'Matriculou-se no primeiro curso.', icon: '🚀', points: 10, criteria: 'enrollments >= 1' },
  { key: 'primeira-conclusao', name: 'Conquistador', description: 'Concluiu seu primeiro curso.', icon: '🎓', points: 50, criteria: 'courses_completed >= 1' },
  { key: 'tres-cursos', name: 'Dedicado', description: 'Concluiu 3 cursos.', icon: '🔥', points: 80, criteria: 'courses_completed >= 3' },
  { key: 'dez-cursos', name: 'Mestre', description: 'Concluiu 10 cursos.', icon: '👑', points: 200, criteria: 'courses_completed >= 10' },
  { key: 'primeiro-quiz', name: 'Aprovado', description: 'Acertou um quiz.', icon: '✅', points: 20, criteria: 'quizzes_passed >= 1' },
  { key: 'dez-quizzes', name: 'Cerebral', description: 'Acertou 10 quizzes.', icon: '🧠', points: 100, criteria: 'quizzes_passed >= 10' },
  { key: 'mil-pontos', name: 'Em ascendência', description: 'Acumulou 1000 pontos.', icon: '⭐', points: 0, criteria: 'points >= 1000' },
  { key: 'semana-folgada', name: 'Semana perfeita', description: 'Estudou 7 dias seguidos.', icon: '📅', points: 40, criteria: 'streak_days >= 7' },
];

async function seedBadges() {
  for (const b of BADGES) {
    await query(
      `INSERT INTO badges (key, name, description, icon, points, criteria)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description,
                                       icon = EXCLUDED.icon, points = EXCLUDED.points,
                                       criteria = EXCLUDED.criteria`,
      [b.key, b.name, b.description, b.icon, b.points, b.criteria],
    );
  }
  logger.info(`${BADGES.length} badges sincronizados.`);
}

const studyModule = (title, description, minutes, { isPreview = false } = {}) => ({
  title,
  description,
  lessons: [
    {
      title: `Estudo aplicado: ${title}`,
      description,
      type: 'text',
      duration: minutes * 60,
      isPreview,
      content: `# ${title}\n\n${description}\n\n## Aplicação no trabalho\nAntes de iniciar a atividade, relacione a exigência normativa com o risco real, as barreiras disponíveis e a orientação que precisa chegar à equipe.\n\n## Resultado esperado\nAo concluir este estudo, você conseguirá reconhecer o tema, registrar evidências e tomar uma decisão segura na rotina de trabalho.`,
    },
  ],
});

const assessmentModule = (title, description, quizTitle) => ({
  title,
  description,
  lessons: [{ title: quizTitle, description, type: 'quiz' }],
});

const COURSES = [
  {
    title: 'NR 06 - EPI (4h)',
    subtitle: 'Seleção, fornecimento, uso e controle de Equipamentos de Proteção Individual',
    category: 'nr',
    level: 'beginner',
    priceCents: 16000,
    cover: '/img/nr06-epi.jpg',
    description:
      'A NR 06 é uma norma especial: não se limita a um setor ou atividade, e sim a qualquer trabalho em que exista risco ocupacional que exija proteção individual. Neste curso você entende as obrigações do empregador (fornecer, orientar, treinar, fiscalizar e substituir), os direitos e deveres do trabalhador, as categorias de EPI do Anexo I e como montar o controle documental que sustenta uma eventual fiscalização do Ministério do Trabalho.',
    modules: [
      studyModule('Panorama da proteção individual', 'Entenda onde a NR 06 se aplica, qual problema ela resolve e por que a proteção individual é sempre parte de uma estratégia maior.', 12, { isPreview: true }),
      studyModule('Risco e decisão de proteção', 'Aprenda a partir da avaliação de riscos e a justificar quando o EPI complementa medidas de eliminação, substituição e proteção coletiva.', 15),
      studyModule('Responsabilidades da empresa', 'Organize fornecimento, orientação, treinamento, fiscalização e reposição como um processo verificável, não como uma entrega isolada.', 18),
      studyModule('Participação do trabalhador', 'Reconheça os deveres de uso, guarda, comunicação de defeitos e recusa responsável diante de um equipamento inadequado.', 18),
      studyModule('Certificado de aprovação e rastreabilidade', 'Leia o CA, confira sua validade e mantenha registros que liguem cada equipamento ao risco e à pessoa que o utiliza.', 18),
      studyModule('Proteção para cabeça e face', 'Selecione capacetes, capuzes e protetores faciais de acordo com impacto, projeção de partículas, eletricidade e calor.', 18),
      studyModule('Proteção visual e auditiva', 'Compare óculos, viseiras, abafadores e plugues, considerando exposição, vedação, conforto e compatibilidade com outros equipamentos.', 18),
      studyModule('Proteção respiratória', 'Diferencie filtros, respiradores e situações que exigem avaliação técnica, ajuste facial e controle do ambiente.', 18),
      studyModule('Proteção das mãos e braços', 'Relacione luvas e mangotes aos riscos de corte, abrasão, calor, produtos químicos e eletricidade sem criar falsa sensação de segurança.', 18),
      studyModule('Proteção de pés e pernas', 'Escolha calçados, perneiras e proteções adequadas para impacto, perfuração, escorregamento, umidade e agentes químicos.', 18),
      studyModule('Proteção do corpo e contra quedas', 'Entenda vestimentas especiais, cinturões e talabartes como sistemas que precisam estar dimensionados para a atividade.', 18),
      studyModule('Compatibilidade entre equipamentos', 'Monte conjuntos de EPI que funcionem juntos, sem comprometer mobilidade, vedação, campo de visão ou acesso a comandos.', 18),
      studyModule('Inspeção antes do uso', 'Crie uma rotina simples para identificar desgaste, contaminação, peças ausentes e condições que exigem retirada imediata.', 18),
      studyModule('Higiene, guarda e reposição', 'Defina limpeza, armazenamento, vida útil e critérios de troca para que a proteção mantenha seu desempenho no dia a dia.', 15),
      assessmentModule('Avaliação final da NR 06', 'Revise decisões de fornecimento, uso e registro para consolidar a aplicação segura da proteção individual.', 'Quiz: obrigações na NR 06'),
    ],
  },
  {
    title: 'NR 12 - Máquinas e Equipamentos (8h)',
    subtitle: 'Ferramentas elétricas e manuais: proteções, bloqueio de energia e manutenção segura',
    category: 'nr',
    level: 'intermediate',
    priceCents: 14700,
    cover: '/img/nr12-maquinas.jpg',
    description:
      'A NR 12 é uma das normas mais extensas e exigidas do conjunto: ela disciplina todo o ciclo de vida das máquinas e equipamentos, do transporte à eliminação ao final da vida útil. O foco deste curso é o trabalho com ferramentas elétricas e manuais: identificação dos riscos, proteções fixas e móveis, dispositivos de parada de emergência, sinalização, bloqueio e etiquetagem de fontes de energia (LOTO) e o programa de manutenção.',
    modules: [
      studyModule('Escopo e organização da NR 12', 'Conheça o campo de aplicação da norma e organize responsabilidades desde a chegada da máquina até sua retirada de operação.', 24, { isPreview: true }),
      studyModule('Inventário de máquinas e análise de risco', 'Transforme o inventário em uma leitura prática de perigos, tarefas, pessoas expostas e controles já existentes.', 30),
      studyModule('Riscos mecânicos e zonas de perigo', 'Identifique pontos de esmagamento, corte, aprisionamento, projeção e arraste antes que a operação comece.', 36),
      studyModule('Proteções fixas', 'Avalie materiais, resistência, fixação e distâncias de segurança para impedir o acesso às partes perigosas.', 36),
      studyModule('Proteções móveis e intertravamentos', 'Entenda como portas, grades e chaves de segurança interrompem o risco quando precisam ser abertas.', 36),
      studyModule('Comandos e partida segura', 'Revise comandos de acionamento, rearme e sinalização para que uma máquina não reinicie de forma inesperada.', 36),
      studyModule('Parada de emergência', 'Diferencie parada de emergência, parada normal e dispositivos que isolam energia sem substituir outras barreiras.', 36),
      studyModule('Energia perigosa e LOTO', 'Planeje bloqueio, etiquetagem, teste de energia zero e liberação controlada antes de manutenção, limpeza ou ajuste.', 36),
      studyModule('Ferramentas elétricas portáteis', 'Inspecione cabos, plugs, discos, carcaças e acessórios para usar ferramentas elétricas sem improvisos.', 36),
      studyModule('Ferramentas manuais e inspeção', 'Escolha, conserve e descarte ferramentas manuais com foco em empunhadura, impacto, corte e projeção.', 36),
      studyModule('Operações de corte e abrasão', 'Controle faíscas, partículas, fixação da peça e postura em operações com serras, lixadeiras e esmerilhadeiras.', 36),
      studyModule('Ergonomia e organização do posto', 'Ajuste altura, alcance, iluminação, limpeza e fluxo de materiais para reduzir esforço e decisões inseguras.', 36),
      studyModule('Manutenção, limpeza e ajustes', 'Separe atividades de rotina de intervenções que exigem bloqueio, autorização e inspeção antes da partida.', 36),
      studyModule('Sinalização, registros e resposta a desvios', 'Documente inspeções e não conformidades, comunique desvios e saiba quando interromper uma atividade.', 30),
      assessmentModule('Avaliação final da NR 12', 'Valide decisões sobre proteções, parada de emergência e bloqueio de energia em situações de trabalho reais.', 'Quiz: proteções e bloqueio de energia'),
    ],
  },
  {
    title: 'NR 18 - Construção Civil (6h)',
    subtitle: 'Treinamento admissional, riscos do canteiro e planejamento da prevenção',
    category: 'nr',
    level: 'beginner',
    priceCents: 14700,
    cover: '/img/nr18-construcao.jpg',
    description:
      'A NR 18 estabelece diretrizes administrativas, de planejamento e de organização para a implementação de medidas de controle e sistemas preventivos na indústria da construção. Ela se aplica às atividades da seção F do CNAE e aos serviços de demolição, reparo, pintura, limpeza e manutenção de edifícios. Neste curso você conhece o PGR na prática, os riscos mais críticos do canteiro e a estrutura de treinamentos admissional e específicos por função.',
    modules: [
      studyModule('Planejamento e integração no canteiro', 'Organize a chegada da equipe, a leitura do canteiro e a comunicação das regras que protegem pessoas em atividades simultâneas.', 60, { isPreview: true }),
      studyModule('PGR e gestão de riscos na obra', 'Use o Programa de Gerenciamento de Riscos para ligar frentes de trabalho, perigos, controles, responsáveis e revisão contínua.', 75),
      studyModule('Áreas de vivência e circulação segura', 'Planeje acessos, sinalização, armazenamento, limpeza e áreas de apoio para reduzir quedas, atropelamentos e improvisos.', 75),
      studyModule('Proteções coletivas e proteção individual', 'Priorize guarda-corpos, proteções periféricas e outras barreiras coletivas antes de selecionar e fiscalizar o EPI.', 75),
      studyModule('Atividades críticas e controle operacional', 'Aplique permissões, inspeções e comunicação reforçada em altura, escavações, movimentação de materiais e frentes móveis.', 75),
      assessmentModule('Avaliação final da NR 18', 'Consolide o planejamento preventivo e as decisões de segurança que devem acompanhar toda atividade no canteiro.', 'Quiz: exigências da NR 18'),
    ],
  },
  {
    title: 'NR 35 - Trabalho em Alturas (6h)',
    subtitle: 'Análise de risco, permissão de trabalho e sistemas de proteção',
    category: 'nr',
    level: 'intermediate',
    priceCents: 16000,
    cover: '/img/nr35-alturas.jpg',
    description:
      'A NR 35 estabelece os requisitos mínimos e as medidas de proteção para o trabalho em altura. Ela se aplica tanto ao trabalhador que executa a tarefa quanto a quem supervisiona, e trata o trabalho em altura como planejamento, e não como improviso. Neste curso você aprende a distinguir atividade em altura de trabalho em altura, emitir a Permissão de Trabalho, escolher entre sistema de proteção coletiva e individual, organizar o resgate e cumprir as exigências de capacitação e recorrência.',
    modules: [
      {
        title: 'Conceitos e definição',
        lessons: [
          {
            title: 'Boas-vindas: o que é trabalho em altura',
            type: 'text',
            isPreview: true,
            content:
              '# Boas-vindas\n\nA NR 35 trata do **trabalho em altura**, atividade em que o trabalhador fica exposto a risco de queda. O conceito é sustentado por um critério simples e muito cobrado em fiscalização: **acima de 2,00 metros do piso**, onde não há proteção coletiva contra quedas.\n\nA norma se divide em dois blocos:\n\n- **Atividade em altura**: executar trabalho com exposição a queda, como passar por uma janela, trocar telha ou limpar fachada;\n- **Trabalho em altura**: a organização da atividade, com análise de risco, permissão, sistemas de proteção, plano de resgate e capacitação.\n\nÉ o segundo bloco que esta disciplina detalha.',
          },
          { title: 'Atividade em altura e trabalho em altura', type: 'video', duration: 2700, isPreview: true },
          { title: 'Análise de risco de trabalho em altura', type: 'video', duration: 3600 },
        ],
      },
      {
        title: 'Planejamento e permissão',
        lessons: [
          { title: 'Permissão de Trabalho em Altura', type: 'video', duration: 3300 },
          { title: 'Sistemas de proteção: coletiva e individual', type: 'video', duration: 3600 },
          { title: 'Planejamento do resgate', type: 'video', duration: 3000 },
        ],
      },
      {
        title: 'Capacitação e recorrência',
        lessons: [
          { title: 'Exigências de capacitação e periodicidade', type: 'video', duration: 2700 },
          { title: 'Checklist de campo antes de subir', type: 'video', duration: 2700 },
          { title: 'Quiz: requisitos da NR 35', type: 'quiz' },
        ],
      },
    ],
  },
];

const QUIZZES = {
  'Quiz: obrigações na NR 06': [
    {
      prompt: 'Qual documento registra a entrega do EPI ao trabalhador?',
      options: [
        ['A ficha de entrega assinada', true],
        ['O contrato de trabalho', false],
        ['A ordem de serviço', false],
        ['O recibo de pagamento', false],
      ],
      explanation:
        'A ficha de entrega assinada comprova o fornecimento e a orientação recebida. Sem ela, não há como demonstrar o cumprimento da obrigação em uma fiscalização.',
    },
    {
      prompt: 'A quem cabe treinar o trabalhador sobre o uso do EPI?',
      options: [
        ['Ao empregador', true],
        ['Apenas ao setor de RH', false],
        ['Ao dirigente da categoria', false],
        ['Ao fornecedor do equipamento', false],
      ],
      explanation:
        'Fornecer não basta: o empregador deve orientar e treinar, e registrar essa capacitação. A falta de registro de treinamento é um dos achados mais comuns em auditoria.',
    },
    {
      prompt: 'O que significa EPI?',
      options: [
        ['Equipamento de Proteção Individual', true],
        ['Equipamento de Proteção Coletiva', false],
        ['Equipamento de Prevenção Coletiva', false],
        ['Estação de Proteção Individual', false],
      ],
      explanation:
        'EPI é o Equipamento de Proteção Individual. Ele complementa o EPC e é a última barreira quando o risco não pode ser eliminado por proteção coletiva.',
    },
  ],
  'Quiz: proteções e bloqueio de energia': [
    {
      prompt: 'O que significa LOTO?',
      options: [
        ['Bloqueio e etiquetagem das fontes de energia', true],
        ['Lista de verificação da máquina', false],
        ['Limpeza da área de trabalho', false],
        ['Liberação da linha de produção', false],
      ],
      explanation:
        'LOTO vem do inglês lockout/tagout: é o conjunto de procedimentos para bloquear e etiquetar as fontes de energia antes de qualquer manutenção.',
    },
    {
      prompt: 'Para que serve uma proteção móvel?',
      options: [
        ['Impedir o acesso a zonas de perigo', true],
        ['Aumentar a velocidade da máquina', false],
        ['Reduzir o peso do conjunto', false],
        ['Substituir a parada de emergência', false],
      ],
      explanation:
        'A proteção móvel isola a zona de perigo durante o ciclo automático e abre o circuito de segurança quando acionada.',
    },
    {
      prompt: 'Antes de iniciar a manutenção, qual é a primeira providência?',
      options: [
        ['Bloquear e etiquetar as fontes de energia', true],
        ['Retirar as proteções da máquina', false],
        ['Avisar apenas o colega de turno', false],
        ['Aumentar a pressão do sistema', false],
      ],
      explanation:
        'Nenhuma manutenção começa sem bloqueio e etiquetagem. Retirar as proteções para facilitar o serviço é o que causa a maioria dos acidentes graves em máquinas.',
    },
  ],
  'Quiz: exigências da NR 18': [
    {
      prompt: 'A NR 18 se aplica a quais atividades?',
      options: [
        ['À seção F do CNAE e a serviços em edifícios', true],
        ['Somente a edifícios de até quatro pavimentos', false],
        ['Apenas ao saneamento básico', false],
        ['Somente à indústria de transformação', false],
      ],
      explanation:
        'A aplicação é mais ampla que a construção de edifícios: inclui urbanização, saneamento e os serviços de demolição, reparo, pintura, limpeza e manutenção.',
    },
    {
      prompt: 'O que a NR 18 exige antes do início da atividade?',
      options: [
        ['Planejar e documentar a prevenção, como o PGR', true],
        ['Apresentar a carteira de trabalho', false],
        ['Contratar seguro de responsabilidade civil', false],
        ['Instalar refeitório no canteiro', false],
      ],
      explanation:
        'A norma tem caráter organizacional: o risco precisa ser planejado e documentado antes de a atividade começar, e o documento deve ser conhecido por quem entra na obra.',
    },
    {
      prompt: 'Quando o treinamento admissional deve ser realizado?',
      options: [
        ['Antes do início da atividade', true],
        ['Até 48 horas após a admissão', false],
        ['Somente na auditoria anual', false],
        ['Quando o empregador julgar necessário', false],
      ],
      explanation:
        'O treinamento admissional é anterior ao início da atividade. O treinamento específico da função é adicional e não o substitui.',
    },
  ],
  'Quiz: requisitos da NR 35': [
    {
      prompt: 'A partir de qual altura se caracteriza trabalho em altura, sem proteção coletiva?',
      options: [
        ['2,00 metros', true],
        ['1,50 metro', false],
        ['3,00 metros', false],
        ['5,00 metros', false],
      ],
      explanation:
        'O critério é 2,00 metros do piso. Acima disso, sem proteção coletiva, o trabalho exige todo o planejamento da norma.',
    },
    {
      prompt: 'Qual a função da Permissão de Trabalho em Altura?',
      options: [
        ['Formalizar a análise de risco e as medidas de proteção', true],
        ['Substituir o plano de resgate', false],
        ['Autorizar a compra de equipamentos', false],
        ['Registrar a jornada do trabalhador', false],
      ],
      explanation:
        'A Permissão é emitida para cada trabalho e materializa a análise de risco. Não substitui outros documentos, como o plano de resgate.',
    },
    {
      prompt: 'Qual destas medidas é proteção coletiva contra queda?',
      options: [
        ['Guarda-corpo ou tela de proteção na área', true],
        ['Cinto de segurança amarrado ao poste', false],
        ['Capacete com jugular', false],
        ['Luva de raspa', false],
      ],
      explanation:
        'Proteção coletiva protege todos, independentemente de ação individual. O cinto é proteção individual e complementa, não substitui.',
    },
  ],
};

const FORUM_POSTS = [
  {
    user: 'ana@learnup.dev',
    courseTitle: 'NR 35 - Trabalho em Alturas (6h)',
    title: 'Como documentar a análise de risco antes da Permissão de Trabalho?',
    content:
      'Hoje a análise de risco e a Permissão de Trabalho são dois documentos separados, e o avaliador refaz o mesmo preenchimento toda semana. Vocês usam um documento único que sirva como análise e como permissão ao mesmo tempo?',
    comments: [
      ['carlos@learnup.dev', 'Unificamos em um formulário só. O que muda é o chaveamento: a permissão é por atividade e a análise é por local.'],
      ['bruno@learnup.dev', 'A dificuldade é a revisão. Travamos a análise por seis meses quando o local não muda.'],
      ['ana@learnup.dev', 'Vou propor a unificação na empresa, com chave por atividade.'],
    ],
  },
  {
    user: 'carlos@learnup.dev',
    courseTitle: 'NR 12 - Máquinas e Equipamentos (8h)',
    title: 'LOTO em painel com vários circuitos: chave geral ou individual?',
    content:
      'Nosso painel tem seis circuitos e uma chave geral. Para manutenção de um circuito só, travamos a geral e paramos a linha inteira. Vocês exigem chave individual por circuito já na projeto do painel?',
    comments: [
      ['dana@learnup.dev', 'No painel novo exigimos chave individual por circuito, com ponto de bloqueio identificado e etiquetado. A geral existe, mas não é usada para manutenção parcial.'],
      ['carlos@learnup.dev', 'Isso muda o projeto do painel. Vou levar para a próxima revisão de engenharia.'],
    ],
  },
  {
    user: 'ana@learnup.dev',
    title: 'Ficha de entrega de EPI: como vocês registram a troca por desgaste?',
    content:
      'A primeira entrega tem ficha assinada, mas as trocas por desgaste ficam só no caderno do almoxarifado. Sem registro, não há como provar que o capacete foi substituído na data correta. Como vocês resolvem isso?',
    comments: [
      ['bruno@learnup.dev', 'Registramos a troca com a devolução do item anterior e a assinatura da nova ficha.'],
      ['dana@learnup.dev', 'Outra opção é um formulário digital com foto do item novo e do devolvido no mesmo registro.'],
      ['carlos@learnup.dev', 'Foto ajuda na auditoria, mas o que tem valor é a assinatura. Digitalizem com assinatura reconhecida.'],
    ],
  },
];

/**
 * Perfil `base` — o mínimo que a plataforma precisa para funcionar: as contas de
 * operação, a categoria, os badges e o conteúdo dos cursos. Não cria clientes.
 *
 * `demoStats` controla os números de reputação dos cursos. No perfil `demo` eles
 * são inventados (notas e matrícula) para o catálogo não nascer vazio; no perfil
 * `clean` ficam a zero, que é a verdade — `courses/service.js` recalcula a média a
 * partir da tabela `reviews`, e sem avaliações a nota é zero.
 */
async function seedBase({ demoStats }) {
  // O admin é a conta de quem administra a plataforma. Não é dono de curso:
  // os cursos ficam com o instrutor (Bruno).
  const admin = await upsertUser({
    name: 'Equipe LearnUp',
    email: 'admin@learnup.dev',
    role: 'admin',
    bio: 'Conta administrativa da plataforma.',
  });

  const instructor = await upsertUser({
    name: 'Bruno Galvão',
    email: 'bruno@learnup.dev',
    role: 'instructor',
    bio: 'Engenheiro de segurança do trabalho, 12 anos como auditor de normas e instrutor.',
  });

  const categoryRows = await Promise.all(
    CATEGORIES.map(([name, slug, icon]) =>
      query(
        `INSERT INTO categories (name, slug, icon) VALUES ($1, $2, $3)
         ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, icon = EXCLUDED.icon RETURNING *`,
        [name, slug, icon],
      ).then((r) => r.rows[0]),
    ),
  );
  const catBySlug = Object.fromEntries(categoryRows.map((c) => [c.slug, c]));

  const courseRows = [];
  for (const [index, c] of COURSES.entries()) {
    const slug = c.title
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

    const durationMinutes = Math.round(
      c.modules.flatMap((m) => m.lessons).reduce((sum, l) => sum + (l.duration ?? 0), 0) / 60,
    );

    const { rows } = await query(
      `INSERT INTO courses
         (instructor_id, category_id, title, slug, subtitle, description, cover_url, level, status,
          price_cents, original_price_cents, duration_minutes, rating_avg, rating_count,
          students_count, published_at, certificate_enabled)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'published', $9, $10, $11, $12, $13, $14, now(), true)
       ON CONFLICT (slug) DO UPDATE
         SET title = EXCLUDED.title, description = EXCLUDED.description,
             price_cents = EXCLUDED.price_cents, cover_url = EXCLUDED.cover_url,
             duration_minutes = EXCLUDED.duration_minutes, status = 'published',
             rating_avg = EXCLUDED.rating_avg, rating_count = EXCLUDED.rating_count,
             students_count = EXCLUDED.students_count
       RETURNING *`,
      [
        instructor.id,
        catBySlug[c.category].id,
        c.title,
        slug,
        c.subtitle,
        c.description,
        c.cover,
        c.level,
        c.priceCents,
        c.originalPriceCents ?? null,
        durationMinutes,
        demoStats ? (4.2 + index * 0.2).toFixed(2) : 0,
        demoStats ? 12 + index * 7 : 0,
        demoStats ? 40 + index * 31 : 0,
      ],
    );
    const course = rows[0];
    courseRows.push({ ...course, def: c });

    const existingModules = await queryOne('SELECT count(*)::int AS n FROM modules WHERE course_id = $1', [course.id]);
    if (existingModules.n > 0) continue;

    for (const [mi, mod] of c.modules.entries()) {
      const { rows: mRows } = await query(
        `INSERT INTO modules (course_id, title, description, position) VALUES ($1, $2, $3, $4) RETURNING id`,
        [course.id, mod.title, mod.description ?? null, mi + 1],
      );

      for (const [li, lesson] of mod.lessons.entries()) {
        const { rows: lRows } = await query(
          `INSERT INTO lessons (module_id, title, description, type, position, duration_seconds, content, is_preview)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
          [
            mRows[0].id,
            lesson.title,
            lesson.description ?? null,
            lesson.type ?? 'video',
            li + 1,
            lesson.duration ?? 0,
            lesson.content ?? null,
            lesson.isPreview ?? false,
          ],
        );

        if (lesson.type === 'quiz' && QUIZZES[lesson.title]) {
          const { rows: qRows } = await query(
            `INSERT INTO quizzes (lesson_id, title, pass_percent, max_attempts, points_reward)
             VALUES ($1, $2, 70, 0, 25) RETURNING id`,
            [lRows[0].id, lesson.title],
          );
          for (const [qi, q] of QUIZZES[lesson.title].entries()) {
            const { rows: qRows2 } = await query(
              `INSERT INTO quiz_questions (quiz_id, prompt, explanation, position) VALUES ($1, $2, $3, $4)
               RETURNING id`,
              [qRows[0].id, q.prompt, q.explanation, qi + 1],
            );
            for (const [oi, [label, isCorrect]] of q.options.entries()) {
              await query(
                `INSERT INTO quiz_options (question_id, label, is_correct, position)
                 VALUES ($1, $2, $3, $4)`,
                [qRows2[0].id, label, isCorrect, oi + 1],
              );
            }
          }
        }
      }
    }
  }
  logger.info(`${courseRows.length} cursos com currículo completo.`);
  return { admin, instructor, courseRows };
}

/**
 * Perfil `demo` — clientes fictícios, para as telas nascerem com conteúdo em vez
 * de vazias. Só entra no caminho de demonstração e dos testes: num ambiente real
 * não há Ana, nem Carlos, nem compras Made-up.
 */
async function seedDemo({ admin, instructor, courseRows }) {
  const students = await Promise.all([
    upsertUser({ name: 'Ana Souza', email: 'ana@learnup.dev', bio: 'Técnica em segurança do trabalho.' }),
    upsertUser({ name: 'Carlos Lima', email: 'carlos@learnup.dev', bio: 'Eletricista predial.' }),
    upsertUser({ name: 'Dana Reis', email: 'dana@learnup.dev', bio: 'Engenheira civil, obra residencial.' }),
    upsertUser({
      name: 'Visitante Externo',
      email: 'visitante@learnup.dev',
      bio: 'Conta de demonstração (visitante).',
    }),
  ]);

  // --- Matrículas, progresso, certificados, quizzes ----------------------
  const [ana, carlos, dana] = students;
  const nr06 = courseRows.find((c) => c.title.startsWith('NR 06'));
  const nr12 = courseRows.find((c) => c.title.startsWith('NR 12'));
  const nr18 = courseRows.find((c) => c.title.startsWith('NR 18'));
  const nr35 = courseRows.find((c) => c.title.startsWith('NR 35'));

  async function enroll(userId, course, { completeAll = false, partial = 0 } = {}) {
    const { rows } = await query(
      `INSERT INTO enrollments (user_id, course_id) VALUES ($1, $2)
       ON CONFLICT (user_id, course_id) DO NOTHING RETURNING id`,
      [userId, course.id],
    );
    const enrollmentId = rows[0]?.id;
    if (!enrollmentId) {
      const existing = await queryOne('SELECT id FROM enrollments WHERE user_id = $1 AND course_id = $2', [
        userId,
        course.id,
      ]);
      return existing.id;
    }

    const { rows: lessons } = await query(
      `SELECT l.id, l.duration_seconds FROM lessons l
         JOIN modules m ON m.id = l.module_id WHERE m.course_id = $1
        ORDER BY m.position, l.position`,
      [course.id],
    );

    const total = completeAll ? lessons.length : Math.min(partial, lessons.length);
    for (const lesson of lessons.slice(0, total)) {
      await query(
        `INSERT INTO lesson_progress (enrollment_id, lesson_id, position_seconds, completed, completed_at, last_watched_at)
         VALUES ($1, $2, $3, true, now(), now()) ON CONFLICT DO NOTHING`,
        [enrollmentId, lesson.id, lesson.duration_seconds],
      );
      await query(
        `INSERT INTO point_ledger (user_id, points, reason, ref_type, ref_id)
         VALUES ($1, $2, 'lesson.completed', 'lesson', $3) ON CONFLICT DO NOTHING`,
        [userId, POINTS['lesson.completed'], lesson.id],
      );
    }
    await query('UPDATE users SET points = points + $1 WHERE id = $2', [
      total * POINTS['lesson.completed'],
      userId,
    ]);

    if (completeAll) {
      await query('UPDATE enrollments SET completed_at = now() WHERE id = $1', [enrollmentId]);
      await query('UPDATE users SET points = points + $1 WHERE id = $2', [
        POINTS['course.completed'],
        userId,
      ]);
    }
    return enrollmentId;
  }

  if (nr06) {
    await enroll(ana.id, nr06, { completeAll: true });
    await enroll(carlos.id, nr06, { partial: 3 });
  }
  if (nr12) {
    await enroll(carlos.id, nr12, { completeAll: true });
    await enroll(dana.id, nr12, { partial: 2 });
  }
  if (nr18) await enroll(dana.id, nr18, { completeAll: true });
  if (nr35) {
    await enroll(ana.id, nr35, { partial: 3 });
    await enroll(carlos.id, nr35, { completeAll: true });
  }

  // Tentativas de quiz aprovadas (com pontos) para a área do aluno.
  const quizRows = await query(
    `SELECT q.id, q.points_reward, l.title, m.course_id FROM quizzes q
       JOIN lessons l ON l.id = q.lesson_id JOIN modules m ON m.id = l.module_id`,
  );
  for (const [user, quiz] of [
    [ana, quizRows.rows.find((q) => q.title === 'Quiz: obrigações na NR 06')],
    [carlos, quizRows.rows.find((q) => q.title === 'Quiz: proteções e bloqueio de energia')],
    [dana, quizRows.rows.find((q) => q.title === 'Quiz: exigências da NR 18')],
    [carlos, quizRows.rows.find((q) => q.title === 'Quiz: requisitos da NR 35')],
  ]) {
    if (!quiz) continue;
    const enrolled = await queryOne('SELECT 1 FROM enrollments WHERE user_id = $1 AND course_id = $2', [
      user.id,
      quiz.course_id,
    ]);
    if (!enrolled) continue;

    const { rows } = await query(
      `INSERT INTO quiz_attempts (quiz_id, user_id, score_percent, passed, answers, points_awarded)
       VALUES ($1, $2, 100, true, '[]'::jsonb, $3)
       ON CONFLICT DO NOTHING RETURNING id`,
      [quiz.id, user.id, quiz.points_reward],
    );
    if (rows[0]) {
      await query('UPDATE users SET points = points + $1 WHERE id = $2', [quiz.points_reward, user.id]);
      await query(
        `INSERT INTO point_ledger (user_id, points, reason, ref_type, ref_id)
         VALUES ($1, $2, 'quiz.passed', 'quiz_attempt', $3) ON CONFLICT DO NOTHING`,
        [user.id, quiz.points_reward, rows[0].id],
      );
    }
  }

  // Certificados para quem concluiu.
  for (const [user, course] of [
    [ana, nr06],
    [carlos, nr12],
    [carlos, nr35],
    [dana, nr18],
  ]) {
    if (!course) continue;
    const { rows } = await query(
      `INSERT INTO certificates (user_id, course_id, code, final_score)
       VALUES ($1, $2, 'LEARNUP-DEMO-' || upper(substr(md5(random()::text), 1, 6)), 100)
       ON CONFLICT (user_id, course_id) DO NOTHING RETURNING id`,
      [user.id, course.id],
    );
    logger.debug({ user: user.email, course: course.title, issued: rows.length > 0 });
  }

  // Badges: concede o que já coube.
  for (const student of students) {
    const stats = await queryOne(
      `SELECT
         (SELECT count(*) FROM enrollments e WHERE e.user_id = $1)::int AS enrolled,
         (SELECT count(*) FROM enrollments e WHERE e.user_id = $1 AND e.completed_at IS NOT NULL)::int AS completed,
         (SELECT count(*) FROM quiz_attempts qa WHERE qa.user_id = $1 AND qa.passed)::int AS quizzesPassed,
         (SELECT points FROM users WHERE id = $1) AS points,
         (SELECT streak_days FROM users WHERE id = $1) AS streakDays`,
      [student.id],
    );

    const earned = BADGES.filter(({ criteria }) =>
      [
        ['enrollments >= 1', stats.enrolled >= 1],
        ['courses_completed >= 1', stats.completed >= 1],
        ['quizzes_passed >= 1', stats.quizzesPassed >= 1],
        ['points >= 1000', stats.points >= 1000],
      ].some(([rule, ok]) => rule === criteria && ok),
    );

    for (const badge of earned) {
      const row = await queryOne('SELECT id FROM badges WHERE key = $1', [badge.key]);
      const { rows } = await query(
        `INSERT INTO user_badges (user_id, badge_id) VALUES ($1, $2)
         ON CONFLICT (user_id, badge_id) DO NOTHING RETURNING id`,
        [student.id, row.id],
      );
      if (rows[0] && badge.points > 0) {
        await query('UPDATE users SET points = points + $1 WHERE id = $2', [badge.points, student.id]);
      }
    }
  }

  // --- Fórum ------------------------------------------------------------
  const userByEmail = Object.fromEntries(
    [instructor, ...students].map((u) => [u.email, u]),
  );
  const courseByTitle = Object.fromEntries(courseRows.map((c) => [c.def.title, c]));

  for (const p of FORUM_POSTS) {
    const author = userByEmail[p.user];
    const course = p.courseTitle ? courseByTitle[p.courseTitle] : null;
    const { rows } = await query(
      `INSERT INTO posts (user_id, course_id, title, content, views_count) VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [author.id, course?.id ?? null, p.title, p.content, 20 + Math.floor(Math.random() * 300)],
    );
    await query('UPDATE users SET points = points + $1 WHERE id = $2', [POINTS['forum.post.created'], author.id]);

    for (const [email, content] of p.comments) {
      await query(`INSERT INTO comments (post_id, user_id, content) VALUES ($1, $2, $3)`, [
        rows[0].id,
        userByEmail[email].id,
        content,
      ]);
    }
  }

  // --- Pedidos, avaliações e moderação -------------------------------------
  //
  // Pedidos casam com matrículas que já existem. Sem eles, as telas de pedidos,
  // reembolso e o relatório de receita nasceriam vazios — e um relatório vazio
  // não é um bug visível, o que é pior.
  //
  // As datas são recuadas de propósito: com tudo em `now()`, a série de 30 dias
  // vira um único pico e o gráfico não mostra nada que parece real.
  const METHODS = ['pix', 'card', 'paypal'];

  const pendingEnrollments = await queryAll(
    `SELECT e.id, e.user_id, e.course_id, c.price_cents, c.title, e.status
       FROM enrollments e JOIN courses c ON c.id = e.course_id
      WHERE e.order_id IS NULL
      ORDER BY e.enrolled_at`,
  );

  let daysAgo = 52;
  for (const enrollment of pendingEnrollments) {
    // Espaçamento determinístico: o seed roda várias vezes e os gráficos devem
    // ficar iguais entre elas, não mudarem a cada `npm run seed`.
    const offset = (daysAgo % 9) + 2;
    daysAgo -= offset;
    const at = new Date(Date.now() - offset * 24 * 60 * 60 * 1000);
    const method = METHODS[pendingEnrollments.indexOf(enrollment) % METHODS.length];

    await query('UPDATE enrollments SET enrolled_at = $2 WHERE id = $1', [enrollment.id, at]);
    const { rows } = await query(
      `INSERT INTO orders (user_id, course_id, amount_cents, method, status, provider, provider_ref, paid_at, created_at)
       VALUES ($1, $2, $3, $4, 'paid', 'mock', $5, $6, $6) RETURNING id`,
      [
        enrollment.user_id,
        enrollment.course_id,
        enrollment.price_cents,
        method,
        `mock-seed-${enrollment.id.slice(0, 8)}`,
        at,
      ],
    );
    await query('UPDATE enrollments SET order_id = $2 WHERE id = $1', [enrollment.id, rows[0].id]);
  }
  logger.info(`${pendingEnrollments.length} pedidos pagos casando com as matrículas.`);

  // Um checkout abandonado e um reembolso já processado: os dois estados que a
  // tela de pedidos precisa mostrar para o admin saber o que fazer.
  //
  // Os cursos são escolhidos por NÃO estarem nas matrículas desses alunos: um
  // pedido pendente para quem já está matriculado seria um estado impossível.
  if (ana && nr12) {
    await query(
      `INSERT INTO orders (user_id, course_id, amount_cents, method, status, provider, created_at)
       VALUES ($1, $2, $3, 'pix', 'pending', 'mock', now() - interval '2 days')
       ON CONFLICT DO NOTHING`,
      [ana.id, nr12.id, nr12.price_cents],
    );
  }

  if (dana && nr35) {
    const refundedAt = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);
    const { rows } = await query(
      `INSERT INTO orders (user_id, course_id, amount_cents, method, status, provider, provider_ref, paid_at, created_at)
       VALUES ($1, $2, $3, 'card', 'refunded', 'mock', $4, $5, $5)
       ON CONFLICT DO NOTHING RETURNING id`,
      [dana.id, nr35.id, nr35.price_cents, `mock-seed-refund-${dana.id.slice(0, 8)}`, refundedAt],
    );
    // Reembolso cancela a matrícula e revoga o certificado, mas preserva o
    // progresso — é o estado que a refundOrder() produz e que a ficha do aluno
    // precisa refletir.
    if (rows[0]) {
      const { rows: enr } = await query(
        `INSERT INTO enrollments (user_id, course_id, order_id, status, canceled_at, cancel_reason, enrolled_at)
         VALUES ($1, $2, $3, 'refunded', $4, 'Reembolso processado pelo admin (demonstração).', $4)
         ON CONFLICT (user_id, course_id) DO NOTHING RETURNING id`,
        [dana.id, nr35.id, rows[0].id, refundedAt],
      );
      if (enr[0]) {
        await query(
          `UPDATE certificates SET revoked_at = $2, revoked_reason = $3
            WHERE user_id = $1 AND course_id = $4 AND revoked_at IS NULL`,
          [dana.id, refundedAt, 'Reembolso processado pelo admin (demonstração).', nr35.id],
        );
      }
    }
  }

  // Avaliações com uma já ocultada, para a tela de moderação abrir com trabalho
  // pendente em vez de lista vazia.
  const REVIEWS = [
    { user: ana, course: nr35, rating: 5, comment: 'O conteúdo sobre EPI esgotou todas as minhas dúvidas. Muito objetivo.', hidden: false },
    { user: carlos, course: nr35, rating: 4, comment: 'Bom, mas achei o módulo de Permissions um pouco rápido.', hidden: false },
    { user: dana, course: nr06, rating: 5, comment: 'A.Checklist do módulo final salvou a minha auditoria interna.', hidden: false },
    {
      user: carlos,
      course: nr06,
      rating: 1,
      comment: 'Péssimo curso, comprei achando que era outra coisa. PIOR plataforma que ja usei.',
      hidden: true,
    },
  ];

  for (const r of REVIEWS) {
    if (!r.user || !r.course) continue;
    await query(
      `INSERT INTO reviews (course_id, user_id, rating, comment, created_at, hidden_at, hidden_by, hidden_reason)
       VALUES ($1, $2, $3, $4, now() - $5::interval, $6, $7, $8)
       ON CONFLICT (course_id, user_id) DO UPDATE
         SET rating = EXCLUDED.rating, comment = EXCLUDED.comment,
             hidden_at = EXCLUDED.hidden_at, hidden_by = EXCLUDED.hidden_by,
             hidden_reason = EXCLUDED.hidden_reason`,
      [
        r.course.id,
        r.user.id,
        r.rating,
        r.comment,
        r.rating === 1 ? '5 days' : '2 days',
        r.hidden ? new Date(Date.now() - 4 * 24 * 60 * 60 * 1000) : null,
        r.hidden ? admin.id : null,
        r.hidden ? 'Ofensivo / spam (demonstração).' : null,
      ],
    );
  }

  // Um post já ocultado pela moderação, pelo mesmo motivo do painel vir com
  // fila de trabalho. LOTO é justamente o tipo de pergunta em que uma resposta
  // errada tem consequência real, então o modelo de demonstração remove a
  // discussão inteira em vez de só uma resposta.
  const moderatedPost = await queryOne(`SELECT id FROM posts WHERE title LIKE 'LOTO em painel%' LIMIT 1`);
  if (moderatedPost) {
    await query(
      `UPDATE posts SET hidden_at = now() - interval '1 day', hidden_by = $2, hidden_reason = $3
        WHERE id = $1 AND hidden_at IS NULL`,
      [moderatedPost.id, admin.id, 'Discussão com risco à saúde (demonstração).'],
    );
  }

  // Média e contagem por curso, contando só as avaliações visíveis — a mesma
  // regra que a aplicação aplica ao moderar.
  await query(
    `UPDATE courses c SET
       rating_avg = coalesce((SELECT round(avg(rating)::numeric, 2) FROM reviews
                              WHERE course_id = c.id AND hidden_at IS NULL), 0),
       rating_count = (SELECT count(*) FROM reviews
                        WHERE course_id = c.id AND hidden_at IS NULL)`,
  );
  logger.info(`${REVIEWS.length} avaliações (1 ocultada) e 1 post moderado.`);

  return { reviews: REVIEWS.length };
}

/**
 * Resumo do que foi semeado, para o operador confirmar com o que ficou.
 */
function report({ clean }) {
  logger.info(`Seed concluído (perfil ${clean ? 'limpo, sem clientes' : 'demo'}).`);
  logger.info('');
  if (clean) {
    logger.info('Contas de operação (senha: %s)', PASSWORD);
    logger.info('  instrutor: bruno@learnup.dev');
    logger.info('  admin:     admin@learnup.dev');
    logger.info('');
    logger.info('Nenhum aluno, matrícula, compra, avaliação ou post foi criado.');
  } else {
    logger.info('Contas de demonstração (senha: %s)', PASSWORD);
    logger.info('  aluno:     ana@learnup.dev');
    logger.info('  aluno:     carlos@learnup.dev');
    logger.info('  instrutor: bruno@learnup.dev');
    logger.info('  admin:     admin@learnup.dev');
    logger.info('  visitante: visitante@learnup.dev');
  }
}

/**
 *   node src/db/seed.js                -> perfil demo (base + clientes fictícios)
 *   node src/db/seed.js --clean        -> perfil limpo (só a base, sem clientes)
 *   node src/db/seed.js --reset        -> apaga antes de semear (perfil demo)
 *   node src/db/seed.js --reset --clean
 *
 * As flags combinam-se livremente. `--reset` é destrutivo.
 */
const args = process.argv.slice(2);
const resetFlag = args.includes('--reset');
const clean = args.includes('--clean');

try {
  const settings = resetFlag ? await reset() : [];
  await seedBadges();
  const ctx = await seedBase({ demoStats: !clean });

  if (clean) {
    // Garante que nada de cliente sobrou de uma execução demo anterior.
    await query(
      `TRUNCATE audit_logs, payment_events, orders, certificates, quiz_attempts,
              lesson_progress, enrollments, comments, posts, reviews,
              user_badges, point_ledger, refresh_tokens CASCADE`,
    );
    logger.info('Perfil limpo: matrículas, compras, certificados, avaliações, fórum e auditoria apagados.');
  } else {
    await seedDemo(ctx);
  }

  await restoreSettings(settings);
  report({ clean });
  process.exitCode = 0;
} catch (err) {
  logger.error({ err }, 'Seed falhou');
  process.exitCode = 1;
} finally {
  await closeDatabaseAndExit();
}
