import { Module } from '@nestjs/common';
import { SessaoModule } from '../sessao/sessao.module.js';
import { EventosGateway } from './eventos.gateway.js';

@Module({
  imports: [SessaoModule],
  providers: [EventosGateway],
  exports: [EventosGateway],
})
export class TempoRealModule {}
