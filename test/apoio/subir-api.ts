import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { inject } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { configurarApp } from '../../src/configurar-app.js';

/** Sobe a API como o main.ts sobe, apontando para o banco de teste. */
export async function subirApi(): Promise<INestApplication> {
  process.env.DATABASE_URL = inject('urlBanco');
  const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = modulo.createNestApplication({ logger: false });
  configurarApp(app, ['http://localhost:5173']);
  await app.init();
  return app;
}
