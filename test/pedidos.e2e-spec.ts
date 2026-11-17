import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import request from 'supertest';
import { DataSource } from 'typeorm';
import type { Pedido } from '@calvarenga92/kurio-regras';
import { subirApi } from './apoio/subir-api.js';

/**
 * O banco de teste é compartilhado entre as suítes e compra baixa estoque de verdade:
 * aqui só entram peças (nft-010 a nft-016) que nenhuma outra suíte confere,
 * e nenhuma é esgotada por completo.
 */
describe('Pedidos e checkout (e2e)', () => {
  let app: INestApplication<App>;
  let banco: DataSource;
  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  let sequencia = 0;
  const chave = () => `chave-${Date.now()}-${++sequencia}`;

  async function contaNova(): Promise<string> {
    const email = `p-${Date.now()}-${++sequencia}@kudo.test`;
    const { body } = await http().post('/api/contas').send({ nome: 'Compradora', email, senha: 'senha12345' }).expect(201);
    await http().post('/api/carteiras').set(auth(body.token))
      .send({ apelido: 'Principal', endereco: `0x${'1'.repeat(40)}`, rede: 'ethereum' }).expect(201);
    return body.token;
  }

  async function noCarrinho(token: string, nftId: string, edicaoId: string, quantidade = 1): Promise<string> {
    const { body } = await http().post('/api/carrinho/itens').set(auth(token)).send({ nftId, edicaoId, quantidade }).expect(201);
    return body.versao;
  }

  const comprar = (token: string, idem: string, corpo: object) =>
    http().post('/api/pedidos').set(auth(token)).set('Idempotency-Key', idem).send(corpo);

  const estoque = async (edicaoId: string) =>
    (await banco.query(`SELECT disponivel FROM edicoes WHERE id = $1`, [edicaoId]))[0].disponivel as number;

  beforeAll(async () => {
    app = await subirApi();
    banco = app.get(DataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  it('exige conta e chave de idempotência; carrinho vazio não vira pedido', async () => {
    await http().post('/api/pedidos').send({ versaoCotacao: 'x' }).expect(401);
    const token = await contaNova();
    const semChave = await http().post('/api/pedidos').set(auth(token)).send({ versaoCotacao: 'x' }).expect(422);
    expect(semChave.body.mensagem).toBe('Idempotency-Key é obrigatória.');
    const vazio = await comprar(token, chave(), { versaoCotacao: 'x' }).expect(422);
    expect(vazio.body.mensagem).toBe('O carrinho está vazio.');
  });

  it('compra completa: recibo imutável, estoque baixa, versão da peça sobe e o carrinho esvazia', async () => {
    const token = await contaNova();
    const antes = await estoque('10-padrao');
    await noCarrinho(token, 'nft-010', '10-padrao', 2);
    const { body: cotacao } = await http().post('/api/carrinho/cupom').set(auth(token)).send({ codigo: 'KURIO10' });

    const { body: pedido } = await comprar(token, chave(), { versaoCotacao: cotacao.versao }).expect(201);
    expect(pedido).toMatchObject({
      id: expect.stringMatching(/^ped-/),
      status: 'CONFIRMADO',
      subtotalEth: cotacao.subtotalEth,
      descontoEth: cotacao.descontoEth,
      totalEth: cotacao.totalEth,
      cupom: { codigo: 'KURIO10', descricaoDesconto: '10% de desconto' },
      carteira: { apelido: 'Principal', endereco: `0x${'1'.repeat(40)}`, rede: 'ethereum' },
      referenciaTransacao: expect.stringMatching(/^0x[0-9a-f]{32}$/),
      motivoRecusa: null,
      versao: 1,
    });
    expect(pedido.itens).toEqual([{
      nftId: 'nft-010', edicaoId: '10-padrao', titulo: 'Amber Relic #233', imagemUrl: '/nfts/nft-10.png',
      rotuloEdicao: 'Padrão', quantidade: 2, precoUnitarioEth: '3.4', subtotalEth: '6.8',
    }]);

    expect(await estoque('10-padrao')).toBe(antes - 2);
    expect((await http().get('/api/nfts/nft-010')).body.versao).toBeGreaterThan(1);
    expect((await http().get('/api/carrinho').set(auth(token))).body).toMatchObject({ itens: [], cupom: null });

    // O recibo não muda se o catálogo mudar depois.
    await banco.query(`UPDATE edicoes SET preco_eth = 9.99 WHERE id = '10-padrao'`);
    const recibo = (await http().get(`/api/pedidos/${pedido.id}`).set(auth(token)).expect(200)).body;
    expect(recibo.itens[0].precoUnitarioEth).toBe('3.4');
    await banco.query(`UPDATE edicoes SET preco_eth = 3.40 WHERE id = '10-padrao'`);

    const lista = (await http().get('/api/pedidos').set(auth(token)).expect(200)).body as Pedido[];
    expect(lista.map((p) => p.id)).toEqual([pedido.id]);
  });

  it('reenvio com a mesma chave e o mesmo corpo devolve o mesmo pedido, sem cobrar de novo', async () => {
    const token = await contaNova();
    const versao = await noCarrinho(token, 'nft-012', '12-padrao');
    const antes = await estoque('12-padrao');
    const idem = chave();

    const primeiro = (await comprar(token, idem, { versaoCotacao: versao }).expect(201)).body;
    const segundo = (await comprar(token, idem, { versaoCotacao: versao }).expect(200)).body;
    expect(segundo).toEqual(primeiro);
    expect(await estoque('12-padrao')).toBe(antes - 1);
    expect((await http().get('/api/pedidos').set(auth(token))).body).toHaveLength(1);
  });

  it('mesma chave com outro corpo é recusada como conflito', async () => {
    const token = await contaNova();
    const versao = await noCarrinho(token, 'nft-012', '12-padrao');
    const idem = chave();
    await comprar(token, idem, { versaoCotacao: versao }).expect(201);
    const { body } = await comprar(token, idem, { versaoCotacao: 'outra' }).expect(409);
    expect(body.codigo).toBe('CHAVE_IDEMPOTENCIA_CONFLITANTE');
  });

  it('três envios simultâneos com a mesma chave (clique triplo, rede instável) criam um pedido só', async () => {
    const token = await contaNova();
    const versao = await noCarrinho(token, 'nft-014', '14-padrao');
    const antes = await estoque('14-padrao');
    const idem = chave();

    const respostas = await Promise.all([1, 2, 3].map(() => comprar(token, idem, { versaoCotacao: versao })));
    expect(respostas.map((r) => r.status).sort()).toEqual([200, 200, 201]);
    expect(new Set(respostas.map((r) => r.body.id)).size).toBe(1);
    expect(await estoque('14-padrao')).toBe(antes - 1);
  });

  it('cotação que a pessoa não viu (preço mudou) é recusada; a chave não fica queimada', async () => {
    const token = await contaNova();
    const versaoVista = await noCarrinho(token, 'nft-016', '16-padrao');
    const idem = chave();

    await banco.query(`UPDATE edicoes SET preco_eth = 1.10 WHERE id = '16-padrao'`);
    const { body } = await comprar(token, idem, { versaoCotacao: versaoVista }).expect(409);
    expect(body).toEqual({
      codigo: 'COTACAO_DESATUALIZADA',
      mensagem: 'Os valores do carrinho mudaram. Confira o resumo antes de confirmar.',
    });
    expect((await http().get('/api/carrinho').set(auth(token))).body.itens).toHaveLength(1);

    // A pessoa confere o resumo novo e confirma com a mesma chave.
    const novaVersao = (await http().get('/api/carrinho').set(auth(token))).body.versao;
    const pedido = (await comprar(token, idem, { versaoCotacao: novaVersao }).expect(201)).body;
    expect(pedido.totalEth).toBe('1.1042');
    await banco.query(`UPDATE edicoes SET preco_eth = 1.07 WHERE id = '16-padrao'`);
  });

  it('última unidade disputada por duas contas: uma compra, a outra é avisada', async () => {
    const a = await contaNova();
    const b = await contaNova();
    // nft-013 rara tem 1 unidade.
    const versaoA = await noCarrinho(a, 'nft-013', '13-rara');
    const versaoB = await noCarrinho(b, 'nft-013', '13-rara');

    const [ra, rb] = await Promise.all([
      comprar(a, chave(), { versaoCotacao: versaoA }),
      comprar(b, chave(), { versaoCotacao: versaoB }),
    ]);
    expect([ra.status, rb.status].sort()).toEqual([201, 409]);
    expect(await estoque('13-rara')).toBe(0);
  });

  it('pagamento recusado guarda o pedido com o motivo, sem baixar estoque nem esvaziar o carrinho', async () => {
    const token = await contaNova();
    const recusa = (await http().post('/api/carteiras').set(auth(token))
      .send({ apelido: 'Sem saldo', endereco: `0x${'2'.repeat(36)}dead`, rede: 'polygon' })).body;
    const versao = await noCarrinho(token, 'nft-012', '12-rara');
    const antes = await estoque('12-rara');

    const { body } = await comprar(token, chave(), { versaoCotacao: versao, carteiraId: recusa.id }).expect(201);
    expect(body).toMatchObject({
      status: 'RECUSADO', motivoRecusa: 'A carteira recusou a transação.', referenciaTransacao: null,
      carteira: { apelido: 'Sem saldo', rede: 'polygon' },
    });
    expect(await estoque('12-rara')).toBe(antes);
    expect((await http().get('/api/carrinho').set(auth(token))).body.itens).toHaveLength(1);
  });

  it('carteira de outra conta não serve para pagar', async () => {
    const dono = await contaNova();
    const alheia = (await http().get('/api/carteiras').set(auth(dono))).body[0];
    const token = await contaNova();
    const versao = await noCarrinho(token, 'nft-012', '12-padrao');
    const { body } = await comprar(token, chave(), { versaoCotacao: versao, carteiraId: alheia.id }).expect(422);
    expect(body.campos).toEqual({ carteiraId: 'Carteira não encontrada.' });
  });

  it('conta sem carteira é orientada a cadastrar uma', async () => {
    const email = `semcarteira-${Date.now()}@kudo.test`;
    const { body: { token } } = await http().post('/api/contas').send({ nome: 'Sem', email, senha: 'senha12345' });
    const versao = await noCarrinho(token, 'nft-012', '12-padrao');
    const { body } = await comprar(token, chave(), { versaoCotacao: versao }).expect(422);
    expect(body.mensagem).toBe('Cadastre uma carteira para concluir.');
  });

  it('cada conta só vê os próprios pedidos; o de outra responde 404', async () => {
    const dona = await contaNova();
    const versao = await noCarrinho(dona, 'nft-014', '14-padrao');
    const pedido = (await comprar(dona, chave(), { versaoCotacao: versao }).expect(201)).body;

    const intrusa = await contaNova();
    await http().get(`/api/pedidos/${pedido.id}`).set(auth(intrusa)).expect(404);
    expect((await http().get('/api/pedidos').set(auth(intrusa))).body).toEqual([]);
    await http().get(`/api/pedidos/${pedido.id}`).expect(401);
  });
});
