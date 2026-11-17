/**
 * Variáveis de ambiente lidas uma vez, na subida. Faltou algo obrigatório,
 * a aplicação nem sobe: melhor falhar no deploy do que na primeira requisição.
 */
export interface Ambiente {
  porta: number;
  urlBanco: string;
  origensCors: string[];
  jwtSegredo: string;
  sessaoDuracaoSegundos: number;
}

export function lerAmbiente(env: NodeJS.ProcessEnv = process.env): Ambiente {
  const urlBanco = env.DATABASE_URL?.trim();
  if (!urlBanco) {
    throw new Error('DATABASE_URL não definida. Veja o .env.example.');
  }

  const jwtSegredo = env.JWT_SEGREDO?.trim() ?? '';
  if (jwtSegredo.length < 32) {
    throw new Error('JWT_SEGREDO precisa de ao menos 32 caracteres. Veja o .env.example.');
  }

  const porta = Number(env.PORT ?? 3000);
  if (!Number.isInteger(porta) || porta <= 0) {
    throw new Error(`PORT inválida: "${env.PORT}".`);
  }

  // Uma hora, como o mock do front.
  const sessaoDuracaoSegundos = Number(env.SESSAO_DURACAO_SEGUNDOS ?? 3600);
  if (!Number.isInteger(sessaoDuracaoSegundos) || sessaoDuracaoSegundos <= 0) {
    throw new Error(`SESSAO_DURACAO_SEGUNDOS inválida: "${env.SESSAO_DURACAO_SEGUNDOS}".`);
  }

  const origensCors = (env.CORS_ORIGENS ?? 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  return { porta, urlBanco, origensCors, jwtSegredo, sessaoDuracaoSegundos };
}
