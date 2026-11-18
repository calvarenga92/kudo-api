import {
  CanActivate, createParamDecorator, ExecutionContext, Injectable,
} from '@nestjs/common';
import type { Usuario } from '@calvarenga92/kudo-regras';
import type { Request } from 'express';
import { naoAutenticado } from '../comum/erro-aplicacao.js';
import { SessaoService } from './sessao.service.js';

type RequisicaoComUsuario = Request & { usuario?: Usuario };

export function tokenDaRequisicao(req: Request): string | null {
  const cabecalho = req.headers.authorization;
  return cabecalho?.startsWith('Bearer ') ? cabecalho.slice(7).trim() || null : null;
}

/**
 * Rota que exige conta. Sem token: 401 NAO_AUTENTICADO (o front manda para /entrar).
 * Token vencido ou revogado: 401 SESSAO_EXPIRADA (o front limpa o token antes).
 */
@Injectable()
export class ExigeSessao implements CanActivate {
  constructor(private readonly sessoes: SessaoService) {}

  async canActivate(contexto: ExecutionContext): Promise<boolean> {
    const req = contexto.switchToHttp().getRequest<RequisicaoComUsuario>();
    const token = tokenDaRequisicao(req);
    if (!token) throw naoAutenticado();
    req.usuario = (await this.sessoes.validar(token)).usuario;
    return true;
  }
}

/** Usuário da sessão, preenchido por ExigeSessao. */
export const UsuarioAtual = createParamDecorator(
  (_: unknown, contexto: ExecutionContext): Usuario =>
    contexto.switchToHttp().getRequest<RequisicaoComUsuario>().usuario!,
);
