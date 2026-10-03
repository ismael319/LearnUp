#!/usr/bin/env node
/**
 * Prepara a base de dados de TESTES: cria `learnup_test` se não existir, aplica
 * as migrations e semeia com dados de demonstração.
 *
 *   node src/db/prepare-test-db.js
 *
 * Existe porque a suíte E2E precisa de um banco descartável, e o erro anterior
 * era danoso: `npm test` corria contra a base configurada e deixava ~250 cursos,
 * ~80 utilizadores e centenas de registos de compra dentro do ambiente real.
 *
 * Salvaguarda: o script recusa-se a correr se o nome do banco não terminar em
 * `_test`. Mesmo que o `.env` aponte para a base real, o seed de demonstração
 * (que cria clientes fictícios) não arranca.
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { Client } from 'pg';
import { logger } from '../utils/logger.js';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Carrega `.env.test` para o script também poder ser corrido à mão, sem o
// `--env-file` do npm. As variáveis já presentes no ambiente têm prioridade.
loadEnv({ path: join(rootDir, '.env.test') });

const rawUrl = process.env.DATABASE_URL;
if (!rawUrl) {
  logger.error('DATABASE_URL não definido. Configure backend/.env.test.');
  process.exit(1);
}

const target = new URL(rawUrl);
const dbName = decodeURIComponent(target.pathname.replace(/^\//, ''));

if (!dbName.endsWith('_test')) {
  logger.error(
    { banco: dbName },
    'Recusado: o banco de testes tem de terminar em "_test". Nada foi apagado.',
  );
  process.exit(1);
}

/** URL de ligação à base de manutenção, para poder correr CREATE DATABASE. */
const maintenanceUrl = new URL(rawUrl);
maintenanceUrl.pathname = '/postgres';

async function ensureDatabase() {
  const client = new Client({ connectionString: maintenanceUrl.toString() });
  await client.connect();
  try {
    const { rows } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (rows.length > 0) {
      logger.info(`Base ${dbName} já existe.`);
      return;
    }
    // Identificador não pode ser parâmetro; o nome foi validado acima e vem de
    // configuração, não de entrada do utilizador.
    await client.query(`CREATE DATABASE "${dbName}"`);
    logger.info(`Base ${dbName} criada.`);
  } finally {
    await client.end();
  }
}

function run(script, args) {
  logger.info(`> node ${script} ${args.join(' ')}`);
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: rootDir,
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: rawUrl, NODE_ENV: 'test' },
  });
  if (result.status !== 0) {
    throw new Error(`${script} terminou com código ${result.status}`);
  }
}

try {
  await ensureDatabase();
  // `reset` faz DROP SCHEMA + reaplica as migrations: garante que a base de
  // testes começa sempre no estado exato do schema atual.
  run('src/db/migrate.js', ['reset']);
  run('src/db/seed.js', []);
  logger.info(`Base de testes ${dbName} pronta.`);
} catch (err) {
  logger.error({ err: err.message }, 'Preparação da base de testes falhou');
  process.exitCode = 1;
}
