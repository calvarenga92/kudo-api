import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  paraTexto, paraUnidades,
  type Colecao, type ConsultaNfts, type Eth, type FaixaPreco, type Nft, type NftResumo, type Pagina,
} from '@calvarenga92/kurio-regras';
import { naoAutenticado, naoEncontrado } from '../comum/erro-aplicacao.js';

/** numeric chega do driver como string ("1.990000000000000000"); sai no formato do contrato ("1.99"). */
const eth = (valor: string): Eth => paraTexto(paraUnidades(valor));

/** Preço mínimo da peça = menor preço entre as edições. */
const PRECO_MINIMO = `(SELECT min(e.preco_eth) FROM edicoes e WHERE e.nft_id = n.id)`;

/** Marca de favorito da conta (null = visitante, nada é favorito). */
const FAVORITO = (param: string) =>
  `EXISTS (SELECT 1 FROM favoritos f WHERE f.conta_id = ${param}::text AND f.nft_id = n.id)`;

const ORDEM_SQL: Record<NonNullable<ConsultaNfts['ordenacao']>, string> = {
  recentes: 'n.listado_em DESC, n.id',
  'preco-asc': 'preco_minimo ASC, n.id',
  'preco-desc': 'preco_minimo DESC, n.id',
  populares: 'n.titulo ASC, n.id',
};

interface LinhaResumo {
  id: string;
  slug: string;
  titulo: string;
  imagem_url: string;
  autor: string;
  versao: number;
  colecao_id: string;
  colecao_nome: string;
  preco_minimo: string;
  favorito: boolean;
}

@Injectable()
export class CatalogoService {
  constructor(private readonly banco: DataSource) {}

