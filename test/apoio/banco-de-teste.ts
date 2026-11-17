import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import type { TestProject } from 'vitest/node';

/**
 * Postgres de verdade (protocolo e SQL), em memória, sem Docker: o e2e roda
 * em qualquer máquina e no CI. A API fala com ele pelo driver `pg`, igual
 * falaria com o Postgres do docker-compose ou da AWS.
 */
export default async function iniciar(projeto: TestProject) {
  const db = await PGlite.create();
  const servidor = new PGLiteSocketServer({ db, port: 0, host: '127.0.0.1' });
  await servidor.start();

  const endereco = servidor.getServerConn();
  process.env.DATABASE_URL = `postgres://postgres:postgres@${endereco}/postgres?sslmode=disable`;
  projeto.provide('urlBanco', process.env.DATABASE_URL);

  return async () => {
    await servidor.stop();
    await db.close();
  };
}

declare module 'vitest' {
  export interface ProvidedContext {
    urlBanco: string;
  }
}
