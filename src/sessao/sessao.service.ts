import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomBytes, randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import type { Sessao, Usuario } from '@calvarenga92/kudo-regras';
import { lerAmbiente } from '../config/ambiente.js';
import { dadosInvalidos, ErroAplicacao, sessaoExpirada } from '../comum/erro-aplicacao.js';
import { conferirSenha, gerarHash, hashParaEmailInexistente } from '../contas/senha.js';
import { mesclarCarrinhoVisitante } from '../carrinho/mescla.js';
import { texto } from '../comum/corpo.js';

export type SessaoComToken = Sessao & { token: string };

/** Sessão validada com o que só o servidor precisa saber: o id (jti) e o fim. */
export interface SessaoValidada {
  jti: string;
  usuario: Usuario;
  expiraEm: Date;
}

interface LinhaConta {
  id: string;
  nome: string;
  email: string;
  avatar_url: string | null;
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

@Injectable()
export class SessaoService {
  private readonly duracaoSegundos = lerAmbiente().sessaoDuracaoSegundos;
  private readonly aoEncerrarSessao = new Set<(jti: string) => void>();

  constructor(
    private readonly banco: DataSource,
    private readonly jwt: JwtService,
  ) {}

  /** `carrinhoVisitante`: o que a pessoa montou antes de entrar passa para a conta. */
  async entrar(corpo: Record<string, unknown>, carrinhoVisitante: string | null): Promise<SessaoComToken> {
    const email = texto(corpo.email).trim();
    const senha = texto(corpo.senha);
    const campos: Record<string, string> = {};
    if (!email) campos.email = 'Informe o e-mail.';
    if (!senha) campos.senha = 'Informe a senha.';
    if (Object.keys(campos).length > 0) throw dadosInvalidos(campos);

    const [conta] = await this.banco.query<Array<LinhaConta & { senha_hash: string }>>(
      `SELECT id, nome, email, avatar_url, senha_hash FROM contas WHERE lower(email) = lower($1)`,
      [email],
    );

    // Mesma resposta e mesmo custo para e-mail inexistente e senha errada: não revela quem tem conta.
    const confere = await conferirSenha(senha, conta?.senha_hash ?? (await hashParaEmailInexistente()));
    if (!conta || !confere) {
      throw new ErroAplicacao(401, 'CREDENCIAIS_INVALIDAS', 'E-mail ou senha incorretos.');
    }

    return this.abrirSessao(conta, carrinhoVisitante);
  }

  async cadastrar(corpo: Record<string, unknown>, carrinhoVisitante: string | null): Promise<SessaoComToken> {
    const nome = texto(corpo.nome).trim();
    const email = texto(corpo.email).trim();
    const senha = texto(corpo.senha);

    const campos: Record<string, string> = {};
    if (!nome) campos.nome = 'Informe seu nome.';
    else if (nome.length > 80) campos.nome = 'Use no máximo 80 caracteres.';
    if (!EMAIL.test(email) || email.length > 254) campos.email = 'E-mail inválido.';
    if (senha.length < 8) campos.senha = 'Use ao menos 8 caracteres.';
    // Limite do lado de cima também: senha gigante vira negação de serviço no hash.
    else if (senha.length > 128) campos.senha = 'Use no máximo 128 caracteres.';
    if (Object.keys(campos).length > 0) throw dadosInvalidos(campos);

    const id = `usr-${randomBytes(6).toString('hex')}`;
    const senhaHash = await gerarHash(senha);
    try {
      await this.banco.query(
        `INSERT INTO contas (id, nome, email, senha_hash) VALUES ($1, $2, $3, $4)`,
        [id, nome, email, senhaHash],
      );
    } catch (erro) {
      // 23505 = violação de unicidade (índice em lower(email)). Cobre também dois cadastros simultâneos.
      if ((erro as { code?: string }).code === '23505') {
        throw new ErroAplicacao(409, 'EMAIL_JA_CADASTRADO', 'Já existe conta com esse e-mail.');
      }
      throw erro;
    }

    return this.abrirSessao({ id, nome, email, avatar_url: null }, carrinhoVisitante);
  }

  /** Sessão do token. Token ausente: visitante (null). Token vencido, revogado ou adulterado: expirada. */
  async consultar(token: string | null): Promise<Sessao | null> {
    if (!token) return null;
    return this.validar(token);
  }

  /**
   * Para rotas que funcionam com ou sem conta (catálogo, carrinho): token inválido ou
   * vencido conta como visitante, como no mock. Rota que exige conta usa ExigeSessao.
   */
  async usuarioOpcional(token: string | null): Promise<Usuario | null> {
    if (!token) return null;
    try {
      return (await this.validar(token)).usuario;
    } catch {
      return null;
    }
  }

  async validar(token: string): Promise<Sessao> {
    const { usuario, expiraEm } = await this.identificar(token);
    return { usuario, expiraEm: expiraEm.toISOString() };
  }

  /** Confere assinatura (só HS256) e se a sessão segue ativa no banco. */
  async identificar(token: string): Promise<SessaoValidada> {
    let jti: string;
    try {
      ({ jti } = await this.jwt.verifyAsync<{ jti: string }>(token));
    } catch {
      throw sessaoExpirada();
    }

    const [linha] = await this.banco.query<Array<LinhaConta & { expira_em: Date }>>(
      `SELECT c.id, c.nome, c.email, c.avatar_url, s.expira_em
       FROM sessoes s JOIN contas c ON c.id = s.conta_id
       WHERE s.id = $1 AND s.revogada_em IS NULL AND s.expira_em > now()`,
      [jti],
    );
    if (!linha) throw sessaoExpirada();

    return { jti, usuario: paraUsuario(linha), expiraEm: new Date(linha.expira_em) };
  }

  /** Quem guarda algo atrelado à sessão (o socket de tempo real) é avisado quando ela é encerrada. */
  observarEncerramento(ouvinte: (jti: string) => void): () => void {
    this.aoEncerrarSessao.add(ouvinte);
    return () => this.aoEncerrarSessao.delete(ouvinte);
  }

  /** Sair é idempotente: token inválido ou já revogado também responde 204. */
  async sair(token: string | null): Promise<void> {
    if (!token) return;
    const dados = this.jwt.decode<{ jti?: string } | null>(token);
    if (!dados?.jti) return;
    await this.banco.query(
      `UPDATE sessoes SET revogada_em = now() WHERE id = $1 AND revogada_em IS NULL`,
      [dados.jti],
    );
    for (const ouvinte of this.aoEncerrarSessao) ouvinte(dados.jti);
  }

  private async abrirSessao(conta: LinhaConta, carrinhoVisitante: string | null): Promise<SessaoComToken> {
    const jti = randomUUID();
    const expiraEm = new Date(Date.now() + this.duracaoSegundos * 1000);
    await this.banco.transaction(async (m) => {
      await m.query(
        `INSERT INTO sessoes (id, conta_id, expira_em) VALUES ($1, $2, $3)`,
        [jti, conta.id, expiraEm],
      );
      await mesclarCarrinhoVisitante(m, carrinhoVisitante, conta.id);
    });
    const token = await this.jwt.signAsync(
      { sub: conta.id },
      { jwtid: jti, expiresIn: this.duracaoSegundos },
    );
    return { token, usuario: paraUsuario(conta), expiraEm: expiraEm.toISOString() };
  }
}

export function paraUsuario(l: LinhaConta): Usuario {
  return { id: l.id, nome: l.nome, email: l.email, avatarUrl: l.avatar_url };
}