  async listar(consulta: ConsultaNfts, contaId: string | null): Promise<Pagina<NftResumo>> {
    const params: unknown[] = [];
    const p = (valor: unknown) => {
      params.push(valor);
      return `$${params.length}`;
    };

    const filtros: string[] = [];
    if (consulta.busca) {
      const termo = p(`%${consulta.busca.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
      filtros.push(`(n.titulo ILIKE ${termo} OR n.autor ILIKE ${termo} OR c.nome ILIKE ${termo})`);
    }
    if (consulta.colecoes?.length) filtros.push(`n.colecao_id = ANY(${p(consulta.colecoes)}::text[])`);
    if (consulta.somenteDisponiveis) {
      filtros.push(`EXISTS (SELECT 1 FROM edicoes e WHERE e.nft_id = n.id AND e.disponivel > 0)`);
    }
    if (consulta.precoMin) filtros.push(`${PRECO_MINIMO} >= ${p(consulta.precoMin)}::numeric`);
    if (consulta.precoMax) filtros.push(`${PRECO_MINIMO} <= ${p(consulta.precoMax)}::numeric`);

    const de = `FROM nfts n JOIN colecoes c ON c.id = n.colecao_id
      ${filtros.length ? `WHERE ${filtros.join(' AND ')}` : ''}`;

    const [{ total }] = await this.banco.query<Array<{ total: number }>>(
      `SELECT count(*)::int AS total ${de}`, params,
    );

    const { pagina, porPagina } = consulta;
    const linhas = await this.banco.query<LinhaResumo[]>(
      `SELECT n.id, n.slug, n.titulo, n.imagem_url, n.autor, n.versao,
              c.id AS colecao_id, c.nome AS colecao_nome, ${PRECO_MINIMO} AS preco_minimo,
              ${FAVORITO(p(contaId))} AS favorito
       ${de}
       ORDER BY ${ORDEM_SQL[consulta.ordenacao ?? 'recentes']}
       LIMIT ${p(porPagina)} OFFSET ${p((pagina - 1) * porPagina)}`,
      params,
    );

    return {
      itens: linhas.map(paraResumo),
      pagina,
      porPagina,
      total,
      totalPaginas: Math.max(1, Math.ceil(total / porPagina)),
    };
  }

  /** Aceita id ("nft-001") ou slug ("emerald-ape-042"), como o mock. */
  async detalhar(idOuSlug: string, contaId: string | null): Promise<Nft> {
    const [linha] = await this.banco.query<Array<LinhaResumo & {
      descricao: string;
      galeria: string[];
      atributos: Nft['atributos'];
    }>>(
      `SELECT n.id, n.slug, n.titulo, n.imagem_url, n.autor, n.versao, n.descricao, n.galeria, n.atributos,
              c.id AS colecao_id, c.nome AS colecao_nome, ${PRECO_MINIMO} AS preco_minimo,
              ${FAVORITO('$2')} AS favorito
       FROM nfts n JOIN colecoes c ON c.id = n.colecao_id
       WHERE n.id = $1 OR n.slug = $1`,
      [idOuSlug, contaId],
    );
    if (!linha) throw naoEncontrado('NFT');

    const edicoes = await this.banco.query<Array<{
      id: string; rotulo: string; preco_eth: string; disponivel: number; limite_por_pedido: number;
    }>>(
      `SELECT id, rotulo, preco_eth, disponivel, limite_por_pedido
       FROM edicoes WHERE nft_id = $1 ORDER BY ordem`,
      [linha.id],
    );

    return {
      ...paraResumo(linha),
      descricao: linha.descricao,
      galeria: linha.galeria,
      atributos: linha.atributos,
      edicoes: edicoes.map((e) => ({
        id: e.id,
        rotulo: e.rotulo,
        precoEth: eth(e.preco_eth),
        disponivel: e.disponivel,
        limitePorPedido: e.limite_por_pedido,
      })),
    };
  }

  /** Faixa dos preços mínimos por peça: é o que o filtro de preço compara. */
  async faixaDePreco(): Promise<FaixaPreco> {
    const [linha] = await this.banco.query<Array<{ minimo: string | null; maximo: string | null }>>(
      `SELECT min(pm) AS minimo, max(pm) AS maximo
       FROM (SELECT min(preco_eth) AS pm FROM edicoes GROUP BY nft_id) precos`,
    );
    return { minimo: eth(linha?.minimo ?? '0'), maximo: eth(linha?.maximo ?? '0') };
  }

  /** Favoritos da conta, mais recente primeiro. Visitante não tem favoritos. */
  async favoritos(contaId: string | null): Promise<NftResumo[]> {
    if (!contaId) return [];
    const linhas = await this.banco.query<LinhaResumo[]>(
      `SELECT n.id, n.slug, n.titulo, n.imagem_url, n.autor, n.versao,
              c.id AS colecao_id, c.nome AS colecao_nome, ${PRECO_MINIMO} AS preco_minimo, true AS favorito
       FROM favoritos f
       JOIN nfts n ON n.id = f.nft_id
       JOIN colecoes c ON c.id = n.colecao_id
       WHERE f.conta_id = $1
       ORDER BY f.criado_em DESC, n.id`,
      [contaId],
    );
    return linhas.map(paraResumo);
  }

  /** Idempotente: favoritar de novo não duplica nem falha. */
  async marcarFavorito(contaId: string | null, nftId: string, favorito: boolean): Promise<{ favorito: boolean }> {
    if (!contaId) throw naoAutenticado();
    if (favorito) {
      const [existe] = await this.banco.query(`SELECT 1 FROM nfts WHERE id = $1`, [nftId]);
      if (!existe) throw naoEncontrado('NFT');
      await this.banco.query(
        `INSERT INTO favoritos (conta_id, nft_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [contaId, nftId],
      );
    } else {
      await this.banco.query(`DELETE FROM favoritos WHERE conta_id = $1 AND nft_id = $2`, [contaId, nftId]);
    }
    return { favorito };
  }

  colecoes(): Promise<Colecao[]> {
    return this.banco.query<Colecao[]>(`SELECT id, nome FROM colecoes ORDER BY ordem`);
  }
}

function paraResumo(l: LinhaResumo): NftResumo {
  return {
    id: l.id,
    slug: l.slug,
    titulo: l.titulo,
    imagemUrl: l.imagem_url,
    autor: l.autor,
    colecao: { id: l.colecao_id, nome: l.colecao_nome },
    precoMinimoEth: eth(l.preco_minimo),
    favorito: l.favorito,
    versao: l.versao,
  };
}
