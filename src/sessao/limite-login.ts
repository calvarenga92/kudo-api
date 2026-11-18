import { Injectable } from '@nestjs/common';
import { lerAmbiente } from '../config/ambiente.js';
import { muitasTentativas } from '../comum/erro-aplicacao.js';
import { LimiteTentativas } from './limite-tentativas.js';

/**
 * Freio contra adivinhação de senha. Duas camadas:
 * - por IP, toda tentativa de login ou cadastro conta (segura o robô que testa muitos e-mails);
 * - por e-mail + IP, só a senha errada conta (segura quem insiste numa conta só).
 *   Login certo zera essa contagem. A chave inclui o IP para que alguém de fora
 *   não consiga trancar a conta de outra pessoa errando a senha dela de propósito.
 */
@Injectable()
export class LimiteLogin {
  private readonly porIp: LimiteTentativas;
  private readonly falhas: LimiteTentativas;

  constructor() {
    const ambiente = lerAmbiente();
    const janelaMs = ambiente.loginJanelaSegundos * 1000;
    this.porIp = new LimiteTentativas(ambiente.loginMaximoPorIp, janelaMs);
    this.falhas = new LimiteTentativas(ambiente.loginMaximoFalhas, janelaMs);
  }

  /** Antes de qualquer trabalho (inclusive o hash da senha, que custa CPU). */
  conferir(ip: string, email?: string): void {
    const esperaIp = this.porIp.registrarEConferir(ip);
    if (esperaIp > 0) throw muitasTentativas(esperaIp);
    if (email === undefined) return;
    const esperaFalhas = this.falhas.bloqueadoPor(chaveFalha(ip, email));
    if (esperaFalhas > 0) throw muitasTentativas(esperaFalhas);
  }

  registrarFalha(ip: string, email: string): void {
    this.falhas.registrar(chaveFalha(ip, email));
  }

  registrarSucesso(ip: string, email: string): void {
    this.falhas.esquecer(chaveFalha(ip, email));
  }
}

const chaveFalha = (ip: string, email: string) => `${ip}|${email.trim().toLowerCase()}`;
