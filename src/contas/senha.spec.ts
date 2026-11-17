import { conferirSenha, gerarHash } from './senha.js';

describe('senha', () => {
  it('confere a senha certa e recusa a errada', async () => {
    const hash = await gerarHash('senha12345');
    expect(await conferirSenha('senha12345', hash)).toBe(true);
    expect(await conferirSenha('senha12346', hash)).toBe(false);
  });

  it('não guarda a senha e gera sal novo a cada hash', async () => {
    const a = await gerarHash('senha12345');
    const b = await gerarHash('senha12345');
    expect(a).not.toContain('senha12345');
    expect(a).not.toBe(b);
    expect(a.startsWith('scrypt$131072$8$1$')).toBe(true);
  });

  it('hash em formato desconhecido nunca confere', async () => {
    expect(await conferirSenha('qualquer', 'texto-puro')).toBe(false);
  });
});
