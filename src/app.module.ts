import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MIGRACOES } from './banco/migracoes/index.js';
import { CarrinhoModule } from './carrinho/carrinho.module.js';
import { CarteirasModule } from './carteiras/carteiras.module.js';
import { CatalogoModule } from './catalogo/catalogo.module.js';
import { lerAmbiente } from './config/ambiente.js';
import { PedidosModule } from './pedidos/pedidos.module.js';
import { SaudeController } from './saude/saude.controller.js';
import { SessaoModule } from './sessao/sessao.module.js';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      useFactory: () => ({
        type: 'postgres',
        url: lerAmbiente().urlBanco,
        extra: { max: lerAmbiente().poolMaximo },
        autoLoadEntities: true,
        // Esquema muda só por migração; synchronize apagaria dado em produção.
        synchronize: false,
        migrations: MIGRACOES,
        migrationsRun: true,
        retryAttempts: 3,
      }),
    }),
    CatalogoModule,
    SessaoModule,
    CarteirasModule,
    CarrinhoModule,
    PedidosModule,
  ],
  controllers: [SaudeController],
})
export class AppModule {}
