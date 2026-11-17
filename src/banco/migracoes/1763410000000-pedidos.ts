import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Pedido é um retrato imutável: título, preço, cupom e carteira são copiados na hora da
 * compra, e mudanças posteriores no catálogo não alteram o recibo.
 */
export class Pedidos1763410000000 implements MigrationInterface {
  name = 'Pedidos1763410000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE pedidos (
        id                    text PRIMARY KEY,
        conta_id              text NOT NULL REFERENCES contas(id),
        status                text NOT NULL CHECK (status IN ('PENDENTE', 'CONFIRMADO', 'RECUSADO')),
        subtotal_eth          numeric(38,18) NOT NULL,
        desconto_eth          numeric(38,18) NOT NULL,
        taxa_rede_eth         numeric(38,18) NOT NULL,
        total_eth             numeric(38,18) NOT NULL,
        cupom_codigo          text,
        cupom_descricao       text,
        carteira_apelido      text NOT NULL,
        carteira_endereco     text NOT NULL,
        carteira_rede         text NOT NULL,
        referencia_transacao  text,
        motivo_recusa         text,
        versao                integer NOT NULL DEFAULT 1,
        criado_em             timestamptz NOT NULL DEFAULT now(),
        atualizado_em         timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX pedidos_conta_idx ON pedidos (conta_id, criado_em DESC)`);

    await q.query(`
      CREATE TABLE itens_pedido (
        pedido_id           text NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
        ordem               integer NOT NULL,
        nft_id              text NOT NULL,
        edicao_id           text NOT NULL,
        titulo              text NOT NULL,
        imagem_url          text NOT NULL,
        rotulo_edicao       text NOT NULL,
        quantidade          integer NOT NULL CHECK (quantidade > 0),
        preco_unitario_eth  numeric(38,18) NOT NULL,
        subtotal_eth        numeric(38,18) NOT NULL,
        PRIMARY KEY (pedido_id, ordem)
      )`);

    /**
     * Chave de idempotência por conta. A impressão (hash do corpo) separa o reenvio legítimo
     * (mesmo corpo: devolve o pedido original) de uma chave reaproveitada com outro conteúdo.
     */
    await q.query(`
      CREATE TABLE idempotencia_pedidos (
        conta_id   text NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
        chave      text NOT NULL,
        impressao  text NOT NULL,
        pedido_id  text NOT NULL REFERENCES pedidos(id),
        criada_em  timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (conta_id, chave)
      )`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE idempotencia_pedidos`);
    await q.query(`DROP TABLE itens_pedido`);
    await q.query(`DROP TABLE pedidos`);
  }
}
