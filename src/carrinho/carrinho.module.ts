import { Body, Controller, Delete, Get, Module, Param, Patch, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { corpoObjeto } from '../comum/corpo.js';
import { tokenDaRequisicao } from '../sessao/autenticacao.js';
import { carrinhoVisitanteDa } from '../sessao/sessao.controller.js';
import { SessaoModule } from '../sessao/sessao.module.js';
import { SessaoService } from '../sessao/sessao.service.js';
import { CarrinhoService, type Comprador, type Resultado } from './carrinho.service.js';
import { CABECALHO_CARRINHO } from './mescla.js';

/**
 * Carrinho funciona com ou sem conta. Visitante é identificado pelo cabeçalho
 * X-Carrinho-Visitante: a API devolve o id ao criar o carrinho e o front reenvia.
 */
@Controller('carrinho')
export class CarrinhoController {
  constructor(
    private readonly carrinho: CarrinhoService,
    private readonly sessoes: SessaoService,
  ) {}

  private async comprador(req: Request): Promise<Comprador> {
    const usuario = await this.sessoes.usuarioOpcional(tokenDaRequisicao(req));
    return { contaId: usuario?.id ?? null, visitanteId: usuario ? null : carrinhoVisitanteDa(req) };
  }

  private responder(res: Response, { cotacao, visitanteId }: Resultado) {
    if (visitanteId) res.setHeader(CABECALHO_CARRINHO, visitanteId);
    return cotacao;
  }

  @Get()
  async consultar(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.responder(res, await this.carrinho.consultar(await this.comprador(req)));
  }

  @Post('itens')
  async adicionar(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() corpo: unknown) {
    return this.responder(res, await this.carrinho.adicionar(await this.comprador(req), corpoObjeto(corpo)));
  }

  @Patch('itens/:id')
  async atualizar(
    @Req() req: Request, @Res({ passthrough: true }) res: Response, @Param('id') id: string, @Body() corpo: unknown,
  ) {
    return this.responder(res, await this.carrinho.atualizarItem(await this.comprador(req), id, corpoObjeto(corpo)));
  }

  @Delete('itens/:id')
  async remover(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Param('id') id: string) {
    return this.responder(res, await this.carrinho.removerItem(await this.comprador(req), id));
  }

  @Post('cupom')
  async aplicarCupom(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() corpo: unknown) {
    const resultado = await this.carrinho.aplicarCupom(await this.comprador(req), corpoObjeto(corpo));
    res.status(200);
    return this.responder(res, resultado);
  }

  @Delete('cupom')
  async removerCupom(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.responder(res, await this.carrinho.removerCupom(await this.comprador(req)));
  }
}

@Module({
  imports: [SessaoModule],
  controllers: [CarrinhoController],
  providers: [CarrinhoService],
  exports: [CarrinhoService],
})
export class CarrinhoModule {}
