import { Controller, Get } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ErroAplicacao } from '../comum/erro-aplicacao.js';

/**
 * Usado pelo balanceador/orquestrador no deploy: 200 só se o banco responde.
 * Banco fora devolve 503 no formato de erro do contrato.
 */
@Controller('saude')
export class SaudeController {
  constructor(private readonly banco: DataSource) {}

  @Get()
  async verificar() {
    try {
      await this.banco.query('select 1');
    } catch {
      throw new ErroAplicacao(503, 'FALHA_TRANSITORIA', 'Banco de dados indisponível.');
    }
    return { status: 'ok', banco: 'ok' };
  }
}
