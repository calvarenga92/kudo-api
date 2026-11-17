import { dadosInvalidos } from './erro-aplicacao.js';

/** Corpo JSON que não é objeto (lista, número, nada) vira {}: a validação de campo responde. */
export const corpoObjeto = (corpo: unknown): Record<string, unknown> =>
  corpo && typeof corpo === 'object' && !Array.isArray(corpo) ? (corpo as Record<string, unknown>) : {};

export const texto = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Inteiro dentro da faixa, ou 422 apontando o campo. Ausente usa o padrão, se houver. */
export function inteiroDoCorpo(
  corpo: Record<string, unknown>, campo: string, min: number, max: number, padrao?: number,
): number {
  const valor = corpo[campo] ?? padrao;
  if (typeof valor !== 'number' || !Number.isInteger(valor) || valor < min || valor > max) {
    throw dadosInvalidos({ [campo]: `Use um número inteiro entre ${min} e ${max}.` });
  }
  return valor;
}
