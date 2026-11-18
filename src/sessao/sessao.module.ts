import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { lerAmbiente } from '../config/ambiente.js';
import { ExigeSessao } from './autenticacao.js';
import { LimiteLogin } from './limite-login.js';
import { SessaoController } from './sessao.controller.js';
import { SessaoService } from './sessao.service.js';

@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: () => ({
        secret: lerAmbiente().jwtSegredo,
        signOptions: { algorithm: 'HS256' },
        // Fixa o algoritmo na verificação: token com "alg: none" ou outro algoritmo é recusado.
        verifyOptions: { algorithms: ['HS256'] },
      }),
    }),
  ],
  controllers: [SessaoController],
  providers: [SessaoService, ExigeSessao, LimiteLogin],
  exports: [SessaoService, ExigeSessao],
})
export class SessaoModule {}
