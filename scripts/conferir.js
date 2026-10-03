// =====================================================================
// LearnUp - conferencia do ambiente.
//
// Responde a pergunta "por que nao funciona?" antes de voce perder tempo
// tentando. Rodar:  npm run conferir
//
// Cada item diz o que TA ERRADO e o comando exato para resolver.
// =====================================================================

import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BACKEND = path.join(RAIZ, 'backend');
const FRONTEND = path.join(RAIZ, 'frontend');

const PORTA_BANCO = 5432;
const PORTA_API = 4000;
const PORTA_SITE = 5173;

const resultados = [];

function registrar(ok, titulo, problema, solucao) {
  resultados.push({ ok, titulo, problema, solucao });
}

/** Abre e fecha uma conexao TCP na porta para saber se algo responde la. */
function portaAberta(porta, host = '127.0.0.1', tempoLimite = 1500) {
  return new Promise((resolve) => {
    const socket = net.connect({ port: porta, host });
    const encerrar = (resposta) => {
      socket.destroy();
      resolve(resposta);
    };
    socket.setTimeout(tempoLimite);
    socket.on('connect', () => encerrar(true));
    socket.on('timeout', () => encerrar(false));
    socket.on('error', () => encerrar(false));
  });
}

/**
 * Le o par chave=valor de um arquivo .env, sem depender de biblioteca.
 * So nos interessam as chaves que o diagnostico usa: os dois segredos de
 * login e o endereco do banco.
 */
const CHAVES_INTERESSANTES = new Set(['JWT_SECRET', 'JWT_REFRESH_SECRET', 'DATABASE_URL']);

