import os from 'node:os';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Tests d'intégration : vraie base PostgreSQL (DATABASE_URL), fichiers exécutés l'un après l'autre.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    fileParallelism: false,
    pool: 'forks',
    testTimeout: 30_000,
    hookTimeout: 60_000,
    globalSetup: ['test/global-setup.ts'],
    env: {
      NODE_ENV: 'test',
      TZ: 'Europe/Paris',
      DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://mandrix:mandrix@localhost:5433/mandrix_test',
      DATA_DIR: path.join(os.tmpdir(), 'mandrix-test-data'),
      WEB_DIST: path.join(os.tmpdir(), 'mandrix-test-no-web'),
      INVITE_CODE: 'MASTER-TEST',
      AUTH_RATE_LIMIT: '10000',
      APP_URL: 'http://localhost:3000',
    },
  },
});
