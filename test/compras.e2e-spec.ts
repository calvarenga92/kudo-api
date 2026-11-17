import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import request from 'supertest';
import type { Cotacao } from '@calvarenga92/kurio-regras';
import { subirApi } from './apoio/subir-api.js';

const CARRINHO = 'x-carrinho-visitante';
const DEMO = { email: 'claudio@kudo.test', senha: 'senha12345' };

describe('Favoritos, carteiras e carrinho (e2e)', () => {
  let app: INestApplication<App>;
  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  /** Conta nova por teste: estado isolado, sem depender da ordem. */
  async function contaNova(): Promise<string> {
    const email = `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@kudo.test`;
    const { body } = await http().post('/api/contas').send({ nome: 'Teste', email, senha: 'senha12345' }).expect(201);
    return body.token;
  }

  beforeAll(async () => {
    app = await subirApi();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('favoritos', () => {
    it('visitante tem lista vazia e não pode favoritar', async () => {
      expect((await http().get('/api/favoritos').expect(200)).body).toEqual([]);
      const { body } = await http().put('/api/favoritos/nft-001').expect(401);
      expect(body.codigo).toBe('NAO_AUTENTICADO');
    });

    it('favoritar marca a peça no catálogo e na lista; repetir não duplica; desfazer tira', async () => {
      const token = await contaNova();
      expect((await http().put('/api/favoritos/nft-003').set(auth(token)).expect(200)).body).toEqual({ favorito: true });
      await http().put('/api/favoritos/nft-003').set(auth(token)).expect(200);

      const lista = (await http().get('/api/favoritos').set(auth(token))).body;
      expect(lista.map((n: { id: string }) => n.id)).toEqual(['nft-003']);
      expect((await http().get('/api/nfts/nft-003').set(auth(token))).body.favorito).toBe(true);
      const pagina = (await http().get('/api/nfts?porPagina=60').set(auth(token))).body;
      expect(pagina.itens.filter((n: { favorito: boolean }) => n.favorito)).toHaveLength(1);

      // Outra conta e o visitante não enxergam o favorito alheio.
      expect((await http().get('/api/nfts/nft-003').set(auth(await contaNova()))).body.favorito).toBe(false);
      expect((await http().get('/api/nfts/nft-003')).body.favorito).toBe(false);

      expect((await http().delete('/api/favoritos/nft-003').set(auth(token)).expect(200)).body).toEqual({ favorito: false });
      expect((await http().get('/api/favoritos').set(auth(token))).body).toEqual([]);
    });

    it('favoritar peça inexistente devolve 404', async () => {
      await http().put('/api/favoritos/nao-existe').set(auth(await contaNova())).expect(404);
    });

    it('token vencido no catálogo conta como visitante, não quebra a vitrine', async () => {
      await http().get('/api/nfts').set(auth('token.invalido.qualquer')).expect(200);
    });
  });

  describe('carteiras', () => {
    const endereco = (n: number) => `0x${n.toString(16).padStart(40, '0')}`;

    it('exige conta', async () => {
      await http().get('/api/carteiras').expect(401);
    });

    it('conta de demonstração já tem a carteira principal do mock', async () => {
      const { body: { token } } = await http().post('/api/sessao').send(DEMO);
      const carteiras = (await http().get('/api/carteiras').set(auth(token)).expect(200)).body;
      expect(carteiras[0]).toMatchObject({ id: 'usr-1-w1', apelido: 'Principal', rede: 'ethereum', principal: true });
    });

    it('primeira nasce principal; troca de principal; remover a principal promove a mais antiga', async () => {
      const token = await contaNova();
      const a = (await http().post('/api/carteiras').set(auth(token))
        .send({ apelido: 'A', endereco: endereco(1), rede: 'ethereum' }).expect(201)).body;
      const b = (await http().post('/api/carteiras').set(auth(token))
        .send({ apelido: 'B', endereco: endereco(2), rede: 'polygon' }).expect(201)).body;
      const c = (await http().post('/api/carteiras').set(auth(token))
        .send({ apelido: 'C', endereco: endereco(3), rede: 'arbitrum' }).expect(201)).body;
      expect([a.principal, b.principal, c.principal]).toEqual([true, false, false]);

      let lista = (await http().put(`/api/carteiras/${c.id}/principal`).set(auth(token)).expect(200)).body;
      expect(lista.filter((w: { principal: boolean }) => w.principal).map((w: { id: string }) => w.id)).toEqual([c.id]);

      lista = (await http().delete(`/api/carteiras/${c.id}`).set(auth(token)).expect(200)).body;
      expect(lista.map((w: { id: string; principal: boolean }) => [w.id, w.principal])).toEqual([[a.id, true], [b.id, false]]);
    });

    it('valida campos e recusa endereço repetido sem diferenciar maiúsculas', async () => {
      const token = await contaNova();
      const { body } = await http().post('/api/carteiras').set(auth(token))
        .send({ apelido: '', endereco: '0x123', rede: 'solana' }).expect(422);
      expect(Object.keys(body.campos).sort()).toEqual(['apelido', 'endereco', 'rede']);

      const end = `0x${'aB'.repeat(20)}`;
      await http().post('/api/carteiras').set(auth(token)).send({ apelido: 'X', endereco: end, rede: 'ethereum' }).expect(201);
      const repetida = await http().post('/api/carteiras').set(auth(token))
        .send({ apelido: 'Y', endereco: end.toLowerCase(), rede: 'ethereum' }).expect(422);
      expect(repetida.body.campos).toEqual({ endereco: 'Esta carteira já está cadastrada.' });
    });

    it('carteira de outra conta responde 404, igual a inexistente', async () => {
      const dono = await contaNova();
      const carteira = (await http().post('/api/carteiras').set(auth(dono))
        .send({ apelido: 'Minha', endereco: endereco(9), rede: 'ethereum' })).body;
      const intruso = await contaNova();
      await http().delete(`/api/carteiras/${carteira.id}`).set(auth(intruso)).expect(404);
      await http().put(`/api/carteiras/${carteira.id}/principal`).set(auth(intruso)).expect(404);
      expect((await http().get('/api/carteiras').set(auth(dono))).body).toHaveLength(1);
    });

    it('duas inclusões simultâneas na conta vazia não criam duas principais', async () => {
      const token = await contaNova();
      await Promise.all([10, 11, 12].map((n) =>
        http().post('/api/carteiras').set(auth(token)).send({ apelido: `W${n}`, endereco: endereco(n), rede: 'ethereum' })));
      const lista = (await http().get('/api/carteiras').set(auth(token))).body;
      expect(lista.filter((w: { principal: boolean }) => w.principal)).toHaveLength(1);
    });
  });

  describe('carrinho', () => {
    const item = (nftId = 'nft-001', edicaoId = '1-padrao', quantidade = 1) => ({ nftId, edicaoId, quantidade });

    it('visitante sem carrinho recebe cotação vazia, sem criar nada', async () => {
      const resposta = await http().get('/api/carrinho').expect(200);
      expect(resposta.headers[CARRINHO]).toBeUndefined();
      expect(resposta.body).toMatchObject({ itens: [], subtotalEth: '0', totalEth: '0', cupom: null });
    });

    it('primeiro item cria o carrinho do visitante e devolve o id no cabeçalho exposto ao front', async () => {
      const resposta = await http().post('/api/carrinho/itens').set('Origin', 'http://localhost:5173')
        .send(item()).expect(201);
      expect(resposta.headers[CARRINHO]).toMatch(/^vis-[\w-]{32}$/);
      expect(resposta.headers['access-control-expose-headers']).toMatch(/X-Carrinho-Visitante/i);

      const cotacao = resposta.body as Cotacao;
      expect(cotacao.itens).toHaveLength(1);
      expect(cotacao).toMatchObject({ subtotalEth: '1.99', taxaRedeEth: '0.0042', totalEth: '1.9942' });
      expect(cotacao.versao).toEqual(expect.any(String));
    });

    it('cada visitante enxerga só o próprio carrinho', async () => {
      const a = (await http().post('/api/carrinho/itens').send(item())).headers[CARRINHO];
      const b = (await http().post('/api/carrinho/itens').send(item('nft-002', '2-padrao'))).headers[CARRINHO];
      expect(a).not.toBe(b);
      const deA = (await http().get('/api/carrinho').set(CARRINHO, a)).body;
      expect(deA.itens.map((i: { nftId: string }) => i.nftId)).toEqual(['nft-001']);
      // Id inventado não dá acesso a nada.
      expect((await http().get('/api/carrinho').set(CARRINHO, 'vis-chute')).body.itens).toEqual([]);
    });

    it('somar a mesma edição acumula; passar do limite por pedido devolve 422; esgotar devolve 409', async () => {
      const token = await contaNova();
      await http().post('/api/carrinho/itens').set(auth(token)).send(item('nft-001', '1-padrao', 2)).expect(201);
      const soma = (await http().post('/api/carrinho/itens').set(auth(token)).send(item('nft-001', '1-padrao', 1))).body;
      expect(soma.itens[0].quantidade).toBe(3);

      const limite = await http().post('/api/carrinho/itens').set(auth(token)).send(item('nft-001', '1-padrao', 1)).expect(409);
      expect(limite.body).toEqual({ codigo: 'DISPONIBILIDADE_INSUFICIENTE', mensagem: 'Restam 3 unidades desta edição.' });

      // nft-005 tem 7 unidades padrão e limite 3 por pedido.
      const acima = await http().post('/api/carrinho/itens').set(auth(token)).send(item('nft-005', '5-padrao', 4)).expect(422);
      expect(acima.body.campos).toEqual({ quantidade: 'Limite de 3 unidades por pedido.' });

      // nft-008 está esgotado.
      const esgotado = await http().post('/api/carrinho/itens').set(auth(token)).send(item('nft-008', '8-padrao')).expect(409);
      expect(esgotado.body.mensagem).toBe('Esta edição esgotou.');
    });

    it('edição que não pertence à peça devolve 404', async () => {
      await http().post('/api/carrinho/itens').send(item('nft-001', '2-padrao')).expect(404);
    });

    it('ajusta quantidade, remove com zero e recalcula o total em 18 casas', async () => {
      const token = await contaNova();
      const { body } = await http().post('/api/carrinho/itens').set(auth(token)).send(item('nft-001', '1-rara'));
      expect(body.subtotalEth).toBe('4.975');

      const outro = (await http().post('/api/carrinho/itens').set(auth(token)).send(item('nft-002', '2-padrao', 2))).body;
      const id = outro.itens[1].id;
      const ajustado = (await http().patch(`/api/carrinho/itens/${id}`).set(auth(token)).send({ quantidade: 1 }).expect(200)).body;
      expect(ajustado.subtotalEth).toBe('6.665');

      const removido = (await http().patch(`/api/carrinho/itens/${id}`).set(auth(token)).send({ quantidade: 0 }).expect(200)).body;
      expect(removido.itens).toHaveLength(1);

      await http().patch(`/api/carrinho/itens/${id}`).set(auth(token)).send({ quantidade: 1 }).expect(404);
      await http().patch(`/api/carrinho/itens/${removido.itens[0].id}`).set(auth(token)).send({ quantidade: 1.5 }).expect(422);
    });

    it('não altera item de outro carrinho', async () => {
      const dono = await contaNova();
      const { body } = await http().post('/api/carrinho/itens').set(auth(dono)).send(item());
      const intruso = await contaNova();
      await http().patch(`/api/carrinho/itens/${body.itens[0].id}`).set(auth(intruso)).send({ quantidade: 2 }).expect(404);
      await http().delete(`/api/carrinho/itens/${body.itens[0].id}`).set(auth(intruso)).expect(200);
      expect((await http().get('/api/carrinho').set(auth(dono))).body.itens).toHaveLength(1);
    });

    it('cupom: válido desconta, inválido e expirado têm código próprio, remover volta ao total', async () => {
      const token = await contaNova();
      await http().post('/api/carrinho/itens').set(auth(token)).send(item('nft-001', '1-padrao', 2));

      const comCupom = (await http().post('/api/carrinho/cupom').set(auth(token)).send({ codigo: ' kurio10 ' }).expect(200)).body;
      expect(comCupom.cupom).toEqual({ codigo: 'KURIO10', descricaoDesconto: '10% de desconto' });
      expect(comCupom).toMatchObject({ subtotalEth: '3.98', descontoEth: '0.398', totalEth: '3.5862' });

      expect((await http().post('/api/carrinho/cupom').set(auth(token)).send({ codigo: 'NADA' }).expect(422)).body.codigo)
        .toBe('CUPOM_INVALIDO');
      expect((await http().post('/api/carrinho/cupom').set(auth(token)).send({ codigo: 'EXPIRADO50' }).expect(422)).body.codigo)
        .toBe('CUPOM_EXPIRADO');

      const semCupom = (await http().delete('/api/carrinho/cupom').set(auth(token)).expect(200)).body;
      expect(semCupom).toMatchObject({ cupom: null, descontoEth: '0', totalEth: '3.9842' });
    });

    it('versão da cotação muda quando quantidade ou cupom mudam', async () => {
      const token = await contaNova();
      const v1 = (await http().post('/api/carrinho/itens').set(auth(token)).send(item())).body.versao;
      const v2 = (await http().post('/api/carrinho/cupom').set(auth(token)).send({ codigo: 'KURIO10' })).body.versao;
      expect(v2).not.toBe(v1);
      expect((await http().get('/api/carrinho').set(auth(token))).body.versao).toBe(v2);
    });

    it('cliques simultâneos em adicionar não furam o limite por pedido', async () => {
      const token = await contaNova();
      const respostas = await Promise.all(Array.from({ length: 5 }, () =>
        http().post('/api/carrinho/itens').set(auth(token)).send(item('nft-005', '5-padrao', 1))));
      expect(respostas.filter((r) => r.status === 201)).toHaveLength(3);
      expect((await http().get('/api/carrinho').set(auth(token))).body.itens[0].quantidade).toBe(3);
    });

    it('ao entrar, o carrinho do visitante passa para a conta e o de visitante deixa de existir', async () => {
      const visitante = (await http().post('/api/carrinho/itens').send(item('nft-002', '2-padrao', 2))).headers[CARRINHO];
      await http().post('/api/carrinho/cupom').set(CARRINHO, visitante).send({ codigo: 'COLECIONADOR20' });

      const email = `m-${Date.now()}@kudo.test`;
      const { body } = await http().post('/api/contas').set(CARRINHO, visitante)
        .send({ nome: 'Mescla', email, senha: 'senha12345' }).expect(201);

      const daConta = (await http().get('/api/carrinho').set(auth(body.token))).body;
      expect(daConta.itens.map((i: { edicaoId: string; quantidade: number }) => [i.edicaoId, i.quantidade]))
        .toEqual([['2-padrao', 2]]);
      expect(daConta.cupom.codigo).toBe('COLECIONADOR20');
      expect((await http().get('/api/carrinho').set(CARRINHO, visitante)).body.itens).toEqual([]);

      // Segundo login com outro carrinho de visitante soma a mesma edição.
      const outro = (await http().post('/api/carrinho/itens').send(item('nft-002', '2-padrao', 1))).headers[CARRINHO];
      const login = await http().post('/api/sessao').set(CARRINHO, outro).send({ email, senha: 'senha12345' }).expect(200);
      const somado = (await http().get('/api/carrinho').set(auth(login.body.token))).body;
      expect(somado.itens[0].quantidade).toBe(3);
    });
  });
});
