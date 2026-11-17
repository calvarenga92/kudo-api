import type { INestApplication } from '@nestjs/common';
import { CABECALHO_IDEMPOTENCIA } from '@calvarenga92/kurio-regras';
import { FiltroErros } from './comum/filtro-erros.js';

/**
 * Tudo que a aplicação precisa além dos módulos. Fica separado do main.ts
 * para os testes e2e subirem a API exatamente como em produção.
 */
export function configurarApp(app: INestApplication, origensCors: string[]): void {
  // O front chama `${VITE_API_URL}/nfts`; em dev o padrão dele é '/api'.
  app.setGlobalPrefix('api');
  app.useGlobalFilters(new FiltroErros());
  app.enableCors({
    origin: origensCors,
    allowedHeaders: ['Content-Type', 'Authorization', CABECALHO_IDEMPOTENCIA],
  });
  app.enableShutdownHooks();
}
