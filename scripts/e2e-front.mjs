// Roda a suíte Playwright do front (jungle-nft) contra esta API, com banco novo a cada rodada.
// O sucesso da API é medido assim: os mesmos testes que passam no MSW passam aqui.
//
//   npm run test:e2e:front               (front em ../jungle-nft)
//   npm run test:e2e:front -- compra     (argumentos vão direto para o Playwright)
//   FRONT_DIR=/outro/caminho npm run test:e2e:front
import { spawn, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

const FRONT = resolve(process.env.FRONT_DIR ?? '../jungle-nft');
const PORTA_API = 3001; // não briga com o `npm run dev` (3000)
const PORTA_FRONT = 4174; // não reaproveita um preview do front com o MSW embutido (4173)
const API = `http://127.0.0.1:${PORTA_API}`;

const construir = spawnSync('npm', ['run', 'build'], { stdio: 'inherit', shell: true });
if (construir.status !== 0) process.exit(construir.status ?? 1);

// Em memória: cada rodada começa com o catálogo e o estoque iniciais, sem rota de reset na API.
const db = await PGlite.create();
const banco = new PGLiteSocketServer({ db, port: 0, host: '127.0.0.1', maxConnections: 10 });
await banco.start();

const api = spawn(process.execPath, ['dist/main.js'], {
  stdio: ['ignore', 'inherit', 'inherit'],
  env: {
    ...process.env,
    DATABASE_URL: `postgres://postgres:postgres@${banco.getServerConn()}/postgres?sslmode=disable`,
    DB_POOL_MAX: '1', // PGlite: uma conexão real (veja scripts/dev.mjs)
    PORT: String(PORTA_API),
    CORS_ORIGENS: `http://127.0.0.1:${PORTA_FRONT}`,
    JWT_SEGREDO: 'segredo-do-e2e-do-front-nao-usar-em-producao',
    // A suíte inteira entra e cadastra do mesmo IP; o limite tem teste próprio no e2e da API.
    LOGIN_MAX_POR_IP: '100000',
    LOGIN_MAX_FALHAS: '100000',
  },
});

let codigo = 1;
try {
  await esperarSaude();
  // spawn, não spawnSync: o PGlite roda neste processo, e travar o loop de eventos
  // deixaria toda consulta da API pendurada.
  const pw = spawn('npx', ['playwright', 'test', ...process.argv.slice(2)], {
    cwd: FRONT,
    stdio: 'inherit',
    shell: true,
    env: {
      ...process.env,
      VITE_API_URL: `${API}/api`,
      VITE_SOCKET_URL: API,
      PW_PORTA: String(PORTA_FRONT),
    },
  });
  codigo = await new Promise((r) => pw.on('exit', (c) => r(c ?? 1)));
} finally {
  api.kill();
  await banco.stop();
  await db.close();
}
process.exit(codigo);

async function esperarSaude() {
  const limite = Date.now() + 60_000;
  while (Date.now() < limite) {
    if (api.exitCode !== null) throw new Error('A API caiu antes de subir.');
    try {
      if ((await fetch(`${API}/api/saude`)).ok) return;
    } catch {
      // ainda subindo
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('A API não respondeu /api/saude em 60 s.');
}
