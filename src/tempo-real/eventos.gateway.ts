import { Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import {
  ConnectedSocket, MessageBody, type OnGatewayDisconnect, SubscribeMessage, WebSocketGateway, WebSocketServer,
} from '@nestjs/websockets';
import { randomUUID } from 'node:crypto';
import type { Server, Socket } from 'socket.io';
import type { PedidoAtualizado, NftAtualizado, EventosServidor, Identificacao } from './eventos.js';
import { salaDaSessao, salaDoUsuario } from './eventos.js';
import { SessaoService } from '../sessao/sessao.service.js';

interface DadosSocket {
  usuarioId?: string;
  jti?: string;
  expira?: NodeJS.Timeout;
  /** Cada identify ganha um número; só o mais recente pode concluir a entrada na sala. */
  tentativa?: number;
}

type SocketKudo = Socket<Record<string, never>, EventosServidor, Record<string, never>, DadosSocket>;

/** Maior atraso que o setTimeout aceita (~24,8 dias); sessão mais longa que isso é reavaliada. */
const ATRASO_MAXIMO = 2 ** 31 - 1;

/**
 * Eventos em tempo real. O catálogo é público (todo socket recebe `nft.updated`);
 * `order.updated` vai só para a sala da conta dona do pedido.
 *
 * A sala da conta só é liberada com token válido, e o socket sai dela quando a sessão
 * é encerrada (logout) ou expira, sem depender do front avisar.
 */
@WebSocketGateway()
export class EventosGateway implements OnGatewayDisconnect, OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('TempoReal');
  private pararDeObservar?: () => void;

  @WebSocketServer()
  private readonly servidor!: Server<Record<string, never>, EventosServidor, Record<string, never>, DadosSocket>;

  constructor(private readonly sessao: SessaoService) {}

  onModuleInit() {
    this.pararDeObservar = this.sessao.observarEncerramento((jti) => {
      void this.servidor?.in(salaDaSessao(jti)).fetchSockets().then((sockets) => {
        for (const s of sockets) this.virarVisitante(s as unknown as SocketKudo);
      });
    });
  }

  onModuleDestroy() {
    this.pararDeObservar?.();
  }

  handleDisconnect(socket: SocketKudo) {
    clearTimeout(socket.data.expira);
  }

  /** Responde `true` quando o socket entrou na sala da conta; `false` fica como visitante. */
  @SubscribeMessage('session.identify')
  async identificar(@ConnectedSocket() socket: SocketKudo, @MessageBody() dados: Identificacao | undefined) {
    this.virarVisitante(socket);
    const tentativa = (socket.data.tentativa = (socket.data.tentativa ?? 0) + 1);
    const token = typeof dados?.token === 'string' ? dados.token : '';
    if (!token || !dados?.usuarioId) return false;

    let sessao;
    try {
      sessao = await this.sessao.identificar(token);
    } catch {
      return false;
    }
    // Token de uma conta pedindo a sala de outra: não entra em nenhuma.
    if (sessao.usuario.id !== dados.usuarioId) return false;
    // Outro identify chegou durante a consulta (troca rápida de conta) ou o socket caiu: vale o mais novo.
    if (socket.data.tentativa !== tentativa || socket.disconnected) return false;

    socket.data.usuarioId = sessao.usuario.id;
    socket.data.jti = sessao.jti;
    await socket.join([salaDoUsuario(sessao.usuario.id), salaDaSessao(sessao.jti)]);
    const restante = Math.min(sessao.expiraEm.getTime() - Date.now(), ATRASO_MAXIMO);
    socket.data.expira = setTimeout(() => this.virarVisitante(socket), Math.max(restante, 0));
    return true;
  }

  publicarNft(evento: Omit<NftAtualizado, 'eventoId' | 'emitidoEm'>) {
    this.servidor?.emit('nft.updated', { ...evento, eventoId: randomUUID(), emitidoEm: new Date().toISOString() });
  }

  publicarPedido(contaId: string, evento: Omit<PedidoAtualizado, 'eventoId' | 'emitidoEm'>) {
    this.servidor?.to(salaDoUsuario(contaId))
      .emit('order.updated', { ...evento, eventoId: randomUUID(), emitidoEm: new Date().toISOString() });
  }

  private virarVisitante(socket: SocketKudo) {
    clearTimeout(socket.data.expira);
    const { usuarioId, jti } = socket.data;
    if (usuarioId) void socket.leave(salaDoUsuario(usuarioId));
    if (jti) void socket.leave(salaDaSessao(jti));
    socket.data = { tentativa: socket.data.tentativa };
    if (usuarioId) this.log.debug(`socket ${socket.id} voltou a visitante`);
  }
}
