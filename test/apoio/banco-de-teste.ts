import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import pg from 'pg';
import type { TestProject } from 'vitest/node';

/**
 * Banco do e2e.
 *
 * Padrão: Postgres de verdade (protocolo e SQL), em memória, sem Docker: o e2e
 * roda em qualquer máquina e no CI. A API fala com ele pelo driver `pg`, igual
 * falaria com o Postgres do docker-compose ou da AWS. Limite: o PGlite atende
 * uma conexão por vez, então as compras "simultâneas" chegam em série.
 *
 * Com `E2E_DATABASE_URL` (ex.: o Postgres do docker-compose), o e2e usa esse
 * banco com pool de várias conexões: as travas de concorrência passam a ser
 * exercitadas de verdade. O esquema `public` é apagado e recriado antes.
 */
export default async function iniciar(projeto: TestProject) {
  const urlExterna = process.env.E2E_DATABASE_URL?.trim();
  if (urlExterna) {
    const cliente = new pg.Client({ connectionString: urlExterna });
    await cliente.connect();
    await cliente.query('DROP SCHEMA IF EXISTS public CASCADE');
    await cliente.query('CREATE SCHEMA public');
    await cliente.end();
    projeto.provide('urlBanco', urlExterna);
    projeto.provide('poolBanco', '10');
    return;
  }

  const db = await PGlite.create();
  const servidor = new PGLiteSocketServer({ db, port: 0, host: '127.0.0.1', maxConnections: 10 });
  await servidor.start();

  const url = `postgres://postgres:postgres@${servidor.getServerConn()}/postgres?sslmode=disable`;
  projeto.provide('urlBanco', url);
  // PGlite: uma conexão real só (veja scripts/dev.mjs).
  projeto.provide('poolBanco', '1');

  return async () => {
    await servidor.stop();
    await db.close();
  };
}

declare module 'vitest' {
  export interface ProvidedContext {
    urlBanco: string;
    poolBanco: string;
  }
}
