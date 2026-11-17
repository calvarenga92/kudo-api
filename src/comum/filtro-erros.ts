import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { CodigoErro, CorpoErro } from '@calvarenga92/kurio-regras';
import type { Response } from 'express';
import { ErroAplicacao } from './erro-aplicacao.js';

/** Erros do próprio Nest (rota inexistente, JSON malformado...) no código que o front entende. */
const CODIGO_POR_STATUS: Partial<Record<number, CodigoErro>> = {
  [HttpStatus.BAD_REQUEST]: 'DADOS_INVALIDOS',
  [HttpStatus.UNAUTHORIZED]: 'NAO_AUTENTICADO',
  [HttpStatus.FORBIDDEN]: 'ACESSO_NEGADO',
  [HttpStatus.NOT_FOUND]: 'NAO_ENCONTRADO',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'DADOS_INVALIDOS',
  [HttpStatus.SERVICE_UNAVAILABLE]: 'FALHA_TRANSITORIA',
};

/**
 * Toda resposta de erro sai no formato `{ codigo, mensagem, campos? }`,
 * o mesmo que o MSW do front já devolve. Nada de stack trace para fora.
 */
@Catch()
export class FiltroErros implements ExceptionFilter {
  private readonly log = new Logger(FiltroErros.name);

  catch(excecao: unknown, host: ArgumentsHost): void {
    const resposta = host.switchToHttp().getResponse<Response>();
    const { status, corpo } = this.traduzir(excecao);

    if (status >= 500) {
      this.log.error(excecao instanceof Error ? excecao.stack : String(excecao));
    }

    resposta.status(status).json(corpo);
  }

  traduzir(excecao: unknown): { status: number; corpo: CorpoErro } {
    if (excecao instanceof ErroAplicacao) {
      const corpo: CorpoErro = { codigo: excecao.codigo, mensagem: excecao.message };
      if (excecao.campos) corpo.campos = excecao.campos;
      return { status: excecao.status, corpo };
    }

    if (excecao instanceof HttpException) {
      const status = excecao.getStatus();
      const codigo = CODIGO_POR_STATUS[status] ?? (status >= 500 ? 'FALHA_TRANSITORIA' : 'ERRO_DESCONHECIDO');
      return { status, corpo: { codigo, mensagem: mensagemPadrao(codigo) } };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      corpo: { codigo: 'ERRO_DESCONHECIDO', mensagem: mensagemPadrao('ERRO_DESCONHECIDO') },
    };
  }
}

function mensagemPadrao(codigo: CodigoErro): string {
  switch (codigo) {
    case 'NAO_ENCONTRADO':
      return 'Recurso não encontrado.';
    case 'DADOS_INVALIDOS':
      return 'Requisição inválida.';
    case 'NAO_AUTENTICADO':
      return 'Entre na sua conta para continuar.';
    case 'ACESSO_NEGADO':
      return 'Você não tem acesso a este recurso.';
    case 'FALHA_TRANSITORIA':
      return 'Serviço indisponível no momento.';
    default:
      return 'Algo deu errado. Tente de novo.';
  }
}
