import { LimiteTentativas } from './limite-tentativas.js';

const MINUTO = 60_000;

describe('LimiteTentativas', () => {
  let agora: number;
  let limite: LimiteTentativas;

  beforeEach(() => {
    agora = 1_000_000;
    limite = new LimiteTentativas(3, 15 * MINUTO, () => agora);
  });

  it('libera até o máximo e bloqueia a partir daí, dizendo quanto falta', () => {
    expect(limite.registrarEConferir('ip')).toBe(0);
    expect(limite.registrarEConferir('ip')).toBe(0);
    expect(limite.registrarEConferir('ip')).toBe(0);
    agora += 5 * MINUTO;
    expect(limite.registrarEConferir('ip')).toBe(10 * MINUTO);
  });

  it('a janela conta a partir da primeira tentativa e libera quando acaba', () => {
    for (let i = 0; i < 3; i++) limite.registrar('ip');
    agora += 15 * MINUTO;
    expect(limite.bloqueadoPor('ip')).toBe(0);
    expect(limite.registrarEConferir('ip')).toBe(0);
  });

  it('tentativa bloqueada não estica o bloqueio', () => {
    for (let i = 0; i < 3; i++) limite.registrar('ip');
    for (let i = 0; i < 10; i++) limite.registrarEConferir('ip');
    agora += 15 * MINUTO;
    expect(limite.bloqueadoPor('ip')).toBe(0);
  });

  it('cada chave tem a própria contagem', () => {
    for (let i = 0; i < 3; i++) limite.registrar('a');
    expect(limite.bloqueadoPor('a')).toBeGreaterThan(0);
    expect(limite.bloqueadoPor('b')).toBe(0);
  });

  it('esquecer zera a chave (login certo apaga as falhas)', () => {
    for (let i = 0; i < 3; i++) limite.registrar('a');
    limite.esquecer('a');
    expect(limite.bloqueadoPor('a')).toBe(0);
  });

  it('apaga sozinho as janelas vencidas, sem crescer para sempre', () => {
    for (let i = 0; i < 500; i++) limite.registrar(`ip-${i}`);
    agora += 15 * MINUTO;
    for (let i = 0; i < 500; i++) limite.registrar(`outro-${i}`);
    expect(limite.tamanho).toBe(500);
  });
});
