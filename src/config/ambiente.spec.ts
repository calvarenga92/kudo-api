import { lerAmbiente } from './ambiente.js';

const SEGREDO = 'x'.repeat(32);
const BASE = { DATABASE_URL: 'postgres://x', JWT_SEGREDO: SEGREDO };

describe('lerAmbiente', () => {
  it('falha na subida quando DATABASE_URL não existe', () => {
    expect(() => lerAmbiente({ JWT_SEGREDO: SEGREDO })).toThrow(/DATABASE_URL/);
  });

  it('falha na subida sem segredo de JWT ou com segredo curto', () => {
    expect(() => lerAmbiente({ DATABASE_URL: 'postgres://x' })).toThrow(/JWT_SEGREDO/);
    expect(() => lerAmbiente({ ...BASE, JWT_SEGREDO: 'curto' })).toThrow(/JWT_SEGREDO/);
  });

  it('usa padrões de desenvolvimento para porta, CORS e duração da sessão', () => {
    expect(lerAmbiente(BASE)).toEqual({
      porta: 3000,
      urlBanco: 'postgres://x',
      origensCors: ['http://localhost:5173'],
      jwtSegredo: SEGREDO,
      sessaoDuracaoSegundos: 3600,
      poolMaximo: 10,
    });
  });

  it('aceita várias origens separadas por vírgula', () => {
    const { origensCors } = lerAmbiente({
      ...BASE,
      CORS_ORIGENS: 'https://a.vercel.app, https://b.vercel.app',
    });
    expect(origensCors).toEqual(['https://a.vercel.app', 'https://b.vercel.app']);
  });

  it('recusa porta e duração inválidas', () => {
    expect(() => lerAmbiente({ ...BASE, PORT: 'abc' })).toThrow(/PORT/);
    expect(() => lerAmbiente({ ...BASE, SESSAO_DURACAO_SEGUNDOS: '0' })).toThrow(/SESSAO/);
  });
});
