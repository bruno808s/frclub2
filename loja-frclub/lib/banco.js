// Banco da loja (SQLite que já vem no Node): peças, configuração, pedidos, devoluções e depoimentos.
import { DatabaseSync } from 'node:sqlite';

export const CONFIG_PADRAO = {
  nomeLoja: 'FR CLUB',
  barraTopo: 'Peças importadas, escolhidas uma a uma',
  linkTopoTexto: 'Fale conosco',
  linkTopoUrl: '', // vazio = abre o WhatsApp
  fraseHero: '', // frase em letra de mão embaixo da logo (vazio = não mostra)
  mostrarLogoHero: true,
  heroPretoBranco: false,
  heroDesktop: '', // nome do arquivo na pasta de fotos
  heroMobile: '',
  logo: '', // vazio = logo branca padrão
  whatsapp: '',
  mensagemWhatsapp: 'Olá! Vim pelo site da FR CLUB.',
  instagram: '',
  email: '',
  cnpj: '',
  cidade: '',
  tituloPecas: 'Últimas peças',
  sobreTitulo: 'Sobre a FR CLUB',
  sobreTexto: 'Escreva aqui quem é a FR CLUB: o que vocês vendem, como escolhem as peças e como atendem.',
  selos: ['Peças selecionadas', 'Envio para todo o Brasil', 'Atendimento pelo WhatsApp'],
  // Entrega: CEP de onde as peças saem e a caixa padrão de uma peça (kg e cm).
  cepOrigem: '',
  pacotePeso: 0.5,
  pacoteAltura: 6,
  pacoteLargura: 25,
  pacoteComprimento: 30,
  freteServicos: '1,2,17', // PAC, SEDEX e Mini Envios
  faq: [
    { p: 'Como faço para comprar?', r: 'Escolha a peça, coloque na sacola, calcule o frete com o seu CEP e pague no site com Pix, cartão ou boleto.' },
    { p: 'Quais as formas de pagamento?', r: 'Pix, cartão de crédito em até 12x e boleto, pelo Mercado Pago.' },
    { p: 'Vocês enviam para todo o Brasil?', r: 'Sim. O valor e o prazo do frete dependem do seu CEP.' },
  ],
  // Páginas /devolucoes e /termos. "## " no começo da linha vira título; "- " vira item de lista; {loja} vira o nome da loja.
  textoDevolucoes: `## Desistiu da compra
Você pode desistir em até 7 dias corridos depois de receber o pedido, como garante o Código de Defesa do Consumidor (art. 49). A peça precisa voltar sem uso, sem lavagem, com as etiquetas e na embalagem em que chegou. O frete de volta é por nossa conta e devolvemos tudo o que você pagou, inclusive o frete.

## Troca de tamanho
Se o tamanho não serviu, peça a troca em até 7 dias depois de receber, com a peça sem uso e com as etiquetas. A troca depende de termos o outro tamanho. Se não tivermos, você escolhe outra peça ou recebe o dinheiro de volta.

## Defeito ou peça errada
Se a peça chegou com defeito ou diferente do que você comprou, avise em até 90 dias depois de receber, de preferência com fotos. O frete de volta é por nossa conta, e você escolhe entre trocar a peça ou receber o dinheiro de volta.

## Como pedir
- Abra a página do seu pedido. O link está no e-mail de confirmação da compra, ou peça logo acima.
- Clique em "Pedir troca ou devolução", escolha as peças e o motivo.
- Respondemos em até 2 dias úteis com as instruções e o código para postar a peça nos Correios.

## Reembolso
O dinheiro volta pelo Mercado Pago, na mesma forma de pagamento, assim que a peça chegar e for conferida. No Pix, cai na conta em até 2 dias úteis. No cartão, o estorno aparece em até 2 faturas, conforme o banco.`,
  textoTermos: `## Sobre estes termos
Ao comprar no site da {loja}, você concorda com as regras abaixo. Se tiver qualquer dúvida, fale com a gente antes de finalizar a compra.

## Peças e preços
As fotos mostram a peça real que está à venda. Peças marcadas como "Peça única" têm uma unidade só. Os preços podem mudar sem aviso, mas vale sempre o preço do momento em que você finalizou a compra.

## Pagamento
O pagamento é feito no ambiente do Mercado Pago, com Pix, cartão de crédito ou boleto. A {loja} não vê nem guarda os dados do seu cartão. O pedido é confirmado quando o Mercado Pago aprova o pagamento.

## Entrega
O prazo e o valor do frete aparecem antes do pagamento e dependem do seu CEP. O prazo começa a contar depois que o pagamento é aprovado e a peça é postada. Você recebe o código de rastreio por e-mail.

## Trocas e devoluções
As regras estão na página Trocas e devoluções.

## Seus dados
Usamos o seu nome, CPF, e-mail, telefone e endereço só para cobrar, emitir a entrega e falar com você sobre o pedido. Esses dados são compartilhados apenas com o Mercado Pago e com a transportadora, como pede a Lei Geral de Proteção de Dados (LGPD). Para pedir a correção ou a exclusão dos seus dados, fale com a gente.`,
};

