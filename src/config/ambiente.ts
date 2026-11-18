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
  /** Conexões no pool do driver. O PGlite local precisa de 1 (veja scripts/dev.mjs). */
  poolMaximo: number;
  /** Limite de login: tentativas (login + cadastro) por IP na janela. */
  loginMaximoPorIp: number;
  /** Limite de login: senhas erradas do mesmo e-mail, no mesmo IP, na janela. */
  loginMaximoFalhas: number;
  loginJanelaSegundos: number;
  /** Quantos proxies na frente da API (balanceador da AWS = 1). 0 = IP da conexão. */
  saltosProxy: number;
}

function inteiroPositivo(env: NodeJS.ProcessEnv, nome: string, padrao: number, minimo = 1): number {
  const valor = Number(env[nome] ?? padrao);
  if (!Number.isInteger(valor) || valor < minimo) {
    throw new Error(`${nome} inválida: "${env[nome]}".`);
  }
  return valor;
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

  const poolMaximo = Number(env.DB_POOL_MAX ?? 10);
  if (!Number.isInteger(poolMaximo) || poolMaximo <= 0) {
    throw new Error(`DB_POOL_MAX inválido: "${env.DB_POOL_MAX}".`);
  }

  const origensCors = (env.CORS_ORIGENS ?? 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  return {
    porta, urlBanco, origensCors, jwtSegredo, sessaoDuracaoSegundos, poolMaximo,
    loginMaximoPorIp: inteiroPositivo(env, 'LOGIN_MAX_POR_IP', 30),
    loginMaximoFalhas: inteiroPositivo(env, 'LOGIN_MAX_FALHAS', 5),
    loginJanelaSegundos: inteiroPositivo(env, 'LOGIN_JANELA_SEGUNDOS', 900),
    saltosProxy: inteiroPositivo(env, 'CONFIAR_PROXY', 0, 0),
  };
}
