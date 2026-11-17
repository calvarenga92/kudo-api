import type { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import type { ServerOptions } from 'socket.io';

/** Socket.IO na mesma porta da API, com as mesmas origens liberadas no CORS do HTTP. */
export class AdaptadorSocket extends IoAdapter {
  constructor(app: INestApplicationContext, private readonly origens: string[]) {
    super(app);
  }

  override createIOServer(porta: number, opcoes?: Partial<ServerOptions>) {
    return super.createIOServer(porta, {
      path: '/socket.io',
      ...opcoes,
      cors: { origin: this.origens },
      // O front conecta direto por websocket; long-polling fica de reserva para proxies.
      transports: ['websocket', 'polling'],
    } as ServerOptions);
  }
}
