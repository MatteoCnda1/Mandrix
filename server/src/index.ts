import { buildApp } from './app.js';
import { runMigrations, sql } from './db/index.js';
import { env } from './env.js';
import { startJobs } from './jobs.js';
import { backfillVariants } from './lib/media.js';
import { initPush } from './lib/push.js';
import { resumeVideoQueue } from './lib/video.js';

async function main() {
  await runMigrations();
  await initPush();
  const app = await buildApp();
  startJobs();
  resumeVideoQueue().catch((e) => console.error('[video] reprise', e));
  backfillVariants().catch((e) => console.error('[media] variantes', e));

  await app.listen({ port: env.port, host: env.host });
  console.log(`Mandrix prêt sur http://${env.host}:${env.port}`);

  const stop = async () => {
    await app.close();
    await sql.end({ timeout: 5 });
    process.exit(0);
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
