import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { io, type Socket } from 'socket.io-client';
import { subirApi } from './apoio/subir-api.js';

interface Evento { eventoId: string; versao: number; emitidoEm: string; [campo: string]: unknown }

/**
 * Tempo real contra a API de verdade, por socket de verdade. Usa só nft-020 a nft-022,
 * que nenhuma outra suíte confere, e nunca esgota uma edição.
 */
describe('Tempo real (e2e)', () => {
  let app: INestApplication;
  let origem: string;
  const sockets: Socket[] = [];
  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  let sequencia = 0;

  /** Socket que guarda tudo que recebe, para conferir depois o que chegou e o que não chegou. */
  async function conectar() {
    const socket = io(origem, { transports: ['websocket'], forceNew: true, reconnection: false });
    sockets.push(socket);
    const recebidos = { nft: [] as Evento[], pedido: [] as Evento[] };
    socket.on('nft.updated', (e: Evento) => recebidos.nft.push(e));
    socket.on('order.updated', (e: Evento) => recebidos.pedido.push(e));
    await new Promise<void>((ok, falha) => { socket.once('connect', ok); socket.once('connect_error', falha); });
    const identificar = (usuarioId: string | null, token: string | null) =>
      socket.timeout(2000).emitWithAck('session.identify', { usuarioId, token }) as Promise<boolean>;
    return { socket, recebidos, identificar };
  }

  async function contaNova() {
    const email = `rt-${Date.now()}-${++sequencia}@kudo.test`;
    const { body } = await http().post('/api/contas').send({ nome: 'Tempo Real', email, senha: 'senha12345' }).expect(201);
    await http().post('/api/carteiras').set(auth(body.token))
      .send({ apelido: 'Principal', endereco: `0x${'3'.repeat(40)}`, rede: 'ethereum' }).expect(201);
    return { token: body.token as string, id: body.usuario.id as string, email };
  }

  /** Põe uma unidade no carrinho e confirma; devolve o pedido criado (201). */
  async function comprar(token: string, nftId: string, edicaoId: string) {
    const { body: cotacao } = await http().post('/api/carrinho/itens').set(auth(token))
      .send({ nftId, edicaoId, quantidade: 1 }).expect(201);
    return http().post('/api/pedidos').set(auth(token)).set('Idempotency-Key', `rt-${Date.now()}-${++sequencia}`)
      .send({ versaoCotacao: cotacao.versao }).expect(201);
  }

  /** Espera a condição; se ela nunca vale, o teste falha com a mensagem do expect. */
  const ate = (condicao: () => unknown) => vi.waitFor(() => expect(condicao()).toBeTruthy(), { timeout: 3000 });
  /** Para provar que algo NÃO chegou: dá tempo de sobra para um evento indevido aparecer. */
  const respiro = () => new Promise((ok) => setTimeout(ok, 300));

  beforeAll(async () => {
    app = await subirApi();
    await app.listen(0);
    origem = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });

  afterEach(() => {
    for (const s of sockets.splice(0)) s.disconnect();
  });

  afterAll(async () => {
    await app.close();
  });

  it('visitante recebe nft.updated com a versão e o estoque que a API passa a responder', async () => {
    const visitante = await conectar();
    const conta = await contaNova();
    await comprar(conta.token, 'nft-020', '20-padrao');

    await ate(() => visitante.recebidos.nft.find((e) => e.nftId === 'nft-020'));
    const evento = visitante.recebidos.nft.find((e) => e.nftId === 'nft-020')!;
    const { body: nft } = await http().get('/api/nfts/nft-020').expect(200);

    expect(evento).toMatchObject({
      eventoId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      emitidoEm: expect.any(String),
      versao: nft.versao,
      edicoes: nft.edicoes.map((e: { id: string; precoEth: string; disponivel: number }) =>
        ({ id: e.id, precoEth: e.precoEth, disponivel: e.disponivel })),
    });
    // Visitante não recebe nada de pedido.
    expect(visitante.recebidos.pedido).toEqual([]);
  });

  it('order.updated vai só para a conta dona do pedido', async () => {
    const dona = await contaNova();
    const outra = await contaNova();
    const socketDona = await conectar();
    const socketOutra = await conectar();
    expect(await socketDona.identificar(dona.id, dona.token)).toBe(true);
    expect(await socketOutra.identificar(outra.id, outra.token)).toBe(true);

    const { body: pedido } = await comprar(dona.token, 'nft-021', '21-padrao');

    await ate(() => socketDona.recebidos.pedido.length === 1);
    expect(socketDona.recebidos.pedido[0]).toMatchObject({
      pedidoId: pedido.id, status: 'CONFIRMADO', versao: pedido.versao,
      referenciaTransacao: pedido.referenciaTransacao, motivoRecusa: null,
    });
    await respiro();
    expect(socketOutra.recebidos.pedido).toEqual([]);
    // O catálogo é público: as duas veem o estoque mudar.
    expect(socketOutra.recebidos.nft.some((e) => e.nftId === 'nft-021')).toBe(true);
  });

  it('pedir a sala de outra conta não funciona: o token decide, não o id enviado', async () => {
    const vitima = await contaNova();
    const intrusa = await contaNova();
    const espiao = await conectar();
    // Id da vítima com o token da intrusa, e id da vítima sem token nenhum.
    expect(await espiao.identificar(vitima.id, intrusa.token)).toBe(false);
    expect(await espiao.identificar(vitima.id, null)).toBe(false);
    expect(await espiao.identificar(vitima.id, 'nao-e-um-jwt')).toBe(false);

    await comprar(vitima.token, 'nft-022', '22-padrao');
    await ate(() => espiao.recebidos.nft.some((e) => e.nftId === 'nft-022'));
    await respiro();
    expect(espiao.recebidos.pedido).toEqual([]);
  });

  it('depois do logout o socket daquela sessão volta a visitante; outra sessão da conta segue recebendo', async () => {
    const conta = await contaNova();
    const { body: segunda } = await http().post('/api/sessao').send({ email: conta.email, senha: 'senha12345' }).expect(200);
    const saiu = await conectar();
    const ficou = await conectar();
    expect(await saiu.identificar(conta.id, conta.token)).toBe(true);
    expect(await ficou.identificar(conta.id, segunda.token)).toBe(true);

    await http().delete('/api/sessao').set(auth(conta.token)).expect(204);
    await comprar(segunda.token, 'nft-020', '20-padrao');

    await ate(() => ficou.recebidos.pedido.length === 1);
    await respiro();
    expect(saiu.recebidos.pedido).toEqual([]);
  });

  it('pagamento recusado avisa o pedido, mas não anuncia estoque (nada mudou)', async () => {
    const conta = await contaNova();
    const recusa = (await http().post('/api/carteiras').set(auth(conta.token))
      .send({ apelido: 'Sem saldo', endereco: `0x${'4'.repeat(36)}dead`, rede: 'polygon' }).expect(201)).body;
    const socket = await conectar();
    expect(await socket.identificar(conta.id, conta.token)).toBe(true);

    const { body: cotacao } = await http().post('/api/carrinho/itens').set(auth(conta.token))
      .send({ nftId: 'nft-021', edicaoId: '21-rara', quantidade: 1 }).expect(201);
    const { body: pedido } = await http().post('/api/pedidos').set(auth(conta.token)).set('Idempotency-Key', `rt-recusa-${Date.now()}`)
      .send({ versaoCotacao: cotacao.versao, carteiraId: recusa.id }).expect(201);

    await ate(() => socket.recebidos.pedido.length === 1);
    expect(socket.recebidos.pedido[0]).toMatchObject({
      pedidoId: pedido.id, status: 'RECUSADO', motivoRecusa: 'A carteira recusou a transação.',
    });
    await respiro();
    expect(socket.recebidos.nft).toEqual([]);
  });

  it('reenvio idempotente devolve o pedido sem anunciar de novo', async () => {
    const conta = await contaNova();
    const socket = await conectar();
    expect(await socket.identificar(conta.id, conta.token)).toBe(true);
    const idem = `rt-repete-${Date.now()}`;

    const { body: cotacao } = await http().post('/api/carrinho/itens').set(auth(conta.token))
      .send({ nftId: 'nft-022', edicaoId: '22-padrao', quantidade: 1 }).expect(201);
    const enviar = () => http().post('/api/pedidos').set(auth(conta.token)).set('Idempotency-Key', idem)
      .send({ versaoCotacao: cotacao.versao });
    await enviar().expect(201);
    await ate(() => socket.recebidos.pedido.length === 1);
    await enviar().expect(200);

    await respiro();
    expect(socket.recebidos.pedido).toHaveLength(1);
    expect(socket.recebidos.nft.filter((e) => e.nftId === 'nft-022')).toHaveLength(1);
  });

  it('versão do evento só cresce entre compras seguidas da mesma peça', async () => {
    const visitante = await conectar();
    const a = await contaNova();
    const b = await contaNova();
    await comprar(a.token, 'nft-020', '20-padrao');
    await comprar(b.token, 'nft-020', '20-padrao');

    await ate(() => visitante.recebidos.nft.filter((e) => e.nftId === 'nft-020').length === 2);
    const [primeiro, segundo] = visitante.recebidos.nft.filter((e) => e.nftId === 'nft-020');
    expect(segundo!.versao).toBeGreaterThan(primeiro!.versao);
    expect(new Set([primeiro!.eventoId, segundo!.eventoId]).size).toBe(2);
  });

  it('origem fora da lista do CORS não abre o handshake por polling', async () => {
    const res = await request(origem).get('/socket.io/?EIO=4&transport=polling').set('Origin', 'https://intrusa.example');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    const liberada = await request(origem).get('/socket.io/?EIO=4&transport=polling').set('Origin', 'http://localhost:5173');
    expect(liberada.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });
});
