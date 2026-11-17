import { BadRequestException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { FiltroErros } from './filtro-erros.js';
import { dadosInvalidos, ErroAplicacao } from './erro-aplicacao.js';

describe('FiltroErros', () => {
  const filtro = new FiltroErros();

  it('mantém código, status e campos do erro de aplicação', () => {
    const { status, corpo } = filtro.traduzir(dadosInvalidos({ email: 'Formato inválido.' }));
    expect(status).toBe(422);
    expect(corpo).toEqual({
      codigo: 'DADOS_INVALIDOS',
      mensagem: 'Confira os campos destacados.',
      campos: { email: 'Formato inválido.' },
    });
  });

  it('não inclui "campos" quando o erro não tem campos', () => {
    const { corpo } = filtro.traduzir(new ErroAplicacao(409, 'CUPOM_EXPIRADO', 'Cupom expirado.'));
    expect(corpo).toEqual({ codigo: 'CUPOM_EXPIRADO', mensagem: 'Cupom expirado.' });
  });

  it('traduz exceções do Nest para códigos do contrato', () => {
    expect(filtro.traduzir(new NotFoundException()).corpo.codigo).toBe('NAO_ENCONTRADO');
    expect(filtro.traduzir(new BadRequestException()).corpo.codigo).toBe('DADOS_INVALIDOS');
    expect(filtro.traduzir(new ServiceUnavailableException()).corpo.codigo).toBe('FALHA_TRANSITORIA');
  });

  it('erro inesperado vira 500 sem vazar a mensagem interna', () => {
    const { status, corpo } = filtro.traduzir(new Error('senha do banco: hunter2'));
    expect(status).toBe(500);
    expect(corpo.codigo).toBe('ERRO_DESCONHECIDO');
    expect(corpo.mensagem).not.toContain('hunter2');
  });
});
