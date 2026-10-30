// Banco da loja (SQLite que já vem no Node): peças, configuração do site e sessões do painel.
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
  faq: [
    { p: 'Como faço para comprar?', r: 'Escolha a peça, coloque na sacola e finalize pelo WhatsApp. A gente confirma a disponibilidade e envia o pagamento.' },
    { p: 'Quais as formas de pagamento?', r: 'Pix e cartão. Fale com a gente para combinar.' },
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
