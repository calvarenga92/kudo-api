import { Body, Controller, Delete, Get, Module, Param, Post, Put, UseGuards } from '@nestjs/common';
import type { Usuario } from '@calvarenga92/kurio-regras';
import { corpoObjeto } from '../comum/corpo.js';
import { ExigeSessao, UsuarioAtual } from '../sessao/autenticacao.js';
import { SessaoModule } from '../sessao/sessao.module.js';
import { CarteirasService } from './carteiras.service.js';

@Controller('carteiras')
@UseGuards(ExigeSessao)
export class CarteirasController {
  constructor(private readonly carteiras: CarteirasService) {}

  @Get()
  listar(@UsuarioAtual() u: Usuario) {
    return this.carteiras.listar(u.id);
  }

  @Post()
  adicionar(@UsuarioAtual() u: Usuario, @Body() corpo: unknown) {
    return this.carteiras.adicionar(u.id, corpoObjeto(corpo));
  }

  @Put(':id/principal')
  tornarPrincipal(@UsuarioAtual() u: Usuario, @Param('id') id: string) {
    return this.carteiras.tornarPrincipal(u.id, id);
  }

  @Delete(':id')
  remover(@UsuarioAtual() u: Usuario, @Param('id') id: string) {
    return this.carteiras.remover(u.id, id);
  }
}

@Module({
  imports: [SessaoModule],
  controllers: [CarteirasController],
  providers: [CarteirasService],
  exports: [CarteirasService],
})
export class CarteirasModule {}
