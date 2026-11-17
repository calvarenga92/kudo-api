import type { MigrationInterface, QueryRunner } from 'typeorm';
import { COLECOES, NFTS_INICIAIS } from '../../catalogo/dados-iniciais.js';

/** Conteúdo do catálogo (dado de referência, não de teste): entra em todo ambiente. */
export class CatalogoInicial1763380000001 implements MigrationInterface {
  name = 'CatalogoInicial1763380000001';

  async up(q: QueryRunner): Promise<void> {
    for (const [ordem, c] of COLECOES.entries()) {
      await q.query(`INSERT INTO colecoes (id, nome, ordem) VALUES ($1, $2, $3)`, [c.id, c.nome, ordem + 1]);
    }

    for (const n of NFTS_INICIAIS) {
      await q.query(
        `INSERT INTO nfts (id, slug, titulo, imagem_url, autor, colecao_id, descricao, galeria, atributos, listado_em)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          n.id, n.slug, n.titulo, n.imagemUrl, n.autor, n.colecaoId, n.descricao,
          JSON.stringify(n.galeria), JSON.stringify(n.atributos), n.listadoEm,
        ],
      );
      for (const e of n.edicoes) {
        await q.query(
          `INSERT INTO edicoes (id, nft_id, rotulo, preco_eth, disponivel, limite_por_pedido, ordem)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [e.id, n.id, e.rotulo, e.precoEth, e.disponivel, e.limitePorPedido, e.ordem],
        );
      }
    }
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DELETE FROM edicoes`);
    await q.query(`DELETE FROM nfts`);
    await q.query(`DELETE FROM colecoes`);
  }
}
