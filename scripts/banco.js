// =====================================================================
// LearnUp - confere o banco de dados PostgreSQL local.
//
// O banco e uma dependencia externa: o projeto NAO instala o PostgreSQL
// e NAO usa Docker. Voce instala uma vez no Windows e so precisa deixar
// ele rodando. Este script apenas verifica e, se faltar alguma coisa,
// explica o caminho em portugues. Rodar:  npm run banco
// =====================================================================

import net from 'node:net';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BACKEND = path.join(RAIZ, 'backend');

const PORTA_BANCO = 5432;

const C = {
  verde: '\x1b[32m',
  vermelho: '\x1b[31m',
  cinza: '\x1b[90m',
  amarelo: '\x1b[33m',
  azul: '\x1b[36m',
  negrito: '\x1b[1m',
  off: '\x1b[0m',
};

function ok(texto) {
  console.log(`      ${C.verde}OK${C.off}    ${texto}`);
}
function detalhe(texto) {
  console.log(`      ${C.cinza}${texto}${C.off}`);
}
function falha(texto) {
  console.log(`      ${C.vermelho}FALHA${C.off} ${texto}`);
}

/** Abre e fecha uma conexao TCP para saber se algo escuta na porta. */
function portaAberta(porta, host = '127.0.0.1', tempoLimite = 2000) {
  return new Promise((resolver) => {
    const socket = net.connect({ port: porta, host });
    const encerrar = (resposta) => {
      socket.destroy();
      resolver(resposta);
    };
    socket.setTimeout(tempoLimite);
    socket.on('connect', () => encerrar(true));
    socket.on('timeout', () => encerrar(false));
    socket.on('error', () => encerrar(false));
  });
}

function explicarComoInstalar() {
  console.log('');
  console.log(`${C.amarelo}${C.negrito}Como instalar o PostgreSQL no Windows (sem Docker)${C.off}`);
  console.log('');
  console.log('  1. Baixe o instalador do PostgreSQL 16 em https://www.postgresql.org/download/windows/');
  console.log('  2. No instalador, anote a senha do usuario "postgres" e mantenha a porta 5432.');
  console.log('  3. Marque "Command Line Tools" para o psql ficar disponivel no terminal.');
  console.log('  4. Ao terminar, o Windows ja deixa o banco ligando sozinho com o PC.');
  console.log('');
  console.log(`${C.amarelo}${C.negrito}Depois de instalar, crie o banco e o usuario${C.off}`);
  console.log('');
  console.log('  Abra o "SQL Shell" do PostgreSQL (menu Iniciar) ou um terminal e rode:');
  console.log('');
  console.log('    CREATE ROLE learnup LOGIN CREATEDB PASSWORD \'learnup\';');
  console.log('    CREATE DATABASE learnup OWNER learnup ENCODING \'UTF8\';');
  console.log('    CREATE DATABASE learnup_test OWNER learnup ENCODING \'UTF8\';');
  console.log('');
  console.log(`${C.amarelo}${C.negrito}Problema comum no Windows 11: "psql" e "initdb" nao abrem${C.off}`);
  console.log('');
  console.log('  Se aparecer "O programa nao pode ser executado" ou o Servico do Windows');
  console.log('  nao inicia, o Smart App Control do Windows esta bloqueando a libpq.dll');
  console.log('  (ela nao vem assinada digitalmente). Duas formas de resolver:');
  console.log('');
  console.log('  a) Desligar o Smart App Control em:');
  console.log('     Seguranca do Windows > Seguranca do Windows > Controle de Aplicativos');
  console.log('     e Navegador > Controle de Aplicativos > Avaliacao de Aplicativos >');
  console.log('     Smart App Control > Desligar (o Windows reinicia).');
  console.log('');
  console.log('  b) Assinar a libpq.dll com um certificado local. Abra o PowerShell como');
  console.log('     administrador e rode (ajuste a pasta se o PostgreSQL estiver em outro lugar):');
  console.log('');
  console.log('    $bin = "C:\\Program Files\\PostgreSQL\\16\\bin"');
  console.log('    $cert = New-SelfSignedCertificate -Type CodeSigningCert `');
  console.log('      -Subject "CN=LearnUp" -CertStoreLocation Cert:\\CurrentUser\\My `');
  console.log('      -KeyUsage DigitalSignature -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.3")');
  console.log('    Get-ChildItem $bin -Filter *.dll | ForEach-Object {');
  console.log('      Set-AuthenticodeSignature $_.FullName -Certificate $cert | Out-Null }');
  console.log('    Restart-Service postgresql-x64-16');
  console.log('');
  console.log('  A API do LearnUp usa a biblioteca "pg", que e JavaScript puro e nao');
  console.log('  depende da libpq.dll. Se a API subir e o site funcionar, mesmo com os');
  console.log('  comandos do PostgreSQL quebrados, o projeto esta pronto.');
}

