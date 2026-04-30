import { loadConfig } from './config.js';
import { buildServer } from './server.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const app = await buildServer({ config });
  try {
    await app.listen({ host: config.host, port: config.port });
    app.log.info({ port: config.port }, 'api listening');
  } catch (err) {
    app.log.error({ err }, 'failed to start');
    process.exit(1);
  }

  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => {
      app.log.info({ sig }, 'shutting down');
      void app.close().then(() => process.exit(0));
    });
  }
}

void main();
