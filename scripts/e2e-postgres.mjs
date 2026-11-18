// Roda o e2e contra o Postgres 17 do docker-compose (em vez do PGlite),
// para exercitar as travas de concorrência com várias conexões de verdade.
import { spawnSync } from 'node:child_process';

const rodar = (cmd, args, env) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: true, env: { ...process.env, ...env } });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

// Com E2E_DATABASE_URL definida, usa esse Postgres (ex.: um instalado ou portátil, sem Docker).
const urlExterna = process.env.E2E_DATABASE_URL?.trim();
if (!urlExterna) rodar('docker', ['compose', 'up', '-d', '--wait', 'banco']);
rodar('npx', ['vitest', 'run', '--config', './vitest.config.e2e.ts'], {
  E2E_DATABASE_URL: urlExterna || 'postgres://kudo:kudo@localhost:5432/kudo',
});
