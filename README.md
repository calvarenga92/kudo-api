# Kudo API

Back-end do [Kudo](https://github.com/calvarenga92/kudo), marketplace de arte digital.
NestJS + PostgreSQL, empacotado com Docker.

O front do Kudo nasceu com um mock completo (MSW) que já define as rotas, os formatos
e os erros. Esta API implementa **esse mesmo contrato**: o front troca o mock por ela
mudando uma variável (`VITE_API_URL`), sem alterar código. O critério de pronto de cada
módulo é a suíte Playwright do front passar contra a API real.

Tipos e regras de negócio (dinheiro em inteiros de 18 casas, cotação, idempotência) vêm do
pacote [`@calvarenga92/kurio-regras`](https://www.npmjs.com/package/@calvarenga92/kurio-regras),
o mesmo usado pelo front web e pelo app mobile. Um contrato, três clientes.

## Rodando

Requer Node 24.

```bash
npm install
npm run dev            # sobe um Postgres local (sem Docker) e a API em http://localhost:3000/api
```

Com Docker:

```bash
docker compose up --build    # Postgres 17 + API
```

Conferir: `GET http://localhost:3000/api/saude` → `{"status":"ok","banco":"ok"}`.

## Testes

```bash
npm test               # unitários
npm run test:e2e       # API inteira contra um Postgres em memória (PGlite), sem Docker
npm run verificar      # typecheck + lint + unitários + e2e + build
```

## Contrato de erro

Todo erro sai como `{ codigo, mensagem, campos? }`. O front decide pelo `codigo`
(ex.: `SESSAO_EXPIRADA` limpa o token); a mensagem é só para leitura. Erro inesperado
vira `500 ERRO_DESCONHECIDO`, sem vazar detalhe interno.

## Sessão

Login devolve um JWT (HS256, 1 hora) que carrega o id da sessão; a sessão também fica
registrada no banco. Assim **sair revoga o token na hora**, o que um JWT puro não faz.
Senhas com scrypt (parâmetros da OWASP), comparação em tempo constante, e o mesmo
custo e a mesma resposta para e-mail inexistente e senha errada: a API não revela quem
tem conta. Contas de demonstração: `claudio@kudo.test` e `marina@kudo.test`, senha `senha12345`.

## Andamento

| fase | escopo | estado |
|---|---|---|
| 0 | base: Nest, Postgres, Docker, formato de erro, CORS, saúde | feito |
| 1 | catálogo: `/nfts`, `/nfts/:id`, `/nfts/faixa`, `/colecoes` | feito |
| 2 | sessão e conta: `/sessao`, `/contas`, `/perfil` (JWT revogável, senha com scrypt) | feito |
| 3 | favoritos, carteiras, carrinho e cupom | — |
| 4 | pedidos com checkout idempotente | — |
| 5 | tempo real (Socket.IO) | — |
| 6 | deploy na AWS | — |

## Variáveis de ambiente

Veja [`.env.example`](.env.example).
