import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { DataSource, type EntityManager } from 'typeorm';
import type { Carteira, RedeCarteira } from '@calvarenga92/kudo-regras';
import { texto } from '../comum/corpo.js';
import { dadosInvalidos, naoEncontrado } from '../comum/erro-aplicacao.js';

const ENDERECO = /^0x[a-fA-F0-9]{40}$/;
const REDES: readonly RedeCarteira[] = ['ethereum', 'polygon', 'arbitrum'];

interface LinhaCarteira {
  id: string;
  apelido: string;
  endereco: string;
  rede: RedeCarteira;
  principal: boolean;
}

@Injectable()
export class CarteirasService {
  constructor(private readonly banco: DataSource) {}

  listar(contaId: string, m: EntityManager = this.banco.manager): Promise<Carteira[]> {
    return m.query<LinhaCarteira[]>(
      `SELECT id, apelido, endereco, rede, principal FROM carteiras
       WHERE conta_id = $1 ORDER BY criada_em, id`,
      [contaId],
    );
  }

  /** A primeira carteira da conta já nasce principal. */
  adicionar(contaId: string, corpo: Record<string, unknown>): Promise<Carteira> {
    const apelido = texto(corpo.apelido).trim();
    const endereco = texto(corpo.endereco).trim();
    const rede = texto(corpo.rede) as RedeCarteira;

    const campos: Record<string, string> = {};
    if (!apelido) campos.apelido = 'Informe um apelido.';
    else if (apelido.length > 40) campos.apelido = 'Use no máximo 40 caracteres.';
    if (!ENDERECO.test(endereco)) campos.endereco = 'Endereço deve ter 0x e mais 40 caracteres.';
    if (!REDES.includes(rede)) campos.rede = 'Selecione uma rede.';
    if (Object.keys(campos).length > 0) throw dadosInvalidos(campos);

    return this.banco.transaction(async (m) => {
      // Trava as carteiras da conta: duas inclusões simultâneas não viram duas principais.
      const existentes = await m.query<Array<{ endereco: string }>>(
        `SELECT endereco FROM carteiras WHERE conta_id = $1 FOR UPDATE`, [contaId],
      );
      if (existentes.some((c) => c.endereco.toLowerCase() === endereco.toLowerCase())) {
        throw dadosInvalidos({ endereco: 'Esta carteira já está cadastrada.' });
      }

      const [carteira] = await m.query<LinhaCarteira[]>(
        `INSERT INTO carteiras (id, conta_id, apelido, endereco, rede, principal)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, apelido, endereco, rede, principal`,
        [`w-${randomBytes(4).toString('hex')}`, contaId, apelido, endereco, rede, existentes.length === 0],
      );
      return carteira;
    });
  }

  tornarPrincipal(contaId: string, carteiraId: string): Promise<Carteira[]> {
    return this.banco.transaction(async (m) => {
      await this.exigir(m, contaId, carteiraId);
      // Desmarca antes de marcar: o índice único admite uma principal por conta a cada instante.
      await m.query(`UPDATE carteiras SET principal = false WHERE conta_id = $1 AND principal`, [contaId]);
      await m.query(`UPDATE carteiras SET principal = true WHERE id = $1`, [carteiraId]);
      return this.listar(contaId, m);
    });
  }

  /** Removida a principal, a mais antiga que sobrou assume. */
  remover(contaId: string, carteiraId: string): Promise<Carteira[]> {
    return this.banco.transaction(async (m) => {
      const removida = await this.exigir(m, contaId, carteiraId);
      await m.query(`DELETE FROM carteiras WHERE id = $1`, [carteiraId]);
      if (removida.principal) {
        await m.query(
          `UPDATE carteiras SET principal = true
           WHERE id = (SELECT id FROM carteiras WHERE conta_id = $1 ORDER BY criada_em, id LIMIT 1)`,
          [contaId],
        );
      }
      return this.listar(contaId, m);
    });
  }

  /** Carteira de outra conta responde igual a inexistente: não confirma que o id existe. */
  private async exigir(m: EntityManager, contaId: string, carteiraId: string): Promise<LinhaCarteira> {
    const [carteira] = await m.query<LinhaCarteira[]>(
      `SELECT id, apelido, endereco, rede, principal FROM carteiras
       WHERE id = $1 AND conta_id = $2 FOR UPDATE`,
      [carteiraId, contaId],
    );
    if (!carteira) throw naoEncontrado('Carteira', 'a');
    return carteira;
  }
}
