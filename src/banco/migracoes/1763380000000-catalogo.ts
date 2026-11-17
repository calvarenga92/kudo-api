import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Preço em numeric(38,18): decimal exato no Postgres, 18 casas como o ETH.
 * Comparar, somar e ordenar acontece no banco sem passar por float.
 */
export class Catalogo1763380000000 implements MigrationInterface {
  name = 'Catalogo1763380000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE colecoes (
        id    text PRIMARY KEY,
        nome  text NOT NULL,
        ordem integer NOT NULL
      )`);

    await q.query(`
      CREATE TABLE nfts (
        id          text PRIMARY KEY,
        slug        text NOT NULL UNIQUE,
        titulo      text NOT NULL,
        imagem_url  text NOT NULL,
        autor       text NOT NULL,
        colecao_id  text NOT NULL REFERENCES colecoes(id),
        descricao   text NOT NULL,
        galeria     jsonb NOT NULL DEFAULT '[]',
        atributos   jsonb NOT NULL DEFAULT '[]',
        versao      integer NOT NULL DEFAULT 1,
        listado_em  timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX nfts_colecao_idx ON nfts (colecao_id)`);
    await q.query(`CREATE INDEX nfts_listado_em_idx ON nfts (listado_em DESC)`);

    await q.query(`
      CREATE TABLE edicoes (
        id                 text PRIMARY KEY,
        nft_id             text NOT NULL REFERENCES nfts(id) ON DELETE CASCADE,
        rotulo             text NOT NULL,
        preco_eth          numeric(38,18) NOT NULL CHECK (preco_eth > 0),
        disponivel         integer NOT NULL CHECK (disponivel >= 0),
        limite_por_pedido  integer NOT NULL CHECK (limite_por_pedido > 0),
        ordem              integer NOT NULL
      )`);
    await q.query(`CREATE INDEX edicoes_nft_idx ON edicoes (nft_id)`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE edicoes`);
    await q.query(`DROP TABLE nfts`);
    await q.query(`DROP TABLE colecoes`);
  }
}
