import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { DataSource, type EntityManager } from 'typeorm';
import { paraTexto, paraUnidades, type Pedido, type StatusPedido } from '@calvarenga92/kurio-regras';
import { CarrinhoService } from '../carrinho/carrinho.service.js';
import { carrinhoDaConta } from '../carrinho/mescla.js';
import { texto } from '../comum/corpo.js';
import { dadosInvalidos, ErroAplicacao, naoEncontrado } from '../comum/erro-aplicacao.js';
import { EventosGateway } from '../tempo-real/eventos.gateway.js';
import { GatewayPagamento } from './pagamento.js';

export interface Desfecho {
  pedido: Pedido;
  /** true quando a mesma chave e o mesmo corpo já tinham criado este pedido. */
  repetido: boolean;
}

const eth = (v: string) => paraTexto(paraUnidades(v));

@Injectable()
export class PedidosService {
  private readonly log = new Logger(PedidosService.name);

  constructor(
    private readonly banco: DataSource,
    private readonly carrinho: CarrinhoService,
    private readonly gateway: GatewayPagamento,
    private readonly eventos: EventosGateway,
  ) {}

  /**
   * Checkout idempotente. Tudo numa transação com o carrinho da conta travado, o que
   * serializa os checkouts da mesma conta: um reenvio que chega enquanto o primeiro ainda
   * processa espera, encontra a chave registrada e recebe o mesmo pedido.
   *
   * Falhas (cotação desatualizada, estoque, carrinho vazio) não registram a chave: a pessoa
   * corrige e tenta de novo com a mesma chave, como na guarda compartilhada do front.
   */
  async criar(contaId: string, chave: string | undefined, corpo: Record<string, unknown>): Promise<Desfecho> {
    const chaveLimpa = chave?.trim() ?? '';
    if (!chaveLimpa || chaveLimpa.length > 128) {
      throw new ErroAplicacao(422, 'DADOS_INVALIDOS', 'Idempotency-Key é obrigatória.');
    }
    const versaoCotacao = texto(corpo.versaoCotacao);
    const carteiraId = texto(corpo.carteiraId) || null;
    if (!versaoCotacao) throw dadosInvalidos({ versaoCotacao: 'Informe a versão da cotação.' });

    const impressao = createHash('sha256').update(JSON.stringify({ versaoCotacao, carteiraId })).digest('hex');

    const desfecho = await this.banco.transaction(async (m): Promise<Desfecho> => {
      const carrinhoId = await carrinhoDaConta(m, contaId);

      const [registro] = await m.query<Array<{ impressao: string; pedido_id: string }>>(
        `SELECT impressao, pedido_id FROM idempotencia_pedidos WHERE conta_id = $1 AND chave = $2`,
        [contaId, chaveLimpa],
      );
      if (registro) {
        if (registro.impressao !== impressao) {
          throw new ErroAplicacao(409, 'CHAVE_IDEMPOTENCIA_CONFLITANTE', 'Esta chave foi usada com outro conteúdo.');
        }
        return { pedido: await this.carregar(m, contaId, registro.pedido_id), repetido: true };
      }

      const cotacao = await this.carrinho.cotacao(m, carrinhoId);
      if (cotacao.itens.length === 0) {
        throw new ErroAplicacao(422, 'DADOS_INVALIDOS', 'O carrinho está vazio.');
      }
      // A pessoa confirma o que viu. Se preço, quantidade ou cupom mudaram, recusa em vez de cobrar outro valor.
      if (versaoCotacao !== cotacao.versao) {
        throw new ErroAplicacao(
          409, 'COTACAO_DESATUALIZADA', 'Os valores do carrinho mudaram. Confira o resumo antes de confirmar.',
        );
      }

      const carteira = await this.carteira(m, contaId, carteiraId);

      // Trava as edições em ordem fixa (evita deadlock entre compras simultâneas) e reconfere o estoque.
      const edicoes = await m.query<Array<{ id: string; disponivel: number; limite_por_pedido: number }>>(
        `SELECT id, disponivel, limite_por_pedido FROM edicoes WHERE id = ANY($1::text[]) ORDER BY id FOR UPDATE`,
        [cotacao.itens.map((i) => i.edicaoId)],
      );
      for (const item of cotacao.itens) {
        const edicao = edicoes.find((e) => e.id === item.edicaoId)!;
        if (item.quantidade === 0 || edicao.disponivel < item.quantidade) {
          throw new ErroAplicacao(409, 'DISPONIBILIDADE_INSUFICIENTE', `"${item.titulo}" não tem a quantidade pedida.`);
        }
        if (item.quantidade > edicao.limite_por_pedido) {
          throw dadosInvalidos({ quantidade: `"${item.titulo}": limite de ${edicao.limite_por_pedido} unidades por pedido.` });
        }
      }

      const pedidoId = `ped-${randomBytes(6).toString('hex')}`;
      // Gateway simulado e instantâneo. Com um gateway real, o pedido nasceria PENDENTE e a
      // confirmação viria depois (webhook), fora desta transação.
      const pagamento = await this.gateway.cobrar({
        pedidoId, totalEth: cotacao.totalEth, endereco: carteira.endereco, rede: carteira.rede,
      });
      const status: StatusPedido = pagamento.aprovado ? 'CONFIRMADO' : 'RECUSADO';

      await m.query(
        `INSERT INTO pedidos (id, conta_id, status, subtotal_eth, desconto_eth, taxa_rede_eth, total_eth,
           cupom_codigo, cupom_descricao, carteira_apelido, carteira_endereco, carteira_rede,
           referencia_transacao, motivo_recusa)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [
          pedidoId, contaId, status, cotacao.subtotalEth, cotacao.descontoEth, cotacao.taxaRedeEth, cotacao.totalEth,
          cotacao.cupom?.codigo ?? null, cotacao.cupom?.descricaoDesconto ?? null,
          carteira.apelido, carteira.endereco, carteira.rede,
          pagamento.aprovado ? pagamento.referenciaTransacao : null,
          pagamento.aprovado ? null : pagamento.motivo,
        ],
      );
      for (const [ordem, i] of cotacao.itens.entries()) {
        await m.query(
          `INSERT INTO itens_pedido (pedido_id, ordem, nft_id, edicao_id, titulo, imagem_url, rotulo_edicao,
             quantidade, preco_unitario_eth, subtotal_eth)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [pedidoId, ordem, i.nftId, i.edicaoId, i.titulo, i.imagemUrl, i.rotuloEdicao,
            i.quantidade, i.precoUnitarioEth, i.subtotalEth],
        );
      }

      // Recusado não baixa estoque nem esvazia o carrinho: a pessoa troca de carteira e tenta de novo.
      if (pagamento.aprovado) {
        for (const i of cotacao.itens) {
          await m.query(`UPDATE edicoes SET disponivel = disponivel - $2 WHERE id = $1`, [i.edicaoId, i.quantidade]);
        }
        // Versão da peça sobe: quem estiver vendo o catálogo descarta o estoque antigo (fase de tempo real).
        await m.query(`UPDATE nfts SET versao = versao + 1 WHERE id = ANY($1::text[])`, [
          [...new Set(cotacao.itens.map((i) => i.nftId))],
        ]);
        await m.query(`DELETE FROM itens_carrinho WHERE carrinho_id = $1`, [carrinhoId]);
        await m.query(`UPDATE carrinhos SET cupom_codigo = NULL, atualizado_em = now() WHERE id = $1`, [carrinhoId]);
      }

      await m.query(
        `INSERT INTO idempotencia_pedidos (conta_id, chave, impressao, pedido_id) VALUES ($1, $2, $3, $4)`,
        [contaId, chaveLimpa, impressao, pedidoId],
      );

      return { pedido: await this.carregar(m, contaId, pedidoId), repetido: false };
    });

