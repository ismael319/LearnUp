// =====================================================================
// LearnUp - liga a API e o site juntos.
//
// Rodar:  npm run dev
//
// Antes de ligar, ele confere o ambiente e avisa em portugues o que
// estiver faltando (banco desligado, dependencias sem instalar, etc.)
// em vez de deixar voce com uma tela branca sem explicacao.
//
// Para parar tudo: Ctrl+C
// =====================================================================

import { spawn } from 'node:child_process';
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

const childProcesses = [];
let encerrando = false;

/**
 * Escreve no console cada linha com um prefixo colorido, para saber de
 * onde ela veio. Sem isso, os dois programas embaralham a saida.
 */
function iniciar(rotulo, cor, comando, argumentos, pasta) {
  const processo = spawn(comando, argumentos, {
    cwd: pasta,
    shell: process.platform === 'win32',
    env: process.env,
  });

  const escrever = (fluxo, destino) => {
    let resto = '';
    fluxo.on('data', (pedaco) => {
      resto += pedaco.toString();
      const linhas = resto.split('\n');
      resto = linhas.pop() ?? '';
      for (const linha of linhas) {
        destino.write(`${cor}[${rotulo}]${C.off} ${linha}\n`);
      }
    });
  };

  escrever(processo.stdout, process.stdout);
  escrever(processo.stderr, process.stderr);

  processo.on('exit', (codigo) => {
    if (encerrando) return;
    console.log('');
    console.log(`${C.vermelho}[${rotulo}] parou com erro (código ${codigo}).${C.off}`);
    console.log(`${C.cinza}Se o banco estiver desligado, o erro mais comum é ECONNREFUSED.${C.off}`);
    console.log(`${C.cinza}Rode "npm run conferir" para ver o que falta.${C.off}`);
    parar(codigo ?? 1);
  });

  processo.on('error', (erro) => {
    console.log(`${C.vermelho}[${rotulo}] nao pode ser iniciado: ${erro.message}${C.off}`);
    parar(1);
  });

  childProcesses.push(processo);
}

function parar(codigo = 0) {
  if (encerrando) return;
  encerrando = true;
  for (const processo of childProcesses) {
    if (processo.exitCode === null) processo.kill();
  }
  setTimeout(() => process.exit(codigo), 300);
}

process.on('SIGINT', () => parar(0));
process.on('SIGTERM', () => parar(0));

// ---------------------------------------------------------------------
// 1. Aviso rapido antes de subir
// ---------------------------------------------------------------------

const conferencia = spawn('node', [path.join(RAIZ, 'scripts', 'conferir.js')], {
  cwd: RAIZ,
  stdio: ['ignore', 'pipe', 'inherit'],
});

let saidaConferencia = '';
conferencia.stdout.on('data', (pedaco) => {
  saidaConferencia += pedaco.toString();
});

const codigoConferencia = await new Promise((resolver) => {
  conferencia.on('exit', resolver);
  conferencia.on('error', () => resolver(1));
});

console.log(saidaConferencia);

if (codigoConferencia !== 0) {
  console.log(`${C.vermelho}${C.negrito}Nao vou ligar ainda: falta resolver o que esta acima.${C.off}`);
  console.log(`${C.amarelo}Atalhos:${C.off}  npm run instalar  (instala tudo)`);
  console.log(`${C.amarelo}          ${C.off}  npm run banco     (confere o PostgreSQL local)`);
  console.log(`${C.amarelo}          ${C.off}  npm run conferir  (so diagnostico)`);
  console.log('');
  process.exit(1);
}

// ---------------------------------------------------------------------
// 2. Subir os dois
// ---------------------------------------------------------------------

console.log('');
console.log(`${C.verde}${C.negrito}Ligando o LearnUp...${C.off}`);
console.log(`${C.cinza}  API ......... http://localhost:4000/api/v1${C.off}`);
console.log(`${C.cinza}  Site ........ http://localhost:5173${C.off}`);
console.log(`${C.cinza}  Para parar ... Ctrl+C${C.off}`);
console.log('');

iniciar('api', C.azul, 'npm', ['run', 'dev'], BACKEND);
iniciar('site', C.verde, 'npm', ['run', 'dev'], FRONTEND);