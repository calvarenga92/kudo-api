import { ErroAplicacao } from '../comum/erro-aplicacao.js';
import { lerConsulta } from './consulta.js';

function camposDoErro(fn: () => unknown): Record<string, string> | undefined {
  try {
    fn();
  } catch (e) {
    if (e instanceof ErroAplicacao) return e.campos;
    throw e;
  }
  throw new Error('esperava erro');
}

describe('lerConsulta', () => {
  it('aplica os padrões do mock quando nada é informado', () => {
    expect(lerConsulta({})).toEqual({ pagina: 1, porPagina: 8 });
  });

  it('lê todos os filtros no formato de paraParametros do front', () => {
    expect(
      lerConsulta({
        busca: '  golden ',
        colecao: ['musica', 'jogos'],
        precoMin: '0.5',
        precoMax: '2',
        somenteDisponiveis: 'true',
        ordenacao: 'preco-asc',
        pagina: '2',
        porPagina: '9',
      }),
    ).toEqual({
      busca: 'golden',
      colecoes: ['musica', 'jogos'],
      precoMin: '0.5',
      precoMax: '2',
      somenteDisponiveis: true,
      ordenacao: 'preco-asc',
      pagina: 2,
      porPagina: 9,
    });
  });

  it('uma coleção só chega como string, não como lista', () => {
    expect(lerConsulta({ colecao: 'musica' }).colecoes).toEqual(['musica']);
  });

  it('recusa preço que não é ETH decimal, apontando o campo', () => {
    const campos = camposDoErro(() => lerConsulta({ precoMin: '1e3', precoMax: '-1' }));
    expect(Object.keys(campos ?? {})).toEqual(['precoMin', 'precoMax']);
  });

  it('recusa ordenação desconhecida e paginação fora do limite', () => {
    const campos = camposDoErro(() => lerConsulta({ ordenacao: 'aleatoria', pagina: '0', porPagina: '500' }));
    expect(Object.keys(campos ?? {}).sort()).toEqual(['ordenacao', 'pagina', 'porPagina']);
  });

  it('aceita até 18 casas decimais, a menor unidade do ETH', () => {
    expect(lerConsulta({ precoMin: '0.000000000000000001' }).precoMin).toBe('0.000000000000000001');
    expect(() => lerConsulta({ precoMin: '0.0000000000000000001' })).toThrow(ErroAplicacao);
  });
});
