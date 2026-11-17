import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { DataSource, type EntityManager } from 'typeorm';
import {
  calcularTotais, CUPONS, paraTexto, paraUnidades, subtotalDoItem, versaoDaCotacao,
  type Cotacao, type Cupom, type ItemCarrinho,
} from '@calvarenga92/kurio-regras';
import { inteiroDoCorpo, texto } from '../comum/corpo.js';
import { dadosInvalidos, ErroAplicacao, naoEncontrado } from '../comum/erro-aplicacao.js';
import { carrinhoDaConta, novoIdCarrinho } from './mescla.js';

/** Quem está comprando: a conta, ou o visitante identificado pelo id do carrinho dele. */
export interface Comprador {
  contaId: string | null;
  visitanteId: string | null;
}

/** Resposta do carrinho mais o id de visitante a devolver no cabeçalho (null para conta). */
export interface Resultado {
  cotacao: Cotacao;
  visitanteId: string | null;
}

const VALIDADE_COTACAO_MS = 10 * 60 * 1000;
const eth = (v: string) => paraTexto(paraUnidades(v));

function cupomDe(codigo: string | null): Cupom | null {
  const regra = codigo ? CUPONS[codigo] : undefined;
  return codigo && regra ? { codigo, descricaoDesconto: `${regra.percentual}% de desconto` } : null;
}

const disponibilidadeInsuficiente = (disponivel: number) =>
  new ErroAplicacao(
    409, 'DISPONIBILIDADE_INSUFICIENTE',
    disponivel === 0 ? 'Esta edição esgotou.' : `Restam ${disponivel} unidades desta edição.`,
  );

@Injectable()
export class CarrinhoService {
  constructor(private readonly banco: DataSource) {}

  async consultar(quem: Comprador): Promise<Resultado> {
    return this.banco.transaction(async (m) => {
      const id = await this.localizar(m, quem, false);
      return { cotacao: await this.cotacao(m, id), visitanteId: this.idVisitante(quem, id) };
    });
  }

  adicionar(quem: Comprador, corpo: Record<string, unknown>): Promise<Resultado> {
    const nftId = texto(corpo.nftId);
    const edicaoId = texto(corpo.edicaoId);
    const quantidade = inteiroDoCorpo(corpo, 'quantidade', 1, 100, 1);

    return this.alterar(quem, async (m, carrinhoId) => {
      const [edicao] = await m.query<Array<{ disponivel: number; limite_por_pedido: number }>>(
        `SELECT disponivel, limite_por_pedido FROM edicoes WHERE id = $1 AND nft_id = $2`,
        [edicaoId, nftId],
      );
      if (!edicao) throw naoEncontrado('Edição', 'a');

      const [existente] = await m.query<Array<{ quantidade: number }>>(
        `SELECT quantidade FROM itens_carrinho WHERE carrinho_id = $1 AND edicao_id = $2`,
        [carrinhoId, edicaoId],
      );
      const total = (existente?.quantidade ?? 0) + quantidade;
      this.conferirQuantidade(total, edicao);

      await m.query(
        `INSERT INTO itens_carrinho (id, carrinho_id, edicao_id, quantidade) VALUES ($1, $2, $3, $4)
         ON CONFLICT (carrinho_id, edicao_id) DO UPDATE SET quantidade = excluded.quantidade`,
        [`it-${randomBytes(6).toString('hex')}`, carrinhoId, edicaoId, total],
      );
    });
  }

  /** Quantidade 0 remove o item, como no mock. */
  atualizarItem(quem: Comprador, itemId: string, corpo: Record<string, unknown>): Promise<Resultado> {
    const quantidade = inteiroDoCorpo(corpo, 'quantidade', 0, 100);

    return this.alterar(quem, async (m, carrinhoId) => {
      const [item] = await m.query<Array<{ disponivel: number; limite_por_pedido: number }>>(
        `SELECT e.disponivel, e.limite_por_pedido
         FROM itens_carrinho i JOIN edicoes e ON e.id = i.edicao_id
         WHERE i.id = $1 AND i.carrinho_id = $2`,
        [itemId, carrinhoId],
      );
      if (!item) throw naoEncontrado('Item');

      if (quantidade === 0) {
        await m.query(`DELETE FROM itens_carrinho WHERE id = $1`, [itemId]);
        return;
      }
      this.conferirQuantidade(quantidade, item);
      await m.query(`UPDATE itens_carrinho SET quantidade = $2 WHERE id = $1`, [itemId, quantidade]);
    });
  }

  /** Remover é idempotente: item que não existe (ou de outro carrinho) não muda nada. */
  removerItem(quem: Comprador, itemId: string): Promise<Resultado> {
    return this.alterar(quem, async (m, carrinhoId) => {
      await m.query(`DELETE FROM itens_carrinho WHERE id = $1 AND carrinho_id = $2`, [itemId, carrinhoId]);
    });
  }

  aplicarCupom(quem: Comprador, corpo: Record<string, unknown>): Promise<Resultado> {
    const codigo = texto(corpo.codigo).trim().toUpperCase();
    const regra = CUPONS[codigo];
    if (!regra) throw new ErroAplicacao(422, 'CUPOM_INVALIDO', 'Cupom não encontrado.');
    if (regra.expirado) throw new ErroAplicacao(422, 'CUPOM_EXPIRADO', 'Este cupom expirou.');

    return this.alterar(quem, async (m, carrinhoId) => {
      await m.query(`UPDATE carrinhos SET cupom_codigo = $2 WHERE id = $1`, [carrinhoId, codigo]);
    });
  }

