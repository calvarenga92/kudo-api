import type { MigrationInterface, QueryRunner } from 'typeorm';
import { gerarHash } from '../../contas/senha.js';

/**
 * Contas de demonstração do Kudo, as mesmas do mock do front: o projeto é uma
 * vitrine pública e quem visita precisa conseguir entrar. Não há dado real aqui.
 */
const CONTAS = [
  { id: 'usr-1', nome: 'Claudio Alvarenga', email: 'claudio@kudo.test' },
  { id: 'usr-2', nome: 'Marina Rocha', email: 'marina@kudo.test' },
];
const SENHA_DEMONSTRACAO = 'senha12345';

export class ContasDemonstracao1763390000001 implements MigrationInterface {
  name = 'ContasDemonstracao1763390000001';

  async up(q: QueryRunner): Promise<void> {
    for (const c of CONTAS) {
      await q.query(
        `INSERT INTO contas (id, nome, email, senha_hash) VALUES ($1, $2, $3, $4)`,
        [c.id, c.nome, c.email, await gerarHash(SENHA_DEMONSTRACAO)],
      );
    }
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DELETE FROM contas WHERE id = ANY($1::text[])`, [CONTAS.map((c) => c.id)]);
  }
}
