import type { CodigoErro as CodigoDoContrato } from '@calvarenga92/kurio-regras';

/**
 * `MUITAS_TENTATIVAS` já está no contrato do @calvarenga92/kudo-regras 0.2.0. Enquanto a API
 * usa a kurio-regras 0.1.0, ele entra aqui; na troca de pacote, este tipo vira só o reexport.
 */
export type CodigoErro = CodigoDoContrato | 'MUITAS_TENTATIVAS';

/**
 * Erro de regra de negócio. O front decide pelo `codigo`, nunca pelo texto,
 * então o código é o contrato e a mensagem é só para a pessoa ler.
 */
export class ErroAplicacao extends Error {
  constructor(
    readonly status: number,
    readonly codigo: CodigoErro,
    mensagem: string,
    readonly campos?: Record<string, string>,
    /** Cabeçalhos extras da resposta (ex.: Retry-After). */
    readonly cabecalhos?: Record<string, string>,
  ) {
    super(mensagem);
    this.name = 'ErroAplicacao';
  }
}

export const naoEncontrado = (oQue: string, genero: 'o' | 'a' = 'o') =>
  new ErroAplicacao(404, 'NAO_ENCONTRADO', `${oQue} não encontrad${genero}.`);

export const naoAutenticado = () =>
  new ErroAplicacao(401, 'NAO_AUTENTICADO', 'Entre na sua conta para continuar.');

export const sessaoExpirada = () =>
  new ErroAplicacao(401, 'SESSAO_EXPIRADA', 'Sua sessão expirou. Entre novamente.');

export const dadosInvalidos = (campos: Record<string, string>) =>
  new ErroAplicacao(422, 'DADOS_INVALIDOS', 'Confira os campos destacados.', campos);

/** 429 com Retry-After em segundos, arredondado para cima: o cliente nunca volta cedo demais. */
export function muitasTentativas(esperaMs: number) {
  const segundos = Math.max(1, Math.ceil(esperaMs / 1000));
  const minutos = Math.ceil(segundos / 60);
  const quando = minutos <= 1 ? 'em 1 minuto' : `em ${minutos} minutos`;
  return new ErroAplicacao(
    429, 'MUITAS_TENTATIVAS', `Muitas tentativas. Tente de novo ${quando}.`, undefined,
    { 'Retry-After': String(segundos) },
  );
}