function lerEnv(arquivo) {
  const configuracao = {};
  if (!fs.existsSync(arquivo)) return configuracao;
  for (const linha of fs.readFileSync(arquivo, 'utf8').split(/\r?\n/)) {
    const semComentario = linha.replace(/#.*$/, '').trim();
    if (!semComentario) continue;
    const separador = semComentario.indexOf('=');
    if (separador <= 0) continue;
    const chave = semComentario.slice(0, separador).trim();
    if (!CHAVES_INTERESSANTES.has(chave)) continue;
    configuracao[chave] = semComentario.slice(separador + 1).trim();
  }
  return configuracao;
}

// ---------------------------------------------------------------------
// 1. Node.js
// ---------------------------------------------------------------------

const versaoNode = Number(process.versions.node.split('.')[0]);
registrar(
  versaoNode >= 20,
  `Node.js instalado (versao ${process.versions.node})`,
  `Voce tem o Node ${process.versions.node}, e o projeto precisa da versao 20 ou mais nova.`,
  'Baixe a versao LTS em https://nodejs.org e instale. Depois feche e abra o terminal.',
);

// ---------------------------------------------------------------------
// 2. Dependencias instaladas
// ---------------------------------------------------------------------

for (const [nome, pasta] of [['backend', BACKEND], ['frontend', FRONTEND]]) {
  const instalado = fs.existsSync(path.join(pasta, 'node_modules'));
  registrar(
    instalado,
    `Dependencias do ${nome} instaladas`,
    `A pasta ${nome}/node_modules nao existe (ou esta vazia).`,
    'Rode "npm run instalar" na pasta LearnUp.',
  );
}

// ---------------------------------------------------------------------
// 3. Arquivos de configuracao (.env)
// ---------------------------------------------------------------------

const envBackend = lerEnv(path.join(BACKEND, '.env'));
const temEnvBackend = fs.existsSync(path.join(BACKEND, '.env'));
registrar(
  temEnvBackend,
  'Arquivo backend/.env existe',
  'Falta o arquivo backend/.env, que guarda as senhas e o endereco do banco.',
  'Rode "npm run instalar" na pasta LearnUp (ele cria o arquivo a partir do exemplo).',
);

registrar(
  Boolean(envBackend.JWT_SECRET && envBackend.JWT_REFRESH_SECRET && envBackend.JWT_SECRET.length >= 16),
  'Segredos de login (JWT) configurados',
  'O .env nao tem JWT_SECRET / JWT_REFRESH_SECRET, ou sao curtos demais (minimo 16 caracteres).',
  'Rode "npm run instalar". Se ja existe, abra backend/.env e preencha as duas linhas.',
);

registrar(
  fs.existsSync(path.join(FRONTEND, '.env.local')),
  'Arquivo frontend/.env.local existe',
  'Falta o frontend/.env.local, que aponta o site para a API.',
  'Rode "npm run instalar" na pasta LearnUp.',
);

// ---------------------------------------------------------------------
// 4. Banco de dados local ligado
// ---------------------------------------------------------------------
//
// O PostgreSQL e uma dependencia externa: este projeto nao o instala e
// nao usa Docker. Basta ter o PostgreSQL rodando no Windows.

const bancoLigado = await portaAberta(PORTA_BANCO);
registrar(
  bancoLigado,
  `Banco de dados PostgreSQL responde na porta ${PORTA_BANCO}`,
  `Nada esta escutando na porta ${PORTA_BANCO}: o PostgreSQL nao esta rodando no Windows.`,
  'Rode "npm run banco" na pasta LearnUp: ele mostra o passo a passo de como instalar. Se ja tem PostgreSQL instalado, abra o servico "postgresql-x64-16" no Gerenciador de Servicos do Windows.',
);

// ---------------------------------------------------------------------
// 5. Tabelas existem (so se o banco estiver ligado)
// ---------------------------------------------------------------------

let tabelas = 0;
let temDriver = false;

if (bancoLigado) {
  temDriver = fs.existsSync(path.join(BACKEND, 'node_modules', 'pg'));
}

if (bancoLigado && temDriver && temEnvBackend) {
  const requireDoBackend = createRequire(path.join(BACKEND, 'package.json'));
  const { Client } = requireDoBackend('pg');
  const cliente = new Client({
    connectionString: envBackend.DATABASE_URL || 'postgres://learnup:learnup@localhost:5432/learnup',
    connectionTimeoutMillis: 5000,
  });
  try {
    await cliente.connect();
    const resultado = await cliente.query(
      "SELECT count(*)::int AS total FROM information_schema.tables WHERE table_schema = 'public'",
    );
    tabelas = resultado.rows[0].total;
    registrar(
      tabelas > 0,
      `Banco "learnup" tem ${tabelas} tabelas`,
      'O banco esta ligado, mas nenhuma tabela foi criada (faltou rodar as migrations).',
      'Rode "npm run db:reset" na pasta LearnUp. Isso cria as tabelas e coloca os dados de exemplo.',
    );
  } catch (erro) {
    registrar(
      false,
      'Banco "learnup" responde',
      `Nao consegui entrar no banco: ${erro.message}`,
      'Confirme se o usuario e a senha do backend/.env batem com os do banco. Padrao: learnup / learnup.',
    );
  } finally {
    await cliente.end().catch(() => {});
  }
}

// ---------------------------------------------------------------------
// 6. Portas da API e do site livres
// ---------------------------------------------------------------------

const apiOcupada = await portaAberta(PORTA_API);
registrar(
  !apiOcupada,
  `Porta ${PORTA_API} livre para a API`,
  `Ja existe um programa usando a porta ${PORTA_API} (talvez a API de uma sessao anterior).`,
  'Feche o outro programa, ou rode "npm run dev" em outra pasta. Para ver quem ocupa: netstat -ano | findstr :4000',
);

const siteOcupado = await portaAberta(PORTA_SITE);
registrar(
  !siteOcupado,
  `Porta ${PORTA_SITE} livre para o site`,
  `Ja existe um programa usando a porta ${PORTA_SITE} (talvez o site de uma sessao anterior).`,
  'Feche o outro programa e rode "npm run dev" de novo.',
);

// ---------------------------------------------------------------------
// Mostrar o resultado
// ---------------------------------------------------------------------

const C = {
  verde: '\x1b[32m',
  vermelho: '\x1b[31m',
  cinza: '\x1b[90m',
  amarelo: '\x1b[33m',
  negrito: '\x1b[1m',
  off: '\x1b[0m',
};

console.log('');
console.log(`${C.negrito}Conference do ambiente LearnUp${C.off}`);
console.log(`${C.cinza}${'='.repeat(52)}${C.off}`);

for (const item of resultados) {
  const marca = item.ok ? `${C.verde}OK   ${C.off}` : `${C.vermelho}FALHA${C.off}`;
  console.log(` [${marca}] ${item.titulo}`);
  if (!item.ok) {
    console.log(`        ${C.vermelho}${item.problema}${C.off}`);
    console.log(`        ${C.amarelo}Resolva:${C.off} ${item.solucao}`);
  }
}

const falhas = resultados.filter((item) => !item.ok);
console.log('');

if (falhas.length === 0) {
  console.log(`${C.verde}${C.negrito}Tudo pronto!${C.off} Rode "npm run dev" e abra http://localhost:${PORTA_SITE}`);
  console.log('');
  process.exit(0);
}

console.log(`${C.vermelho}${falhas.length} problema(s) para resolver.${C.off}`);
console.log('');
console.log(`${C.cinza}Atalho: "npm run instalar" faz a instalacao completa do zero.${C.off}`);
console.log('');
process.exit(1);