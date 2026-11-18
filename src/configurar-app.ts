import type { INestApplication } from '@nestjs/common';
import { CABECALHO_IDEMPOTENCIA } from '@calvarenga92/kurio-regras';
import { CABECALHO_CARRINHO } from './carrinho/mescla.js';
import { FiltroErros } from './comum/filtro-erros.js';
import { AdaptadorSocket } from './tempo-real/adaptador-socket.js';

/**
 * Tudo que a aplicação precisa além dos módulos. Fica separado do main.ts
 * para os testes e2e subirem a API exatamente como em produção.
 */
export function configurarApp(app: INestApplication, origensCors: string[], saltosProxy = 0): void {
  // Atrás do balanceador, o IP da conexão é o dele; o da pessoa vem no X-Forwarded-For.
  // Confiar só no número exato de saltos: confiar em tudo deixaria o cliente forjar o IP.
  if (saltosProxy > 0) app.getHttpAdapter().getInstance().set('trust proxy', saltosProxy);
  // O front chama `${VITE_API_URL}/nfts`; em dev o padrão dele é '/api'.
  app.setGlobalPrefix('api');
  app.useGlobalFilters(new FiltroErros());
  app.enableCors({
    origin: origensCors,
    allowedHeaders: ['Content-Type', 'Authorization', CABECALHO_IDEMPOTENCIA, CABECALHO_CARRINHO],
    // Sem expor, o navegador esconde do front o id do carrinho de visitante.
    exposedHeaders: [CABECALHO_CARRINHO],
  });
  // Socket.IO em /socket.io, na mesma porta: o front usa VITE_SOCKET_URL = origem da API.
  app.useWebSocketAdapter(new AdaptadorSocket(app, origensCors));
  app.enableShutdownHooks();
}
