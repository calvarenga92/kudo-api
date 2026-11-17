import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';

const scrypt = (senha: string, sal: Buffer, tamanho: number, opcoes: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) =>
    scryptCb(senha, sal, tamanho, opcoes, (erro, chave) => (erro ? reject(erro) : resolve(chave))),
  );

/** Parâmetros recomendados pela OWASP para scrypt. Ficam gravados no hash para poderem subir depois. */
const N = 2 ** 17;
const R = 8;
const P = 1;
const TAMANHO = 64;
const MEMORIA_MAXIMA = 256 * 1024 * 1024;

/** Formato: scrypt$N$r$p$sal$hash (base64). */
export async function gerarHash(senha: string): Promise<string> {
  const sal = randomBytes(16);
  const hash = await scrypt(senha, sal, TAMANHO, { N, r: R, p: P, maxmem: MEMORIA_MAXIMA });
  return ['scrypt', N, R, P, sal.toString('base64'), hash.toString('base64')].join('$');
}

export async function conferirSenha(senha: string, armazenado: string): Promise<boolean> {
  const [algoritmo, n, r, p, sal, hash] = armazenado.split('$');
  if (algoritmo !== 'scrypt' || !sal || !hash) return false;

  const esperado = Buffer.from(hash, 'base64');
  const calculado = await scrypt(senha, Buffer.from(sal, 'base64'), esperado.length, {
    N: Number(n), r: Number(r), p: Number(p), maxmem: MEMORIA_MAXIMA,
  });
  return timingSafeEqual(calculado, esperado);
}

/**
 * Hash de uma senha que ninguém tem. Login com e-mail inexistente confere contra ele,
 * para levar o mesmo tempo que uma senha errada e não revelar quem tem conta.
 */
let hashFicticio: Promise<string> | undefined;
export const hashParaEmailInexistente = () => (hashFicticio ??= gerarHash(randomBytes(16).toString('hex')));
