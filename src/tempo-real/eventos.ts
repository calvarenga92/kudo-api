import type { StatusPedido } from '@calvarenga92/kurio-regras';

/**
 * Mesmo contrato do front (jungle-nft/src/api/eventos.ts). Todo evento carrega identidade
 * e versão: o cliente descarta a entrega repetida pelo id e a atrasada pela versão.
 *
 * Ainda não está no @calvarenga92/kurio-regras; quando sair uma versão com os eventos,
 * estes tipos passam a vir de lá.
 */
export interface EventoBase {
  eventoId: string;
  versao: number;
  emitidoEm: string;
}

export interface NftAtualizado extends EventoBase {
  nftId: string;
  edicoes: Array<{ id: string; precoEth: string; disponivel: number }>;
}

export interface PedidoAtualizado extends EventoBase {
  pedidoId: string;
  status: StatusPedido;
  referenciaTransacao: string | null;
  motivoRecusa: string | null;
}

export interface EventosServidor {
  'nft.updated': (evento: NftAtualizado) => void;
  'order.updated': (evento: PedidoAtualizado) => void;
}

/**
 * O front manda o id que acha que é o dele; quem decide é o token. Sem token válido
 * o socket fica como visitante e só recebe eventos públicos do catálogo.
 */
export interface Identificacao {
  usuarioId?: string | null;
  token?: string | null;
}

export const salaDoUsuario = (id: string) => `usuario:${id}`;
export const salaDaSessao = (jti: string) => `sessao:${jti}`;
