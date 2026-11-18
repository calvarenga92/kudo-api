import type { ConsultaNfts, OrdenacaoNft } from '@calvarenga92/kudo-regras';
import { dadosInvalidos } from '../comum/erro-aplicacao.js';

const ORDENACOES: readonly OrdenacaoNft[] = ['recentes', 'preco-asc', 'preco-desc', 'populares'];
/** ETH com até 18 casas, sem sinal nem notação científica: o que paraUnidades aceita. */
const VALOR_ETH = /^\d{1,20}(\.\d{1,18})?$/;
export const POR_PAGINA_MAXIMO = 60;

type Bruto = Record<string, unknown>;

/**
 * Lê a query string de GET /nfts (formato de `paraParametros` no front).
 * Valor inválido vira 422 com o campo apontado, não lista vazia silenciosa.
 */
export function lerConsulta(q: Bruto): ConsultaNfts {
  const campos: Record<string, string> = {};
  const consulta: ConsultaNfts = {
    pagina: inteiro(q.pagina, 1, 'pagina', 1, Number.MAX_SAFE_INTEGER, campos),
    porPagina: inteiro(q.porPagina, 8, 'porPagina', 1, POR_PAGINA_MAXIMO, campos),
  };

  const busca = texto(q.busca)?.trim();
  if (busca) {
    if (busca.length > 100) campos.busca = 'Use no máximo 100 caracteres.';
    else consulta.busca = busca;
  }

  const colecoes = lista(q.colecao);
  if (colecoes.length > 0) consulta.colecoes = colecoes;

  for (const chave of ['precoMin', 'precoMax'] as const) {
    const valor = texto(q[chave]);
    if (valor === undefined || valor === '') continue;
    if (VALOR_ETH.test(valor)) consulta[chave] = valor;
    else campos[chave] = 'Informe um valor em ETH, como 1.5.';
  }

  if (texto(q.somenteDisponiveis) === 'true') consulta.somenteDisponiveis = true;

  const ordenacao = texto(q.ordenacao);
  if (ordenacao) {
    if ((ORDENACOES as string[]).includes(ordenacao)) consulta.ordenacao = ordenacao as OrdenacaoNft;
    else campos.ordenacao = `Use uma de: ${ORDENACOES.join(', ')}.`;
  }

  if (Object.keys(campos).length > 0) throw dadosInvalidos(campos);
  return consulta;
}

function texto(v: unknown): string | undefined {
  if (Array.isArray(v)) return texto(v.at(-1));
  return typeof v === 'string' ? v : undefined;
}

function lista(v: unknown): string[] {
  const itens = Array.isArray(v) ? v : [v];
  return itens.filter((i): i is string => typeof i === 'string' && i.trim() !== '').map((i) => i.trim());
}

function inteiro(
  v: unknown, padrao: number, campo: string, min: number, max: number, campos: Record<string, string>,
): number {
  const t = texto(v);
  if (t === undefined || t === '') return padrao;
  const n = Number(t);
  if (!Number.isInteger(n) || n < min || n > max) {
    campos[campo] = `Use um número inteiro entre ${min} e ${max === Number.MAX_SAFE_INTEGER ? 'o total de páginas' : max}.`;
    return padrao;
  }
  return n;
}
