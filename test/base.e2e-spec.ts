import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { subirApi } from './apoio/subir-api.js';

describe('Base da API (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await subirApi();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/saude responde 200 quando o banco responde', async () => {
    const resposta = await request(app.getHttpServer()).get('/api/saude').expect(200);
    expect(resposta.body).toEqual({ status: 'ok', banco: 'ok' });
  });

  it('rota inexistente devolve 404 no formato do contrato', async () => {
    const resposta = await request(app.getHttpServer()).get('/api/nao-existe').expect(404);
    expect(resposta.body).toEqual({ codigo: 'NAO_ENCONTRADO', mensagem: 'Recurso não encontrado.' });
  });

  it('rota fora do prefixo /api também não existe', async () => {
    await request(app.getHttpServer()).get('/saude').expect(404);
  });

  it('libera CORS para a origem do front e o cabeçalho de idempotência', async () => {
    const resposta = await request(app.getHttpServer())
      .options('/api/saude')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'idempotency-key,authorization');
    expect(resposta.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(resposta.headers['access-control-allow-headers']).toMatch(/Idempotency-Key/);
  });

  it('não libera CORS para origem desconhecida', async () => {
    const resposta = await request(app.getHttpServer())
      .get('/api/saude')
      .set('Origin', 'https://site-qualquer.com');
    expect(resposta.headers['access-control-allow-origin']).toBeUndefined();
  });
});
