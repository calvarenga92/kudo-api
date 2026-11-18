import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import request from 'supertest';
import { subirApi } from './apoio/subir-api.js';

const DEMO = { email: 'claudio@kudo.test', senha: 'senha12345' };

describe('Limite de tentativas de login (e2e)', () => {
  let app: INestApplication<App>;
  const http = () => request(app.getHttpServer());
  const entrar = (corpo: object) => http().post('/api/sessao').send(corpo);
  const errar = (email = DEMO.email) => entrar({ email, senha: 'senha-errada' });

  beforeAll(async () => {
    process.env.LOGIN_MAX_FALHAS = '3';
    process.env.LOGIN_MAX_POR_IP = '12';
    app = await subirApi();
  });

  afterAll(async () => {
    await app.close();
    // As outras suítes não podem herdar o limite baixo.
    process.env.LOGIN_MAX_FALHAS = '100000';
    process.env.LOGIN_MAX_POR_IP = '100000';
  });

  it('login certo zera as falhas anteriores', async () => {
    await errar().expect(401);
    await errar().expect(401);
    await entrar(DEMO).expect(200);
    await errar().expect(401);
    await errar().expect(401);
    await entrar(DEMO).expect(200);
  });

  it('depois de 3 senhas erradas, o e-mail fica bloqueado nesse IP, até com a senha certa', async () => {
    for (let i = 0; i < 3; i++) await errar().expect(401);

    const bloqueado = await entrar(DEMO).expect(429);
    expect(bloqueado.body).toEqual({
      codigo: 'MUITAS_TENTATIVAS',
      mensagem: 'Muitas tentativas. Tente de novo em 15 minutos.',
    });
    const espera = Number(bloqueado.headers['retry-after']);
    expect(espera).toBeGreaterThan(14 * 60);
    expect(espera).toBeLessThanOrEqual(15 * 60);
  });

  it('o bloqueio é do e-mail: outra conta no mesmo IP ainda tenta', async () => {
    await errar('outra-pessoa@kudo.test').expect(401);
  });

  it('não dá para fugir trocando X-Forwarded-For quando a API não está atrás de proxy', async () => {
    await http()
      .post('/api/sessao')
      .set('X-Forwarded-For', '203.0.113.9')
      .send(DEMO)
      .expect(429);
  });

  it('por IP, toda tentativa conta (até as bloqueadas); passou de 12, nem o cadastro passa', async () => {
    // Até aqui: 6 + 4 + 1 + 1 = 12 tentativas deste IP. A 13ª, mesmo de cadastro, é recusada.
    const { body, headers } = await http().post('/api/contas').send({}).expect(429);
    expect(body.codigo).toBe('MUITAS_TENTATIVAS');
    expect(Number(headers['retry-after'])).toBeGreaterThan(0);
  });
});