  removerCupom(quem: Comprador): Promise<Resultado> {
    return this.alterar(quem, async (m, carrinhoId) => {
      await m.query(`UPDATE carrinhos SET cupom_codigo = NULL WHERE id = $1`, [carrinhoId]);
    });
  }

  /**
   * Toda alteração roda numa transação com o carrinho travado (FOR UPDATE): dois cliques
   * simultâneos em "adicionar" não leem a mesma quantidade antiga e passam do limite.
   */
  private alterar(
    quem: Comprador, mudanca: (m: EntityManager, carrinhoId: string) => Promise<void>,
  ): Promise<Resultado> {
    return this.banco.transaction(async (m) => {
      const id = (await this.localizar(m, quem, true))!;
      await mudanca(m, id);
      await m.query(`UPDATE carrinhos SET atualizado_em = now() WHERE id = $1`, [id]);
      return { cotacao: await this.cotacao(m, id), visitanteId: this.idVisitante(quem, id) };
    });
  }

  /** Id do carrinho (travado). Visitante com id desconhecido ganha carrinho novo, se for para criar. */
  private async localizar(m: EntityManager, quem: Comprador, criar: boolean): Promise<string | null> {
    if (quem.contaId) {
      if (criar) return carrinhoDaConta(m, quem.contaId);
      const [linha] = await m.query(`SELECT id FROM carrinhos WHERE conta_id = $1`, [quem.contaId]);
      return linha?.id ?? null;
    }

    if (quem.visitanteId) {
      const [linha] = await m.query(
        `SELECT id FROM carrinhos WHERE id = $1 AND conta_id IS NULL FOR UPDATE`, [quem.visitanteId],
      );
      if (linha) return linha.id;
    }
    if (!criar) return null;

    const id = novoIdCarrinho(true);
    await m.query(`INSERT INTO carrinhos (id) VALUES ($1)`, [id]);
    return id;
  }

  private idVisitante(quem: Comprador, carrinhoId: string | null): string | null {
    return quem.contaId ? null : carrinhoId;
  }

  private conferirQuantidade(total: number, edicao: { disponivel: number; limite_por_pedido: number }) {
    if (edicao.disponivel < total) throw disponibilidadeInsuficiente(edicao.disponivel);
    if (total > edicao.limite_por_pedido) {
      throw dadosInvalidos({ quantidade: `Limite de ${edicao.limite_por_pedido} unidades por pedido.` });
    }
  }

  /**
   * Cotação recalculada do catálogo a cada leitura: preço e disponibilidade nunca ficam velhos.
   * Item acima do disponível é reduzido (e gravado), como o mock faz ao sincronizar.
   */
  async cotacao(m: EntityManager, carrinhoId: string | null): Promise<Cotacao> {
    let itens: ItemCarrinho[] = [];
    let cupom: Cupom | null = null;

    if (carrinhoId) {
      await m.query(
        `UPDATE itens_carrinho i SET quantidade = e.disponivel
         FROM edicoes e WHERE e.id = i.edicao_id AND i.carrinho_id = $1 AND i.quantidade > e.disponivel`,
        [carrinhoId],
      );
      const linhas = await m.query<Array<{
        id: string; nft_id: string; edicao_id: string; titulo: string; imagem_url: string; rotulo: string;
        quantidade: number; preco_eth: string; disponivel: number; versao: number;
      }>>(
        `SELECT i.id, n.id AS nft_id, e.id AS edicao_id, n.titulo, n.imagem_url, e.rotulo,
                i.quantidade, e.preco_eth, e.disponivel, n.versao
         FROM itens_carrinho i
         JOIN edicoes e ON e.id = i.edicao_id
         JOIN nfts n ON n.id = e.nft_id
         WHERE i.carrinho_id = $1
         ORDER BY i.adicionado_em, i.id`,
        [carrinhoId],
      );
      itens = linhas.map((l) => {
        const preco = eth(l.preco_eth);
        return {
          id: l.id,
          nftId: l.nft_id,
          edicaoId: l.edicao_id,
          titulo: l.titulo,
          imagemUrl: l.imagem_url,
          rotuloEdicao: l.rotulo,
          quantidade: l.quantidade,
          precoUnitarioEth: preco,
          subtotalEth: subtotalDoItem(preco, l.quantidade),
          disponivel: l.disponivel,
          versaoNft: l.versao,
        };
      });
      const [carrinho] = await m.query(`SELECT cupom_codigo FROM carrinhos WHERE id = $1`, [carrinhoId]);
      cupom = cupomDe(carrinho?.cupom_codigo ?? null);
    }

    return {
      itens,
      // Totais em 18 casas pela mesma regra do front e do app mobile.
      ...calcularTotais(itens, cupom),
      cupom,
      // A versão resume preço, quantidade e cupom: o checkout recusa se o que a pessoa viu mudou.
      versao: versaoDaCotacao(itens, cupom, ['-']),
      expiraEm: new Date(Date.now() + VALIDADE_COTACAO_MS).toISOString(),
    };
  }
}
