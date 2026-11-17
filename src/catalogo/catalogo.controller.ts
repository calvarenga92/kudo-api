import { Controller, Get, Param, Query } from '@nestjs/common';
import { CatalogoService } from './catalogo.service.js';
import { lerConsulta } from './consulta.js';

@Controller()
export class CatalogoController {
  constructor(private readonly catalogo: CatalogoService) {}

  @Get('nfts')
  listar(@Query() query: Record<string, unknown>) {
    return this.catalogo.listar(lerConsulta(query));
  }

  // Declarada antes de nfts/:id; senão "faixa" seria lido como id.
  @Get('nfts/faixa')
  faixa() {
    return this.catalogo.faixaDePreco();
  }

  @Get('nfts/:id')
  detalhar(@Param('id') id: string) {
    return this.catalogo.detalhar(id);
  }

  @Get('colecoes')
  colecoes() {
    return this.catalogo.colecoes();
  }
}
