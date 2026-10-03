#!/usr/bin/env node
/**
 * Runner de migrations minimalista.
 *
 *   node src/db/migrate.js up       aplica pendentes
 *   node src/db/migrate.js down     desfaz a última aplicada
 *   node src/db/migrate.js status   lista o estado
 *   node src/db/migrate.js reset    dropa tudo e reaplica
 *
 * Cada arquivo .sql em src/db/migrations roda uma vez, dentro de uma
 * transação, e seu nome é registrado na tabela schema_migrations.
 */
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, query, closeDatabaseAndExit } from '../config/database.js';
import { logger } from '../utils/logger.js';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, 'migrations');

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    name       text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  );
`;

async function applied() {
  await query(CREATE_TABLE);
  const { rows } = await query('SELECT name FROM schema_migrations ORDER BY name');
  return rows.map((r) => r.name);
}

async function files() {
  const entries = await readdir(migrationsDir);
  return entries.filter((f) => f.endsWith('.sql')).sort();
}

/**
 * `down` reverte a última migration. O bloco opcional `-- DOWN` (invertido,
 * como em dbmate) é executado; sem ele, apenas o registro é removido e a
 * limpeza fica a cargo de um script manual.
 */
async function down(name) {
  const sql = await readFile(join(migrationsDir, name), 'utf8');
  const downSql = extractDownSection(sql);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (downSql) await client.query(downSql);
    await client.query('DELETE FROM schema_migrations WHERE name = $1', [name]);
    await client.query('COMMIT');
    logger.warn({ migration: name }, 'Migration revertida (bloco "-- DOWN" opcional aplicado)');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

function extractDownSection(sql) {
  const marker = /^--\s*-+ ?DOWN ?-+ *$/im;
  const match = marker.exec(sql);
  return match ? sql.slice(match.index + match[0].length).trim() : null;
}

async function up() {
  const done = await applied();
  const all = await files();
  const pending = all.filter((f) => !done.includes(f));

  if (pending.length === 0) {
    logger.info('Banco de dados já está atualizado.');
    return;
  }

  for (const name of pending) {
    const sql = await readFile(join(migrationsDir, name), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
      await client.query('COMMIT');
      logger.info({ migration: name }, 'Migration aplicada');
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error({ migration: name, err: err.message }, 'Falha na migration');
      throw err;
    } finally {
      client.release();
    }
  }
}

async function status() {
  const done = await applied();
  const all = await files();
  for (const name of all) {
    logger.info(`${done.includes(name) ? '✔' : '·'} ${name}`);
  }
}

async function reset() {
  logger.warn('Resetando o schema público...');
  await query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await up();
}

const command = process.argv[2] ?? 'up';
const table = { up, down, status, reset };

try {
  if (command === 'down') {
    const done = await applied();
    const last = done[done.length - 1];
    if (!last) logger.info('Nenhuma migration aplicada.');
    else await down(last);
  } else if (table[command]) {
    await table[command]();
  } else {
    logger.error(`Comando desconhecido: ${command}. Use up | down | status | reset`);
    process.exitCode = 1;
  }
} catch (err) {
  logger.error({ err: err.message }, 'migrate falhou');
  process.exitCode = 1;
} finally {
  await closeDatabaseAndExit();
}
