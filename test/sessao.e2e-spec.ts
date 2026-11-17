import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { subirApi } from './apoio/subir-api.js';

const DEMO = { email: 'claudio@kudo.test', senha: 'senha12345' };

describe('Sessão e conta (e2e)', () => {
  let app: INestApplication<App>;
  let banco: DataSource;
  const http = () => request(app.getHttpServer());
  const entrar = (corpo: object) => http().post('/api/sessao').send(corpo);
  const comToken = (token: string) => ({ Authorization: `Bearer ${token}` });
  const emailNovo = () => `pessoa-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@kudo.test`;

  beforeAll(async () => {
    app = await subirApi();
    banco = app.get(DataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /api/sessao', () => {
    it('entra com a conta de demonstração e devolve token, usuário e validade de 1 hora', async () => {
      const antes = Date.now();
      const { body } = await entrar(DEMO).expect(200);
      expect(body.token).toEqual(expect.any(String));
      expect(body.usuario).toEqual({
        id: 'usr-1', nome: 'Claudio Alvarenga', email: 'claudio@kudo.test', avatarUrl: null,
      });
      const validade = new Date(body.expiraEm).getTime() - antes;
      expect(validade).toBeGreaterThan(59 * 60 * 1000);
      expect(validade).toBeLessThanOrEqual(61 * 60 * 1000);
    });

    it('e-mail não diferencia maiúsculas nem espaços nas pontas', async () => {
      await entrar({ email: '  CLAUDIO@Kudo.Test ', senha: DEMO.senha }).expect(200);
    });

    it('senha errada e e-mail inexistente recebem exatamente a mesma resposta', async () => {
      const senhaErrada = await entrar({ ...DEMO, senha: 'outra-senha' }).expect(401);
      const semConta = await entrar({ email: 'ninguem@kudo.test', senha: 'outra-senha' }).expect(401);
      expect(senhaErrada.body).toEqual({ codigo: 'CREDENCIAIS_INVALIDAS', mensagem: 'E-mail ou senha incorretos.' });
      expect(semConta.body).toEqual(senhaErrada.body);
    });

    it('campos vazios devolvem 422 apontando cada um', async () => {
      const { body } = await entrar({}).expect(422);
      expect(body.codigo).toBe('DADOS_INVALIDOS');
      expect(Object.keys(body.campos).sort()).toEqual(['email', 'senha']);
    });

    it('corpo que não é objeto é tratado como vazio, não derruba a API', async () => {
      await http().post('/api/sessao').set('Content-Type', 'application/json').send('[1,2]').expect(422);
    });
  });

  describe('GET /api/sessao', () => {
    it('visitante recebe 204 sem corpo', async () => {
      const resposta = await http().get('/api/sessao').expect(204);
      expect(resposta.text).toBe('');
    });

    it('com token válido devolve a sessão', async () => {
      const { body: { token } } = await entrar(DEMO);
      const { body } = await http().get('/api/sessao').set(comToken(token)).expect(200);
      expect(body.usuario.id).toBe('usr-1');
      expect(body).not.toHaveProperty('token');
    });

    it('token adulterado é recusado como sessão expirada', async () => {
      const { body: { token } } = await entrar(DEMO);
      const [cabecalho, , assinatura] = token.split('.');
      const outroDono = Buffer.from(JSON.stringify({ sub: 'usr-2', jti: 'x' })).toString('base64url');
      const { body } = await http().get('/api/sessao').set(comToken(`${cabecalho}.${outroDono}.${assinatura}`)).expect(401);
      expect(body.codigo).toBe('SESSAO_EXPIRADA');
    });

    it('token sem assinatura (alg: none) é recusado', async () => {
      const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
      const semAssinatura = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: 'usr-1', jti: 'x' })}.`;
      await http().get('/api/sessao').set(comToken(semAssinatura)).expect(401);
    });

    it('sessão vencida no servidor devolve SESSAO_EXPIRADA, mesmo com o JWT ainda no prazo', async () => {
      const { body: { token } } = await entrar(DEMO);
      const { jti } = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
      await banco.query(`UPDATE sessoes SET expira_em = now() - interval '1 second' WHERE id = $1`, [jti]);
      const { body } = await http().get('/api/sessao').set(comToken(token)).expect(401);
      expect(body).toEqual({ codigo: 'SESSAO_EXPIRADA', mensagem: 'Sua sessão expirou. Entre novamente.' });
    });
  });

  describe('DELETE /api/sessao', () => {
    it('sair revoga o token na hora; sair de novo continua 204', async () => {
      const { body: { token } } = await entrar(DEMO);
      await http().delete('/api/sessao').set(comToken(token)).expect(204);
      await http().get('/api/sessao').set(comToken(token)).expect(401);
      await http().delete('/api/sessao').set(comToken(token)).expect(204);
    });

    it('sair de uma sessão não derruba as outras da mesma conta', async () => {
      const { body: { token: celular } } = await entrar(DEMO);
      const { body: { token: computador } } = await entrar(DEMO);
      await http().delete('/api/sessao').set(comToken(celular)).expect(204);
      await http().get('/api/sessao').set(comToken(computador)).expect(200);
    });
  });

  describe('POST /api/contas', () => {
    it('cadastra, já entra e grava só o hash da senha', async () => {
      const email = emailNovo();
      const { body } = await http().post('/api/contas')
        .send({ nome: '  Ana Lima ', email, senha: 'segredo-forte' })
        .expect(201);
      expect(body.usuario).toEqual({ id: expect.stringMatching(/^usr-/), nome: 'Ana Lima', email, avatarUrl: null });
      await http().get('/api/sessao').set(comToken(body.token)).expect(200);

      const [{ senha_hash }] = await banco.query(`SELECT senha_hash FROM contas WHERE id = $1`, [body.usuario.id]);
      expect(senha_hash).not.toContain('segredo-forte');
      await entrar({ email, senha: 'segredo-forte' }).expect(200);
    });

    it('valida campo a campo como o mock', async () => {
      const { body } = await http().post('/api/contas').send({ nome: ' ', email: 'sem-arroba', senha: '123' }).expect(422);
      expect(body.campos).toEqual({
        nome: 'Informe seu nome.',
        email: 'E-mail inválido.',
        senha: 'Use ao menos 8 caracteres.',
      });
    });

    it('recusa senha gigante antes de gastar CPU com hash', async () => {
      const { body } = await http().post('/api/contas')
        .send({ nome: 'Ana', email: emailNovo(), senha: 'a'.repeat(129) }).expect(422);
      expect(Object.keys(body.campos)).toEqual(['senha']);
    });

    it('e-mail já cadastrado, com outra caixa, devolve 409', async () => {
      const { body } = await http().post('/api/contas')
        .send({ nome: 'Outro', email: 'Claudio@KUDO.test', senha: 'senha12345' }).expect(409);
      expect(body.codigo).toBe('EMAIL_JA_CADASTRADO');
    });
  });

  describe('PATCH /api/perfil', () => {
    it('sem token devolve 401 NAO_AUTENTICADO', async () => {
      const { body } = await http().patch('/api/perfil').send({ nome: 'X' }).expect(401);
      expect(body.codigo).toBe('NAO_AUTENTICADO');
    });

    it('troca o nome de quem está logado e de mais ninguém', async () => {
      const { body: { token } } = await http().post('/api/contas')
        .send({ nome: 'Bia', email: emailNovo(), senha: 'senha12345' });
      const { body } = await http().patch('/api/perfil').set(comToken(token)).send({ nome: ' Beatriz ' }).expect(200);
      expect(body.nome).toBe('Beatriz');

      const [{ nome }] = await banco.query(`SELECT nome FROM contas WHERE id = 'usr-1'`);
      expect(nome).toBe('Claudio Alvarenga');
    });

    it('nome vazio devolve 422', async () => {
      const { body: { token } } = await entrar(DEMO);
      const { body } = await http().patch('/api/perfil').set(comToken(token)).send({ nome: '' }).expect(422);
      expect(body.campos).toEqual({ nome: 'Informe seu nome.' });
    });
  });
});
