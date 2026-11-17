import { Module } from '@nestjs/common';
import { SessaoModule } from '../sessao/sessao.module.js';
import { CatalogoController } from './catalogo.controller.js';
import { CatalogoService } from './catalogo.service.js';

@Module({
  imports: [SessaoModule],
  controllers: [CatalogoController],
  providers: [CatalogoService],
})
export class CatalogoModule {}
