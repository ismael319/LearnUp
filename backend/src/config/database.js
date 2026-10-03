import { config } from './env.js';
import { logger } from '../utils/logger.js';

const { Pool } = await import('pg');

export const pool = new Pool({
  connectionString: config.db.url,
  ssl: config.db.ssl,
  max: config.db.max,
  idleTimeoutMillis: config.db.idleTimeoutMillis,
});

pool.on('error', (err) => {
  logger.error({ err }, 'Erro inesperado em cliente ocioso do PostgreSQL');
});

/** Executa uma query e devolve { rows, rowCount }. */
export async function query(text, params = []) {
  const started = process.hrtime.bigint();
  const result = await pool.query(text, params);
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  if (ms > 200) logger.warn({ ms, sql: text.slice(0, 80) }, 'Query lenta');
  return result;
}

/** Primeira linha ou null. */
export async function queryOne(text, params = []) {
  const { rows } = await query(text, params);
  return rows[0] ?? null;
}

/** Todas as linhas. */
export async function queryAll(text, params = []) {
  const { rows } = await query(text, params);
  return rows;
}

/**
 * Roda `fn` dentro de uma transação, fazendo rollback em caso de erro.
 * O client é passado para a callback e deve ser usado no lugar de `query()`.
 */
export async function transaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function checkDatabase() {
  const { rows } = await query('SELECT now() AS time, version() AS version');
  return rows[0];
}

export async function closeDatabase() {
  await pool.end();
}

const FORCE_EXIT_MS = 5000;

/**
 * Fecha o pool e encerra o processo de forma determinística. O `pool.end()`
 * pode ficar pendente quando o banco está inacessível, e handles abertos
 * (transporte de log, socket pendente) mantêm o event loop vivo depois do
 * script terminar. O timeout evita travar o terminal e o `process.exit`
 * garante a saída.
 */
export async function closeDatabaseAndExit(code = process.exitCode ?? 0) {
  const forced = setTimeout(() => process.exit(code), FORCE_EXIT_MS);
  forced.unref();
  try {
    await closeDatabase();
  } catch {
    /* o pool já está indisponível: saímos assim mesmo */
  }
  clearTimeout(forced);
  process.exit(code);
}
