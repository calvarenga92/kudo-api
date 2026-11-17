import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Sessão é JWT, mas registrada: o token carrega o id da sessão (jti) e o logout
 * marca a sessão como revogada. Um JWT puro seguiria válido até expirar.
 */
export class ContasESessoes1763390000000 implements MigrationInterface {
  name = 'ContasESessoes1763390000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE contas (
        id          text PRIMARY KEY,
        nome        text NOT NULL,
        email       text NOT NULL,
        senha_hash  text NOT NULL,
        avatar_url  text,
        criada_em   timestamptz NOT NULL DEFAULT now()
      )`);
    // Um e-mail, uma conta, sem diferenciar maiúsculas.
    await q.query(`CREATE UNIQUE INDEX contas_email_unico ON contas (lower(email))`);

    await q.query(`
      CREATE TABLE sessoes (
        id           uuid PRIMARY KEY,
        conta_id     text NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
        expira_em    timestamptz NOT NULL,
        revogada_em  timestamptz,
        criada_em    timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX sessoes_conta_idx ON sessoes (conta_id)`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE sessoes`);
    await q.query(`DROP TABLE contas`);
  }
}
