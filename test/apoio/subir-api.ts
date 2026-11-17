import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { inject } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { configurarApp } from '../../src/configurar-app.js';

/** Sobe a API como o main.ts sobe, apontando para o banco de teste. */
export async function subirApi(): Promise<INestApplication> {
  process.env.DATABASE_URL = inject('urlBanco');
  // PGlite: uma conexão real só (veja scripts/dev.mjs).
  process.env.DB_POOL_MAX = '1';
  process.env.JWT_SEGREDO ??= 'segredo-de-teste-com-pelo-menos-32-caracteres';
  const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = modulo.createNestApplication({ logger: false });
  configurarApp(app, ['http://localhost:5173']);
  await app.init();
  return app;
}
