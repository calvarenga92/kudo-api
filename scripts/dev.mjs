// Desenvolvimento sem Docker: sobe um Postgres local (PGlite, dados em .banco-local/)
// e a API em modo watch apontando para ele. Com Docker, use `docker compose up`.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

const PORTA_BANCO = Number(process.env.PORTA_BANCO ?? 5433);

const db = await PGlite.create('./.banco-local');
const servidor = new PGLiteSocketServer({
  db,
  port: PORTA_BANCO,
  host: '127.0.0.1',
  // Aceita várias conexões (senão as excedentes caem com ECONNRESET)...
  maxConnections: 10,
});
await servidor.start();

const urlBanco = `postgres://postgres:postgres@127.0.0.1:${PORTA_BANCO}/postgres?sslmode=disable`;
console.log(`Banco local em ${urlBanco}`);

const nest = createRequire(import.meta.url).resolve('@nestjs/cli/bin/nest.js');
const api = spawn(process.execPath, [nest, 'start', '--watch'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    DATABASE_URL: process.env.DATABASE_URL ?? urlBanco,
    // ...mas a API usa uma só: o PGlite é uma conexão de verdade, e consultas simultâneas
    // multiplexadas misturam comandos preparados ("unnamed prepared statement does not exist").
    // Num Postgres real (Docker, AWS) o pool volta ao padrão de 10.
    DB_POOL_MAX: process.env.DATABASE_URL ? process.env.DB_POOL_MAX : '1',
    // Só para desenvolvimento local; produção define o seu (veja .env.example).
    JWT_SEGREDO: process.env.JWT_SEGREDO ?? 'segredo-local-de-desenvolvimento-nao-usar-em-producao',
  },
});

let encerrando = false;
async function encerrar(codigo = 0) {
  if (encerrando) return;
  encerrando = true;
  // No Windows, kill() derruba só o watcher e a API que ele subiu fica órfã segurando a porta.
  if (process.platform === 'win32' && api.pid) {
    spawn('taskkill', ['/pid', String(api.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    api.kill();
  }
  await servidor.stop();
  await db.close();
  process.exit(codigo);
}

api.on('exit', (codigo) => void encerrar(codigo ?? 0));
process.on('SIGINT', () => void encerrar());
process.on('SIGTERM', () => void encerrar());
