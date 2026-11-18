import { Controller, Delete, Get, Param, Put, Query, Req, UseGuards } from '@nestjs/common';
import type { Usuario } from '@calvarenga92/kudo-regras';
import type { Request } from 'express';
import { ExigeSessao, tokenDaRequisicao, UsuarioAtual } from '../sessao/autenticacao.js';
import { SessaoService } from '../sessao/sessao.service.js';
import { CatalogoService } from './catalogo.service.js';
import { lerConsulta } from './consulta.js';

@Controller()
export class CatalogoController {
  constructor(
    private readonly catalogo: CatalogoService,
    private readonly sessoes: SessaoService,
  ) {}

  /** Catálogo é público; com sessão, cada peça vem marcada se é favorita. */
  private async contaOpcional(req: Request): Promise<string | null> {
    return (await this.sessoes.usuarioOpcional(tokenDaRequisicao(req)))?.id ?? null;
  }

  @Get('nfts')
  async listar(@Query() query: Record<string, unknown>, @Req() req: Request) {
    const consulta = lerConsulta(query);
    return this.catalogo.listar(consulta, await this.contaOpcional(req));
  }

  // Declarada antes de nfts/:id; senão "faixa" seria lido como id.
  @Get('nfts/faixa')
  faixa() {
    return this.catalogo.faixaDePreco();
  }

  @Get('nfts/:id')
  async detalhar(@Param('id') id: string, @Req() req: Request) {
    return this.catalogo.detalhar(id, await this.contaOpcional(req));
  }

  @Get('colecoes')
  colecoes() {
    return this.catalogo.colecoes();
  }

  /** Visitante recebe lista vazia, como o mock. */
  @Get('favoritos')
  async favoritos(@Req() req: Request) {
    return this.catalogo.favoritos(await this.contaOpcional(req));
  }

  @Put('favoritos/:id')
  @UseGuards(ExigeSessao)
  favoritar(@UsuarioAtual() usuario: Usuario, @Param('id') nftId: string) {
    return this.catalogo.marcarFavorito(usuario.id, nftId, true);
  }

  @Delete('favoritos/:id')
  @UseGuards(ExigeSessao)
  desfavoritar(@UsuarioAtual() usuario: Usuario, @Param('id') nftId: string) {
    return this.catalogo.marcarFavorito(usuario.id, nftId, false);
  }
}
