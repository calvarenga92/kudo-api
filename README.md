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
npm run test:e2e:postgres  # o mesmo e2e no Postgres 17 do compose, com concorrência real
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
tem conta.

Tentativas de login têm freio, em duas camadas: por IP, no máximo 30 tentativas de login
ou cadastro a cada 15 minutos; por e-mail + IP, 5 senhas erradas bloqueiam esse e-mail
naquele IP até a janela acabar (login certo zera a contagem). O e-mail entra junto com o
IP de propósito: assim ninguém tranca a conta de outra pessoa errando a senha dela. Passou
do limite, a resposta é `429 MUITAS_TENTATIVAS` com `Retry-After`, e o bloqueio vem antes
do hash da senha (que custa CPU). Atrás do balanceador, `CONFIAR_PROXY=1` faz a API ler
o IP do `X-Forwarded-For`; sem isso o cabeçalho é ignorado e não serve para burlar o limite.
O contador fica em memória: com mais de uma instância, vai para o Redis.

Contas de demonstração: `claudio@kudo.test` e `marina@kudo.test`, senha `senha12345`.

## Carrinho de visitante

Quem ainda não entrou também monta carrinho. A API identifica esse carrinho por um id
aleatório de 24 bytes, devolvido no cabeçalho `X-Carrinho-Visitante` (exposto via CORS);
o front guarda e reenvia. Cookie não serve aqui: front e API ficam em domínios diferentes.
Ao entrar ou se cadastrar, os itens passam para o carrinho da conta (mesma edição soma) e
o id de visitante deixa de valer. Toda alteração trava o carrinho na transação
(`SELECT ... FOR UPDATE`): cliques simultâneos não furam o limite por pedido.

## Checkout

`POST /api/pedidos` exige o cabeçalho `Idempotency-Key`. Mesma chave e mesmo corpo devolvem
o pedido original (200) em vez de cobrar de novo; mesma chave com outro corpo é recusada
(409). Envios simultâneos com a mesma chave esperam o primeiro terminar e recebem o mesmo
pedido. A pessoa confirma a versão da cotação que viu: se preço, quantidade ou cupom mudaram,
a API recusa (`COTACAO_DESATUALIZADA`) em vez de cobrar outro valor. As edições são travadas
em ordem fixa e o estoque é reconferido: na disputa pela última unidade, uma conta compra e a
outra é avisada. O pedido guarda um retrato imutável dos itens e valores.

Cada conta só enxerga os próprios pedidos (pedido alheio responde 404, como inexistente).
O pagamento passa por um gateway simulado, trocável por um real: ele aprova tudo, exceto
carteiras cujo endereço termina em `dead`, para o caminho de recusa poder ser testado.

## Andamento

| fase | escopo | estado |
|---|---|---|
| 0 | base: Nest, Postgres, Docker, formato de erro, CORS, saúde | feito |
| 1 | catálogo: `/nfts`, `/nfts/:id`, `/nfts/faixa`, `/colecoes` | feito |
| 2 | sessão e conta: `/sessao`, `/contas`, `/perfil` (JWT revogável, senha com scrypt) | feito |
| 3 | favoritos, carteiras, carrinho e cupom (carrinho de visitante e mescla no login) | feito |
| 4 | pedidos com checkout idempotente, cotação conferida e estoque travado | feito |
| 5 | tempo real (Socket.IO): estoque ao vivo e aviso de pedido por conta | feito |
| 6 | deploy na AWS | — |

## Variáveis de ambiente

Veja [`.env.example`](.env.example).
