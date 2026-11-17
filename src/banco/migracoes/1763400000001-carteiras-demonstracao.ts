import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Carteira de demonstração das contas do mock, para o checkout funcionar logo após entrar. */
const ENDERECO = '0x7A3f9C21d4B8e5F06aC1b2E93D847fA50cB61d29';

export class CarteirasDemonstracao1763400000001 implements MigrationInterface {
  name = 'CarteirasDemonstracao1763400000001';

  async up(q: QueryRunner): Promise<void> {
    for (const conta of ['usr-1', 'usr-2']) {
      await q.query(
        `INSERT INTO carteiras (id, conta_id, apelido, endereco, rede, principal)
         VALUES ($1, $2, 'Principal', $3, 'ethereum', true)`,
        [`${conta}-w1`, conta, ENDERECO],
      );
    }
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DELETE FROM carteiras WHERE id IN ('usr-1-w1', 'usr-2-w1')`);
  }
}
