import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';

export type ResultadoPagamento =
  | { aprovado: true; referenciaTransacao: string }
  | { aprovado: false; motivo: string };

/**
 * Ponto de troca para um gateway de verdade. O Kudo é uma vitrine: não há cobrança real.
 * O simulador aprova tudo, exceto carteiras cujo endereço termina em "dead" — assim o
 * caminho de recusa pode ser exercitado de ponta a ponta, sem flag escondida.
 */
export abstract class GatewayPagamento {
  abstract cobrar(entrada: { pedidoId: string; totalEth: string; endereco: string; rede: string }):
    Promise<ResultadoPagamento>;
}

@Injectable()
export class GatewaySimulado extends GatewayPagamento {
  async cobrar({ endereco }: { endereco: string }): Promise<ResultadoPagamento> {
    if (endereco.toLowerCase().endsWith('dead')) {
      return { aprovado: false, motivo: 'A carteira recusou a transação.' };
    }
    return { aprovado: true, referenciaTransacao: `0x${randomBytes(16).toString('hex')}` };
  }
}
