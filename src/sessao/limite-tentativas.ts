/**
 * Contador por chave numa janela fixa: a janela começa na primeira tentativa
 * e dura `janelaMs`. Passou do máximo, a chave fica bloqueada até a janela acabar.
 *
 * Fica em memória, por instância. Com uma instância só (o plano do deploy) é o
 * suficiente; com várias, o contador vai para um lugar compartilhado (Redis ou
 * uma tabela), como o adaptador do Socket.IO.
 */
export class LimiteTentativas {
  private readonly janelas = new Map<string, { contagem: number; fimEm: number }>();
  private chamadasDesdeLimpeza = 0;

  constructor(
    private readonly maximo: number,
    private readonly janelaMs: number,
    private readonly agora: () => number = Date.now,
  ) {}

  /** Milissegundos até liberar, ou 0 se a chave ainda pode tentar. Não conta nada. */
  bloqueadoPor(chave: string): number {
    const janela = this.janelaVigente(chave);
    return janela && janela.contagem >= this.maximo ? janela.fimEm - this.agora() : 0;
  }

  /** Conta uma tentativa. */
  registrar(chave: string): void {
    this.limparDeTempoEmTempo();
    const janela = this.janelaVigente(chave);
    if (janela) janela.contagem += 1;
    else this.janelas.set(chave, { contagem: 1, fimEm: this.agora() + this.janelaMs });
  }

  /** Conta e já diz se passou do limite: o uso normal para "toda requisição conta". */
  registrarEConferir(chave: string): number {
    const bloqueio = this.bloqueadoPor(chave);
    if (bloqueio > 0) return bloqueio;
    this.registrar(chave);
    return 0;
  }

  esquecer(chave: string): void {
    this.janelas.delete(chave);
  }

  get tamanho(): number {
    return this.janelas.size;
  }

  private janelaVigente(chave: string) {
    const janela = this.janelas.get(chave);
    if (!janela) return undefined;
    if (janela.fimEm <= this.agora()) {
      this.janelas.delete(chave);
      return undefined;
    }
    return janela;
  }

  /** Sem isso, cada IP ou e-mail que passasse uma vez ficaria no mapa para sempre. */
  private limparDeTempoEmTempo(): void {
    if (++this.chamadasDesdeLimpeza < 1000) return;
    this.chamadasDesdeLimpeza = 0;
    const agora = this.agora();
    for (const [chave, janela] of this.janelas) {
      if (janela.fimEm <= agora) this.janelas.delete(chave);
    }
  }
}
