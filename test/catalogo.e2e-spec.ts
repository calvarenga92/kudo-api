import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import request from 'supertest';
import { comparar, type NftResumo, type Pagina } from '@calvarenga92/kurio-regras';
import { subirApi } from './apoio/subir-api.js';

describe('Catálogo (e2e)', () => {
  let app: INestApplication<App>;
  const get = (url: string) => request(app.getHttpServer()).get(url);
  const listar = async (qs = '') => (await get(`/api/nfts${qs}`).expect(200)).body as Pagina<NftResumo>;

  beforeAll(async () => {
    app = await subirApi();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /api/nfts', () => {
    it('primeira página com os padrões do mock: 8 itens de 24, mais recente primeiro', async () => {
      const pagina = await listar();
      expect(pagina).toMatchObject({ pagina: 1, porPagina: 8, total: 24, totalPaginas: 3 });
      expect(pagina.itens).toHaveLength(8);
      expect(pagina.itens[0]).toEqual({
        id: 'nft-001',
        slug: 'emerald-ape-042',
        titulo: 'Emerald Ape #042',
        imagemUrl: '/nfts/nft-01.png',
        autor: '0xLumen',
        colecao: { id: 'arte-digital', nome: 'Arte digital' },
        precoMinimoEth: '1.99',
        favorito: false,
        versao: 1,
      });
    });

    it('paginação: a última página traz o resto e as páginas não se repetem', async () => {
      const p3 = await listar('?pagina=3&porPagina=9');
      expect(p3.itens).toHaveLength(6);
      expect(p3.totalPaginas).toBe(3);
      const p1 = await listar('?pagina=1&porPagina=9');
      const ids = new Set([...p1.itens, ...p3.itens].map((n) => n.id));
      expect(ids.size).toBe(15);
    });

    it('página além do fim devolve lista vazia, sem erro', async () => {
      const pagina = await listar('?pagina=99');
      expect(pagina.itens).toEqual([]);
      expect(pagina.total).toBe(24);
    });

    it('filtra por uma ou mais coleções', async () => {
      const musica = await listar('?colecao=musica&porPagina=60');
      expect(musica.total).toBe(4);
      expect(musica.itens.every((n) => n.colecao.id === 'musica')).toBe(true);

      const duas = await listar('?colecao=musica&colecao=jogos&porPagina=60');
      expect(duas.total).toBe(6);
    });

    it('busca em título, autor e coleção, sem diferenciar maiúsculas', async () => {
      expect((await listar('?busca=GOLDEN')).total).toBe(3);
      expect((await listar('?busca=kael&porPagina=60')).itens.every((n) => n.autor === 'Kael')).toBe(true);
      expect((await listar('?busca=fotografia')).total).toBe(3);
    });

    it('busca trata % e _ como texto, não como curinga do SQL', async () => {
      expect((await listar('?busca=%25')).total).toBe(0);
      expect((await listar('?busca=_')).total).toBe(0);
    });

    it('ordena por menor e maior preço comparando decimal exato', async () => {
      const asc = (await listar('?ordenacao=preco-asc&porPagina=60')).itens;
      expect(asc[0].titulo).toBe('Lunar Cipher #671');
      for (let i = 1; i < asc.length; i++) {
        expect(comparar(asc[i - 1].precoMinimoEth, asc[i].precoMinimoEth)).toBeLessThanOrEqual(0);
      }
      const desc = (await listar('?ordenacao=preco-desc')).itens;
      expect(desc[0]).toMatchObject({ titulo: 'Pale Oracle #058', precoMinimoEth: '5.1' });
    });

    it('populares ordena por título, como o mock', async () => {
      const itens = (await listar('?ordenacao=populares')).itens;
      expect(itens[0].titulo).toBe('Amber Relic #233');
    });

    it('filtra pela faixa de preço mínimo, com limites inclusivos', async () => {
      const faixa = await listar('?precoMin=1.99&precoMax=2.29&porPagina=60');
      expect(faixa.itens.map((n) => n.precoMinimoEth).sort()).toEqual(['1.99', '2.14', '2.29']);
    });

    it('somente disponíveis exclui as peças esgotadas', async () => {
      const disponiveis = await listar('?somenteDisponiveis=true&porPagina=60');
      expect(disponiveis.total).toBe(22);
      const ids = disponiveis.itens.map((n) => n.id);
      expect(ids).not.toContain('nft-008');
      expect(ids).not.toContain('nft-019');
    });

    it('parâmetro inválido devolve 422 com o campo, no formato do contrato', async () => {
      const resposta = await get('/api/nfts?precoMin=barato&ordenacao=x').expect(422);
      expect(resposta.body.codigo).toBe('DADOS_INVALIDOS');
      expect(Object.keys(resposta.body.campos).sort()).toEqual(['ordenacao', 'precoMin']);
    });
  });

  describe('GET /api/nfts/:id', () => {
    it('detalha por id, com edições em ordem e preço da rara a 2,5x sem erro de float', async () => {
      const nft = (await get('/api/nfts/nft-001').expect(200)).body;
      expect(nft).toMatchObject({
        id: 'nft-001',
        descricao: expect.any(String),
        galeria: ['/nfts/nft-01.png', '/nfts/nft-02.png', '/nfts/nft-03.png'],
        atributos: [
          { nome: 'Raridade', valor: 'Lendária' },
          { nome: 'Fundo', valor: 'Âmbar' },
          { nome: 'Token', valor: '#042' },
        ],
      });
      expect(nft.edicoes).toEqual([
        { id: '1-padrao', rotulo: 'Padrão', precoEth: '1.99', disponivel: 3, limitePorPedido: 3 },
        { id: '1-rara', rotulo: 'Rara', precoEth: '4.975', disponivel: 1, limitePorPedido: 1 },
      ]);
    });

    it('também encontra pelo slug', async () => {
      const nft = (await get('/api/nfts/emerald-ape-042').expect(200)).body;
      expect(nft.id).toBe('nft-001');
    });

    it('peça inexistente devolve 404 NAO_ENCONTRADO', async () => {
      const resposta = await get('/api/nfts/nao-existe').expect(404);
      expect(resposta.body).toEqual({ codigo: 'NAO_ENCONTRADO', mensagem: 'NFT não encontrado.' });
    });
  });

  it('GET /api/nfts/faixa traz o menor e o maior preço mínimo do catálogo', async () => {
    const faixa = (await get('/api/nfts/faixa').expect(200)).body;
    expect(faixa).toEqual({ minimo: '0.18', maximo: '5.1' });
  });

  it('aguenta as consultas em paralelo que a tela inicial dispara', async () => {
    const rotas = ['/api/colecoes', '/api/nfts/faixa', '/api/nfts?porPagina=9', '/api/nfts/nft-002'];
    const respostas = await Promise.all(Array.from({ length: 16 }, (_, i) => get(rotas[i % rotas.length])));
    expect(respostas.map((r) => r.status)).toEqual(Array(16).fill(200));
  });

  it('GET /api/colecoes traz as 9 coleções na ordem da barra de filtros', async () => {
    const colecoes = (await get('/api/colecoes').expect(200)).body;
    expect(colecoes).toHaveLength(9);
    expect(colecoes[0]).toEqual({ id: 'arte-digital', nome: 'Arte digital' });
    expect(colecoes.at(-1)).toEqual({ id: 'utilidade', nome: 'Utilidade' });
  });
});
