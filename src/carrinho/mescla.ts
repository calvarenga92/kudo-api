import type { EntityManager } from 'typeorm';
import { randomBytes } from 'node:crypto';

export const CABECALHO_CARRINHO = 'X-Carrinho-Visitante';

export const novoIdCarrinho = (visitante: boolean) =>
  // O id do carrinho de visitante é a única credencial dele: 24 bytes aleatórios, não adivinhável.
  visitante ? `vis-${randomBytes(24).toString('base64url')}` : `car-${randomBytes(8).toString('hex')}`;

/** Carrinho da conta, criado na primeira vez. Seguro contra duas criações simultâneas. */
export async function carrinhoDaConta(m: EntityManager, contaId: string): Promise<string> {
  await m.query(
    `INSERT INTO carrinhos (id, conta_id) VALUES ($1, $2) ON CONFLICT (conta_id) DO NOTHING`,
    [novoIdCarrinho(false), contaId],
  );
  const [{ id }] = await m.query(`SELECT id FROM carrinhos WHERE conta_id = $1 FOR UPDATE`, [contaId]);
  return id;
}

/**
 * Ao entrar ou se cadastrar, o que o visitante pôs no carrinho passa para a conta:
 * mesma edição soma quantidade, cupom da conta prevalece. O carrinho de visitante some.
 * Disponibilidade e limite por pedido são conferidos de novo na leitura e no checkout.
 */
export async function mesclarCarrinhoVisitante(
  m: EntityManager, visitanteId: string | null, contaId: string,
): Promise<void> {
  if (!visitanteId) return;
  const [visitante] = await m.query(
    `SELECT id, cupom_codigo FROM carrinhos WHERE id = $1 AND conta_id IS NULL FOR UPDATE`,
    [visitanteId],
  );
  if (!visitante) return;

  const destino = await carrinhoDaConta(m, contaId);
  await m.query(
    `INSERT INTO itens_carrinho (id, carrinho_id, edicao_id, quantidade, adicionado_em)
     SELECT 'it-' || substr(md5(random()::text || i.id), 1, 12), $2, i.edicao_id, i.quantidade, i.adicionado_em
     FROM itens_carrinho i WHERE i.carrinho_id = $1
     ON CONFLICT (carrinho_id, edicao_id)
       DO UPDATE SET quantidade = itens_carrinho.quantidade + excluded.quantidade`,
    [visitante.id, destino],
  );
  await m.query(
    `UPDATE carrinhos SET cupom_codigo = coalesce(cupom_codigo, $2), atualizado_em = now() WHERE id = $1`,
    [destino, visitante.cupom_codigo],
  );
  await m.query(`DELETE FROM carrinhos WHERE id = $1`, [visitante.id]);
}