console.log('');
console.log(`${C.negrito}Conferencia do banco de dados local${C.off}`);
console.log(`${C.cinza}${'='.repeat(52)}${C.off}`);

const bancoLigado = await portaAberta(PORTA_BANCO);

if (!bancoLigado) {
  falha(`Nada esta escutando na porta ${PORTA_BANCO}.`);
  explicarComoInstalar();
  console.log('');
  console.log(`${C.cinza}Depois disso, rode "npm run instalar" para criar as tabelas.${C.off}`);
  console.log('');
  process.exit(1);
}

ok(`PostgreSQL respondendo na porta ${PORTA_BANCO}`);

// Se deu para abrir a porta, tentamos entrar de verdade para dizer se o
// usuario e os bancos que o projeto espera existem.
const enderecoPadrao = 'postgres://learnup:learnup@localhost:5432/learnup';

let endereco = enderecoPadrao;
try {
  const requireDoBackend = createRequire(path.join(BACKEND, 'package.json'));
  const fs = await import('node:fs');
  const arquivoEnv = path.join(BACKEND, '.env');
  if (fs.existsSync(arquivoEnv)) {
    for (const linha of fs.readFileSync(arquivoEnv, 'utf8').split(/\r?\n/)) {
      const semComentario = linha.replace(/#.*$/, '').trim();
      if (semComentario.startsWith('DATABASE_URL=')) {
        endereco = semComentario.slice('DATABASE_URL='.length).trim();
      }
    }
  }
} catch {
  // Sem backend/.env ou sem a biblioteca pg: usamos o endereco padrao.
}

try {
  const requireDoBackend = createRequire(path.join(BACKEND, 'package.json'));
  const { Client } = requireDoBackend('pg');
  const cliente = new Client({ connectionString: endereco, connectionTimeoutMillis: 5000 });
  await cliente.connect();

  const bancos = await cliente.query(
    'SELECT datname FROM pg_database WHERE datname LIKE $1 ORDER BY datname',
    ['learnup%'],
  );
  const tabelas = await cliente.query(
    "SELECT count(*)::int AS total FROM information_schema.tables WHERE table_schema = 'public'",
  );

  ok(`Consegui entrar como "${endereco.split('//')[1].split(':')[0] || 'learnup'}"`);
  ok(`Bancos encontrados: ${bancos.rows.map((b) => b.datname).join(', ') || 'nenhum'}`);

  if (tabelas.rows[0].total > 0) {
    ok(`Banco "learnup" tem ${tabelas.rows[0].total} tabelas`);
  } else {
    detalhe('O banco ainda nao tem tabelas. Rode "npm run db:reset" para criar.');
  }

  await cliente.end();
} catch (erro) {
  detalhe(`Porta aberta, mas nao consegui entrar: ${erro.message}`);
  console.log('');
  console.log(`${C.amarelo}Confira o usuario e a senha em backend/.env (padrao: learnup / learnup).${C.off}`);
  console.log(`${C.amarelo}Se o banco "learnup" ainda nao existe, crie com o SQL Shell do PostgreSQL.${C.off}`);
}

console.log('');
console.log(`${C.verde}${C.negrito}Banco local pronto!${C.off}`);
console.log(`${C.cinza}Rode "npm run dev" para ligar a API e o site.${C.off}`);
console.log('');