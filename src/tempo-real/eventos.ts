/**
 * O contrato dos eventos (o que cada lado emite e o formato) vem do
 * @calvarenga92/kudo-regras, o mesmo pacote do front e do app mobile.
 * Aqui ficam só as salas, que são detalhe do servidor.
 */
export type {
  EventoBase, EventosCliente, EventosServidor, Identificacao, NftAtualizado, PedidoAtualizado,
} from '@calvarenga92/kudo-regras';

export const salaDoUsuario = (id: string) => `usuario:${id}`;
export const salaDaSessao = (jti: string) => `sessao:${jti}`;
