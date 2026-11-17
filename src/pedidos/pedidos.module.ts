import { Body, Controller, Get, Headers, Module, Param, Post, Res, UseGuards } from '@nestjs/common';
import { CABECALHO_IDEMPOTENCIA, type Usuario } from '@calvarenga92/kurio-regras';
import type { Response } from 'express';
import { CarrinhoModule } from '../carrinho/carrinho.module.js';
import { corpoObjeto } from '../comum/corpo.js';
import { ExigeSessao, UsuarioAtual } from '../sessao/autenticacao.js';
import { SessaoModule } from '../sessao/sessao.module.js';
import { TempoRealModule } from '../tempo-real/tempo-real.module.js';
import { GatewayPagamento, GatewaySimulado } from './pagamento.js';
import { PedidosService } from './pedidos.service.js';

@Controller('pedidos')
@UseGuards(ExigeSessao)
export class PedidosController {
  constructor(private readonly pedidos: PedidosService) {}

  /** 201 quando cria; 200 quando a mesma chave e o mesmo corpo devolvem o pedido já criado. */
  @Post()
  async criar(
    @UsuarioAtual() u: Usuario,
    @Headers(CABECALHO_IDEMPOTENCIA) chave: string | undefined,
    @Body() corpo: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { pedido, repetido } = await this.pedidos.criar(u.id, chave, corpoObjeto(corpo));
    res.status(repetido ? 200 : 201);
    return pedido;
  }

  @Get()
  listar(@UsuarioAtual() u: Usuario) {
    return this.pedidos.listar(u.id);
  }

  @Get(':id')
  detalhar(@UsuarioAtual() u: Usuario, @Param('id') id: string) {
    return this.pedidos.detalhar(u.id, id);
  }
}

@Module({
  imports: [SessaoModule, CarrinhoModule, TempoRealModule],
  controllers: [PedidosController],
  providers: [PedidosService, { provide: GatewayPagamento, useClass: GatewaySimulado }],
})
export class PedidosModule {}
