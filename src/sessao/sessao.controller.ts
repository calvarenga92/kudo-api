import {
  Body, Controller, Delete, Get, HttpCode, Patch, Post, Req, Res, UseGuards,
} from '@nestjs/common';
import type { Usuario } from '@calvarenga92/kurio-regras';
import type { Request, Response } from 'express';
import { DataSource } from 'typeorm';
import { CABECALHO_CARRINHO } from '../carrinho/mescla.js';
import { corpoObjeto, texto } from '../comum/corpo.js';
import { dadosInvalidos, ErroAplicacao } from '../comum/erro-aplicacao.js';
import { ExigeSessao, tokenDaRequisicao, UsuarioAtual } from './autenticacao.js';
import { LimiteLogin } from './limite-login.js';
import { paraUsuario, SessaoService } from './sessao.service.js';

export const carrinhoVisitanteDa = (req: Request): string | null =>
  req.get(CABECALHO_CARRINHO)?.trim() || null;

/** Atrás de proxy, o Express só usa X-Forwarded-For se `trust proxy` estiver ligado (CONFIAR_PROXY). */
const ipDa = (req: Request): string => req.ip ?? req.socket.remoteAddress ?? 'desconhecido';

@Controller()
export class SessaoController {
  constructor(
    private readonly sessoes: SessaoService,
    private readonly banco: DataSource,
    private readonly limite: LimiteLogin,
  ) {}

  @Post('sessao')
  @HttpCode(200)
  async entrar(@Body() corpo: unknown, @Req() req: Request) {
    const dados = corpoObjeto(corpo);
    const ip = ipDa(req);
    const email = texto(dados.email);
    this.limite.conferir(ip, email);
    try {
      const sessao = await this.sessoes.entrar(dados, carrinhoVisitanteDa(req));
      this.limite.registrarSucesso(ip, email);
      return sessao;
    } catch (erro) {
      if (erro instanceof ErroAplicacao && erro.codigo === 'CREDENCIAIS_INVALIDAS') {
        this.limite.registrarFalha(ip, email);
      }
      throw erro;
    }
  }

  @Post('contas')
  cadastrar(@Body() corpo: unknown, @Req() req: Request) {
    this.limite.conferir(ipDa(req));
    return this.sessoes.cadastrar(corpoObjeto(corpo), carrinhoVisitanteDa(req));
  }

  /** Visitante recebe 204 sem corpo, como o mock. */
  @Get('sessao')
  async consultar(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const sessao = await this.sessoes.consultar(tokenDaRequisicao(req));
    if (!sessao) res.status(204);
    return sessao ?? undefined;
  }

  @Delete('sessao')
  @HttpCode(204)
  async sair(@Req() req: Request) {
    await this.sessoes.sair(tokenDaRequisicao(req));
  }

  @Patch('perfil')
  @UseGuards(ExigeSessao)
  async atualizarPerfil(@UsuarioAtual() usuario: Usuario, @Body() corpo: unknown): Promise<Usuario> {
    const nome = corpoObjeto(corpo).nome;
    const limpo = typeof nome === 'string' ? nome.trim() : '';
    if (!limpo) throw dadosInvalidos({ nome: 'Informe seu nome.' });
    if (limpo.length > 80) throw dadosInvalidos({ nome: 'Use no máximo 80 caracteres.' });

    const [[linha]] = await this.banco.query(
      `UPDATE contas SET nome = $2 WHERE id = $1 RETURNING id, nome, email, avatar_url`,
      [usuario.id, limpo],
    );
    return paraUsuario(linha);
  }
}
