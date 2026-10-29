import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
const node = resolve('node_modules/node/bin/node');
if (!existsSync(node)) throw new Error('Node lokal belum siap. Jalankan pnpm rebuild node.');
const commands = {
  dev: ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1'],
  build: ['node_modules/next/dist/bin/next', 'build'],
  start: ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1'],
  worker: ['--import', 'tsx', 'src/worker/index.ts'],
  'db:start': ['scripts/database.mjs'],
  'db:migrate': ['--import', 'tsx', 'src/server/db/migrate.ts'],
  test: ['node_modules/vitest/vitest.mjs', 'run', 'tests/unit'],
  'test:integration': ['node_modules/vitest/vitest.mjs', 'run', 'tests/integration'],
  'test:e2e': ['node_modules/@playwright/test/cli.js', 'test'],
};
const args = commands[process.argv[2]];
if (!args) throw new Error('Perintah tidak dikenal');
const child = spawn(node, [...args, ...process.argv.slice(3)], { stdio:'inherit', env:{...process.env, NEXT_TELEMETRY_DISABLED:'1', PATH: `${resolve('node_modules/node/bin')}:${process.env.PATH}`} });
for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', code => process.exit(code ?? 1));
