import { lerAmbiente } from './ambiente.js';

describe('lerAmbiente', () => {
  it('falha na subida quando DATABASE_URL não existe', () => {
    expect(() => lerAmbiente({})).toThrow(/DATABASE_URL/);
  });

  it('usa padrões de desenvolvimento para porta e CORS', () => {
    expect(lerAmbiente({ DATABASE_URL: 'postgres://x' })).toEqual({
      porta: 3000,
      urlBanco: 'postgres://x',
      origensCors: ['http://localhost:5173'],
    });
  });

  it('aceita várias origens separadas por vírgula', () => {
    const { origensCors } = lerAmbiente({
      DATABASE_URL: 'postgres://x',
      CORS_ORIGENS: 'https://a.vercel.app, https://b.vercel.app',
    });
    expect(origensCors).toEqual(['https://a.vercel.app', 'https://b.vercel.app']);
  });

  it('recusa porta inválida', () => {
    expect(() => lerAmbiente({ DATABASE_URL: 'postgres://x', PORT: 'abc' })).toThrow(/PORT/);
  });
});
