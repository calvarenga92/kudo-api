import type { CodigoErro } from '@calvarenga92/kurio-regras';

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