    // Só depois do commit: avisar antes seria anunciar um estoque que um rollback ainda pode desfazer.
    if (!desfecho.repetido) await this.anunciar(contaId, desfecho.pedido);
    return desfecho;
  }

  /**
   * Lê o estado já gravado em vez de reaproveitar o que a transação calculou. Se duas compras
   * terminam juntas e os avisos saem trocados, a versão da peça deixa o cliente descartar o antigo.
   */
  private async anunciar(contaId: string, pedido: Pedido): Promise<void> {
    try {
      if (pedido.status === 'CONFIRMADO') {
        const ids = [...new Set(pedido.itens.map((i) => i.nftId))];
        const linhas = await this.banco.query<Array<{ id: string; versao: number; edicoes: Array<{ id: string; preco_eth: string; disponivel: number }> }>>(
          `SELECT n.id, n.versao,
             json_agg(json_build_object('id', e.id, 'preco_eth', e.preco_eth::text, 'disponivel', e.disponivel) ORDER BY e.id) AS edicoes
           FROM nfts n JOIN edicoes e ON e.nft_id = n.id
           WHERE n.id = ANY($1::text[]) GROUP BY n.id, n.versao`,
          [ids],
        );
        for (const l of linhas) {
          this.eventos.publicarNft({
            nftId: l.id,
            versao: l.versao,
            edicoes: l.edicoes.map((e) => ({ id: e.id, precoEth: eth(e.preco_eth), disponivel: e.disponivel })),
          });
        }
      }
      this.eventos.publicarPedido(contaId, {
        pedidoId: pedido.id,
        versao: pedido.versao,
        status: pedido.status,
        referenciaTransacao: pedido.referenciaTransacao,
        motivoRecusa: pedido.motivoRecusa,
      });
    } catch (erro) {
      // O pedido já está gravado; falha no aviso não pode virar erro para quem comprou.
      this.log.warn(`aviso em tempo real falhou para ${pedido.id}: ${(erro as Error).message}`);
    }
  }

  /** Só os pedidos da própria conta, mais recente primeiro. */
  async listar(contaId: string): Promise<Pedido[]> {
    const ids = await this.banco.query<Array<{ id: string }>>(
      `SELECT id FROM pedidos WHERE conta_id = $1 ORDER BY criado_em DESC, id`, [contaId],
    );
    return Promise.all(ids.map(({ id }) => this.carregar(this.banco.manager, contaId, id)));
  }

  /** Pedido de outra conta responde 404, igual a inexistente: não confirma que o id existe. */
  detalhar(contaId: string, pedidoId: string): Promise<Pedido> {
    return this.carregar(this.banco.manager, contaId, pedidoId);
  }

  private async carteira(m: EntityManager, contaId: string, carteiraId: string | null) {
    const [carteira] = await m.query<Array<{ apelido: string; endereco: string; rede: string }>>(
      carteiraId
        ? `SELECT apelido, endereco, rede FROM carteiras WHERE conta_id = $1 AND id = $2`
        : `SELECT apelido, endereco, rede FROM carteiras WHERE conta_id = $1 AND principal`,
      carteiraId ? [contaId, carteiraId] : [contaId],
    );
    if (!carteira) {
      throw carteiraId
        ? dadosInvalidos({ carteiraId: 'Carteira não encontrada.' })
        : new ErroAplicacao(422, 'DADOS_INVALIDOS', 'Cadastre uma carteira para concluir.');
    }
    return carteira;
  }

  private async carregar(m: EntityManager, contaId: string, pedidoId: string): Promise<Pedido> {
    const [p] = await m.query(`SELECT * FROM pedidos WHERE id = $1 AND conta_id = $2`, [pedidoId, contaId]);
    if (!p) throw naoEncontrado('Pedido');
    const itens = await m.query(`SELECT * FROM itens_pedido WHERE pedido_id = $1 ORDER BY ordem`, [pedidoId]);

    return {
      id: p.id,
      status: p.status,
      itens: itens.map((i: Record<string, string & number>) => ({
        nftId: i.nft_id,
        edicaoId: i.edicao_id,
        titulo: i.titulo,
        imagemUrl: i.imagem_url,
        rotuloEdicao: i.rotulo_edicao,
        quantidade: i.quantidade,
        precoUnitarioEth: eth(i.preco_unitario_eth),
        subtotalEth: eth(i.subtotal_eth),
      })),
      subtotalEth: eth(p.subtotal_eth),
      descontoEth: eth(p.desconto_eth),
      taxaRedeEth: eth(p.taxa_rede_eth),
      totalEth: eth(p.total_eth),
      cupom: p.cupom_codigo ? { codigo: p.cupom_codigo, descricaoDesconto: p.cupom_descricao } : null,
      carteira: { apelido: p.carteira_apelido, endereco: p.carteira_endereco, rede: p.carteira_rede },
      referenciaTransacao: p.referencia_transacao,
      motivoRecusa: p.motivo_recusa,
      criadoEm: new Date(p.criado_em).toISOString(),
      atualizadoEm: new Date(p.atualizado_em).toISOString(),
      versao: p.versao,
    };
  }
}
