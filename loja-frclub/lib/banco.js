// Banco da loja (SQLite que já vem no Node): peças, configuração, pedidos, contas de clientes e depoimentos.
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

    -- senha vazia = a conta só entra pelo link enviado no e-mail
    CREATE TABLE IF NOT EXISTS clientes (
      id INTEGER PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      nome TEXT NOT NULL DEFAULT '',
      senha TEXT NOT NULL DEFAULT '',
      email_confirmado INTEGER NOT NULL DEFAULT 0,
      dados TEXT NOT NULL DEFAULT '{}',
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- via: 'senha' ou 'link' (quem entrou pelo link do e-mail pode trocar a senha sem a antiga)
    CREATE TABLE IF NOT EXISTS sessoes_clientes (
      token_hash TEXT PRIMARY KEY,
      cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
      via TEXT NOT NULL,
      expira_em INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS links_entrada (
      token_hash TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      expira_em INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS depoimentos (
      id INTEGER PRIMARY KEY,
      nome TEXT NOT NULL,
      cidade TEXT NOT NULL DEFAULT '',
      texto TEXT NOT NULL,
      nota INTEGER NOT NULL DEFAULT 5,
      aprovado INTEGER NOT NULL DEFAULT 0,
      cliente_id INTEGER,
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  // Colunas que chegaram depois (bancos antigos não têm).
  if (!db.prepare('PRAGMA table_info(pedidos)').all().some(c => c.name === 'cliente_id')) db.exec('ALTER TABLE pedidos ADD COLUMN cliente_id INTEGER');
  db.prepare('INSERT OR IGNORE INTO config (id, dados) VALUES (1, ?)').run('{}');
  for (const tabela of ['sessoes', 'sessoes_clientes', 'links_entrada']) db.prepare(`DELETE FROM ${tabela} WHERE expira_em < ?`).run(Date.now());
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

export function paraCliente(linha) {
  const { senha, ...resto } = linha;
  return { ...resto, temSenha: Boolean(senha), email_confirmado: Boolean(linha.email_confirmado), dados: JSON.parse(linha.dados || '{}') };
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
