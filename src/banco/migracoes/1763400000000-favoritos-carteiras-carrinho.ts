import type { MigrationInterface, QueryRunner } from 'typeorm';

export class FavoritosCarteirasCarrinho1763400000000 implements MigrationInterface {
  name = 'FavoritosCarteirasCarrinho1763400000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE favoritos (
        conta_id   text NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
        nft_id     text NOT NULL REFERENCES nfts(id) ON DELETE CASCADE,
        criado_em  timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (conta_id, nft_id)
      )`);

    await q.query(`
      CREATE TABLE carteiras (
        id         text PRIMARY KEY,
        conta_id   text NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
        apelido    text NOT NULL,
        endereco   text NOT NULL CHECK (endereco ~ '^0x[a-fA-F0-9]{40}$'),
        rede       text NOT NULL CHECK (rede IN ('ethereum', 'polygon', 'arbitrum')),
        principal  boolean NOT NULL DEFAULT false,
        criada_em  timestamptz NOT NULL DEFAULT now()
      )`);
    // Endereço não se repete na mesma conta; e no máximo uma principal por conta.
    await q.query(`CREATE UNIQUE INDEX carteiras_endereco_unico ON carteiras (conta_id, lower(endereco))`);
    await q.query(`CREATE UNIQUE INDEX carteiras_uma_principal ON carteiras (conta_id) WHERE principal`);

    /**
     * Carrinho de visitante: conta_id nulo; o id (aleatório, longo) é o que o front
     * guarda e devolve no cabeçalho X-Carrinho-Visitante. Carrinho de conta: um por conta.
     */
    await q.query(`
      CREATE TABLE carrinhos (
        id             text PRIMARY KEY,
        conta_id       text UNIQUE REFERENCES contas(id) ON DELETE CASCADE,
        cupom_codigo   text,
        atualizado_em  timestamptz NOT NULL DEFAULT now()
      )`);

    await q.query(`
      CREATE TABLE itens_carrinho (
        id            text PRIMARY KEY,
        carrinho_id   text NOT NULL REFERENCES carrinhos(id) ON DELETE CASCADE,
        edicao_id     text NOT NULL REFERENCES edicoes(id),
        quantidade    integer NOT NULL CHECK (quantidade >= 0),
        adicionado_em timestamptz NOT NULL DEFAULT now(),
        UNIQUE (carrinho_id, edicao_id)
      )`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE itens_carrinho`);
    await q.query(`DROP TABLE carrinhos`);
    await q.query(`DROP TABLE carteiras`);
    await q.query(`DROP TABLE favoritos`);
  }
}
