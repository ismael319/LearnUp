import { createApp } from './app.js';
import { config } from './config/env.js';
import { logger } from './utils/logger.js';
import { checkDatabase, closeDatabase } from './config/database.js';

const app = createApp();

const server = app.listen(config.port, async () => {
  logger.info(
    { port: config.port, env: config.env, prefix: config.apiPrefix },
    `LearnUp API rodando em http://localhost:${config.port}${config.apiPrefix}`,
  );

  try {
    const info = await checkDatabase();
    logger.info({ db: info.version?.split(' ').slice(0, 2).join(' ') }, 'Banco de dados conectado');
  } catch (err) {
    // Conexão recusada costuma chegar sem `message` (AggregateError do Node),
    // então logamos o objeto inteiro para não perder a causa.
    logger.error(
      { err: err.message || String(err), cause: err.cause?.code ?? err.code, detail: err },
      'Não foi possível conectar ao banco. Rode: npm run db:reset',
    );
  }
});

/** Encerra conexões pendentes antes de sair (deploy sem cortar requisições). */
async function shutdown(signal) {
  logger.info({ signal }, 'Encerrando...');
  server.close(async () => {
    await closeDatabase().catch(() => {});
    logger.info('Servidor finalizado.');
    process.exit(0);
  });
  setTimeout(() => {
    logger.error('Timeout no shutdown; forçando saída.');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => logger.error({ reason }, 'Promise rejeitada sem tratamento'));
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Exceção não tratada; encerrando');
  process.exit(1);
});

export default server;
