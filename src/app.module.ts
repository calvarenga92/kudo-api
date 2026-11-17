import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { lerAmbiente } from './config/ambiente.js';
import { SaudeController } from './saude/saude.controller.js';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      useFactory: () => ({
        type: 'postgres',
        url: lerAmbiente().urlBanco,
        autoLoadEntities: true,
        // Esquema muda só por migração; synchronize apagaria dado em produção.
        synchronize: false,
        retryAttempts: 3,
      }),
    }),
  ],
  controllers: [SaudeController],
})
export class AppModule {}
