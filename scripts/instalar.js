// =====================================================================
// LearnUp - instalacao do zero.
//
// Instala as dependencias, cria os arquivos de configuracao que faltam e
// monta o banco com dados de exemplo. Rodar:  npm run instalar
//
// O PostgreSQL e uma dependencia externa: instale uma vez no Windows e
// deixe rodando. Se ele nao estiver no ar, este script avisa e para.
// =====================================================================

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BACKEND = path.join(RAIZ, 'backend');
const FRONTEND = path.join(RAIZ, 'frontend');

const C = {
  verde: '\x1b[32m',
  vermelho: '\x1b[31m',
  cinza: '\x1b[90m',
  amarelo: '\x1b[33m',
  azul: '\x1b[36m',
  negrito: '\x1b[1m',
  off: '\x1b[0m',
};

let passos = 0;
const totalPassos = 5;

function passo(texto) {
  passos += 1;
  console.log('');
  console.log(`${C.azul}[${passos}/${totalPassos}] ${texto}${C.off}`);
}
function ok(texto) {
  console.log(`      ${C.verde}OK${C.off}    ${texto}`);
}
function detalhe(texto) {
  console.log(`      ${C.cinza}${texto}${C.off}`);
}
function falha(texto) {
  console.log(`      ${C.vermelho}FALHA${C.off} ${texto}`);
}

/** Roda um comando e para tudo se der erro. */
function rodar(comando, argumentos, pasta) {
  const resultado = spawnSync(comando, argumentos, {
    cwd: pasta,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (resultado.status !== 0) {
    console.log('');
    console.log(`${C.vermelho}O comando abaixo falhou:${C.off}`);
    console.log(`  ${comando} ${argumentos.join(' ')}`);
    console.log('');
    process.exit(1);
  }
}

/** Igual ao rodar(), mas esconde a saida e devolve o codigo de saida. */
function rodarParaLer(comando, argumentos) {
  return spawnSync(comando, argumentos, {
    cwd: RAIZ,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
}

/** Copia um arquivo de exemplo para o arquivo real, se o real nao existir. */
function criarConfig(origem, destino, rotulo) {
  if (fs.existsSync(destino)) {
    ok(`${rotulo} ja existe (mantido como esta)`);
    return;
  }
  fs.copyFileSync(origem, destino);
  ok(`${rotulo} criado a partir do exemplo`);
}

console.log('');
console.log(`${C.negrito}Instalacao do LearnUp${C.off}`);
console.log(`${C.cinza}${'='.repeat(52)}${C.off}`);

/**
 * O PostgreSQL e externo: nao tentamos instalar nem subir nada, apenas
 * avisamos se ele faltar (o script banco.js explica o passo a passo).
 */
function checarBanco() {
  const resultado = rodarParaLer('node', [path.join(RAIZ, 'scripts', 'banco.js')]);
  if (resultado.status === 0) {
    ok('Banco de dados PostgreSQL local encontrado');
    return;
  }
  console.log('');
  console.log(`${C.vermelho}${C.negrito}Falta o banco de dados PostgreSQL rodando.${C.off}`);
  console.log(`${C.amarelo}Rode "npm run banco" para ver o passo a passo de como instalar.${C.off}`);
  console.log('');
  process.exit(1);
}

// ---------------------------------------------------------------------
passo('Conferindo o banco de dados PostgreSQL local');
detalhe('O projeto nao instala o banco: ele precisa estar rodando no Windows.');
checarBanco();

// ---------------------------------------------------------------------
passo('Instalando as dependencias do backend (bibliotecas do projeto)');
rodar('npm', ['install'], BACKEND);

// ---------------------------------------------------------------------
passo('Instalando as dependencias do frontend');
rodar('npm', ['install'], FRONTEND);

// ---------------------------------------------------------------------
passo('Criando os arquivos de configuracao');

criarConfig(
  path.join(BACKEND, '.env.example'),
  path.join(BACKEND, '.env'),
  'backend/.env',
);
criarConfig(
  path.join(FRONTEND, '.env.example'),
  path.join(FRONTEND, '.env.local'),
  'frontend/.env.local',
);

/**
 * O docker-compose.yml (opcional, so para quem quiser subir tudo em
 * container) usa dois segredos de login. Se a pasta LearnUp ainda nao tem
 * um .env na raiz, criamos um com valores aleatorios. O .env da raiz fica
 * fora do Git de proposito, porque sao segredos.
 */
criarEnvRaiz();

function criarEnvRaiz() {
  const destino = path.join(RAIZ, '.env');
  if (fs.existsSync(destino)) {
    ok('.env da raiz ja existe (mantido como esta)');
    return;
  }
  const segredo = () => crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(
    destino,
    [
      '# Segredos usados pelo docker-compose.yml (opcional). Fora do Git.',
      `JWT_SECRET=${segredo()}`,
      `JWT_REFRESH_SECRET=${segredo()}`,
      'COOKIE_SECURE=false',
      'NODE_ENV=development',
      '',
    ].join('\n'),
    'utf8',
  );
  ok('.env da raiz criado com segredos aleatorios');
}

// ---------------------------------------------------------------------
passo('Montando o banco de dados (tabelas + dados de exemplo)');
detalhe('Isso cria todas as tabelas e coloca os dados de exemplo.');
rodar('npm', ['run', 'db:reset'], BACKEND);

console.log('');
console.log(`${C.verde}${C.negrito}Instalacao concluida!${C.off}`);
console.log('');
console.log('Para comecar a usar, rode:');
console.log(`  ${C.negrito}npm run dev${C.off}`);
console.log('');
console.log('E abra o site no navegador: http://localhost:5173');
console.log('');
console.log(`${C.cinza}Contas de exemplo (senha de todas: learnup123)${C.off}`);
console.log(`${C.cinza}  aluno...... ana@learnup.dev${C.off}`);
console.log(`${C.cinza}  instrutor... bruno@learnup.dev${C.off}`);
console.log(`${C.cinza}  admin...... admin@learnup.dev${C.off}`);
console.log('');