export function abrirBanco(arquivo) {
  const db = new DatabaseSync(arquivo);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS produtos (
      id INTEGER PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      nome TEXT NOT NULL,
      marca TEXT NOT NULL DEFAULT '',
      categoria TEXT NOT NULL DEFAULT '',
      descricao TEXT NOT NULL DEFAULT '',
      estado TEXT NOT NULL DEFAULT '',
      tamanhos TEXT NOT NULL DEFAULT '[]',
      preco REAL,
      preco_antigo REAL,
      link_pagamento TEXT NOT NULL DEFAULT '',
      fotos TEXT NOT NULL DEFAULT '[]',
      visivel INTEGER NOT NULL DEFAULT 1,
      esgotado INTEGER NOT NULL DEFAULT 0,
      destaque INTEGER NOT NULL DEFAULT 0,
      peca_unica INTEGER NOT NULL DEFAULT 0,
      criado_em TEXT NOT NULL DEFAULT (datetime('now')),
      atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      dados TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessoes (
      token_hash TEXT PRIMARY KEY,
      expira_em INTEGER NOT NULL
    );

    -- status: aguardando (ainda não pagou), pago, enviado, cancelado
    CREATE TABLE IF NOT EXISTS pedidos (
      id INTEGER PRIMARY KEY,
      codigo TEXT NOT NULL UNIQUE,
      itens TEXT NOT NULL,
      cliente TEXT NOT NULL,
      subtotal REAL NOT NULL,
      frete_nome TEXT NOT NULL,
      frete_valor REAL NOT NULL,
      frete_prazo INTEGER,
      total REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'aguardando',
      mp_link TEXT NOT NULL DEFAULT '',
      mp_pagamento TEXT NOT NULL DEFAULT '',
      mp_status TEXT NOT NULL DEFAULT '',
      rastreio TEXT NOT NULL DEFAULT '',
      criado_em TEXT NOT NULL DEFAULT (datetime('now')),
      atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- status: aberta, aprovada (cliente já pode mandar a peça), concluida, recusada
    CREATE TABLE IF NOT EXISTS devolucoes (
      id INTEGER PRIMARY KEY,
      pedido_id INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
      quer TEXT NOT NULL,
      motivo TEXT NOT NULL,
      itens TEXT NOT NULL DEFAULT '[]',
      mensagem TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'aberta',
      resposta TEXT NOT NULL DEFAULT '',
      criado_em TEXT NOT NULL DEFAULT (datetime('now')),
      atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS depoimentos (
      id INTEGER PRIMARY KEY,
      nome TEXT NOT NULL,
      cidade TEXT NOT NULL DEFAULT '',
      texto TEXT NOT NULL,
      nota INTEGER NOT NULL DEFAULT 5,
      aprovado INTEGER NOT NULL DEFAULT 0,
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  db.prepare('INSERT OR IGNORE INTO config (id, dados) VALUES (1, ?)').run('{}');
  db.prepare('DELETE FROM sessoes WHERE expira_em < ?').run(Date.now());
  return db;
}

export function lerConfig(db) {
  const salvo = JSON.parse(db.prepare('SELECT dados FROM config WHERE id = 1').get().dados || '{}');
  return { ...CONFIG_PADRAO, ...salvo };
}

export function salvarConfig(db, mudancas) {
  const atual = JSON.parse(db.prepare('SELECT dados FROM config WHERE id = 1').get().dados || '{}');
  db.prepare('UPDATE config SET dados = ? WHERE id = 1').run(JSON.stringify({ ...atual, ...mudancas }));
}

export function paraPedido(linha) {
  return { ...linha, itens: JSON.parse(linha.itens || '[]'), cliente: JSON.parse(linha.cliente || '{}') };
}

export function paraDevolucao(linha) {
  return { ...linha, itens: JSON.parse(linha.itens || '[]') };
}

export function paraProduto(linha) {
  return {
    ...linha,
    tamanhos: JSON.parse(linha.tamanhos || '[]'),
    fotos: JSON.parse(linha.fotos || '[]'),
    visivel: Boolean(linha.visivel),
    esgotado: Boolean(linha.esgotado),
    destaque: Boolean(linha.destaque),
    peca_unica: Boolean(linha.peca_unica),
  };
}
