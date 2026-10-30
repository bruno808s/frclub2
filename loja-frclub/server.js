// FR CLUB: site da loja com painel para cadastrar peças (sem dependências; Node 22.13+).
// Dados em DATA_DIR (padrão ./dados): loja.sqlite + pasta fotos/.
// Variáveis: ADMIN_SENHA (senha do painel), DATA_DIR, PORT, CONFIAR_PROXY=1 (no Render).

import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { abrirBanco, lerConfig, paraProduto, salvarConfig } from './lib/banco.js';
import { normalizar, pagina404, paginaAdmin, paginaCatalogo, paginaFavoritos, paginaInicio, paginaPeca } from './lib/paginas.js';

const RAIZ = path.dirname(fileURLToPath(import.meta.url));
const PUBLICO = path.join(RAIZ, 'public');
const DADOS = path.resolve(process.env.DATA_DIR || path.join(RAIZ, 'dados'));
const PASTA_FOTOS = path.join(DADOS, 'fotos');
const PORTA = Number(process.env.PORT) || 3000;
const SENHA = process.env.ADMIN_SENHA || '';
const ATRAS_DE_PROXY = Boolean(process.env.CONFIAR_PROXY || process.env.RENDER);

const COOKIE = 'loja_sessao';
const COOKIE_SEGURO = '__Host-loja_sessao'; // nome que o navegador só aceita em HTTPS, sem subdomínio
const SESSAO_MS = 7 * 24 * 60 * 60 * 1000; // o painel pede a senha de novo a cada 7 dias
const SENHA_MINIMA = 12;
const MAX_FOTO_BYTES = 8 * 1024 * 1024;
const MAX_CORPO = 30 * 1024 * 1024;
// A senha entra na "impressão" de cada sessão: trocar a ADMIN_SENHA no Render desconecta todo mundo.
const PIMENTA_SESSAO = crypto.createHash('sha256').update(`sessao:${SENHA}`).digest('hex');
const motivoPainelDesligado = () => (!SENHA
  ? 'O painel está desligado: falta a variável ADMIN_SENHA no Render.'
  : SENHA.length < SENHA_MINIMA
    ? `A senha do painel (ADMIN_SENHA) precisa ter pelo menos ${SENHA_MINIMA} caracteres. Troque no Render.`
    : '');
const MAX_FOTOS_PECA = 8;

await mkdir(PASTA_FOTOS, { recursive: true });
const db = abrirBanco(path.join(DADOS, 'loja.sqlite'));

class ErroHttp extends Error {
  constructor(status, mensagem) {
    super(mensagem);
    this.status = status;
  }
}

// ---------- respostas ----------
function responder(res, status, dados) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(dados));
}
function html(res, status, conteudo) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': res.getHeader('Cache-Control') || 'no-cache' });
  res.end(conteudo);
}
async function lerJson(req, limite = 64 * 1024) {
  if (!String(req.headers['content-type'] || '').includes('application/json')) throw new ErroHttp(415, 'Envie os dados como JSON.');
  const partes = [];
  let tamanho = 0;
  for await (const parte of req) {
    tamanho += parte.length;
    if (tamanho > limite) throw new ErroHttp(413, 'Envio grande demais. Tente com menos fotos de cada vez.');
    partes.push(parte);
  }
  try {
    return JSON.parse(Buffer.concat(partes).toString('utf8') || '{}');
  } catch {
    throw new ErroHttp(400, 'Dados inválidos.');
  }
}

// ---------- sessão do painel ----------
const sha256 = t => crypto.createHash('sha256').update(t).digest('hex');
const hashSessao = token => sha256(`${PIMENTA_SESSAO}:${token}`);
function lerCookies(req) {
  const cookies = {};
  for (const parte of String(req.headers.cookie || '').split(';')) {
    const i = parte.indexOf('=');
    if (i < 1) continue;
    try { cookies[parte.slice(0, i).trim()] = decodeURIComponent(parte.slice(i + 1).trim()); } catch {}
  }
  return cookies;
}
const conexaoSegura = req => req.socket.encrypted || (ATRAS_DE_PROXY && req.headers['x-forwarded-proto'] === 'https');
const nomeCookie = req => (conexaoSegura(req) ? COOKIE_SEGURO : COOKIE);
// HttpOnly: o JavaScript da página não lê o cookie. SameSite=Strict: outro site não consegue usar a sua sessão.
function cookieSessao(req, valor, segundos) {
  return `${nomeCookie(req)}=${valor}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${segundos}${conexaoSegura(req) ? '; Secure' : ''}`;
}
const tokenDe = req => {
  const t = lerCookies(req)[nomeCookie(req)];
  return typeof t === 'string' && /^[A-Za-z0-9_-]{43}$/.test(t) ? t : null;
};
function logado(req) {
  if (motivoPainelDesligado()) return false;
  const token = tokenDe(req);
  if (!token) return false;
  return Boolean(db.prepare('SELECT 1 FROM sessoes WHERE token_hash = ? AND expira_em > ?').get(hashSessao(token), Date.now()));
}
const ipDe = req => (ATRAS_DE_PROXY ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() : '') || req.socket.remoteAddress;
const tentativas = new Map();
let falhasGerais = []; // limite que não depende do IP (quem troca de IP também esbarra nele)
// Comparação em tempo constante: não dá para descobrir a senha medindo o tempo de resposta.
function senhaConfere(digitada) {
  const a = crypto.createHash('sha256').update(String(digitada)).digest();
  const b = crypto.createHash('sha256').update(SENHA).digest();
  return SENHA.length > 0 && crypto.timingSafeEqual(a, b);
}
// Pedidos que mudam alguma coisa só valem vindos do próprio site (proteção contra CSRF).
function conferirOrigem(req) {
  const doSite = (ATRAS_DE_PROXY && req.headers['x-forwarded-host']) || req.headers.host;
  const origem = req.headers.origin;
  if (origem) {
    let host = null;
    try { host = new URL(origem).host; } catch {}
    if (host !== doSite) throw new ErroHttp(403, 'Origem não permitida.');
    return;
  }
  const sitio = req.headers['sec-fetch-site'];
  if (sitio !== 'same-origin' && sitio !== 'none') throw new ErroHttp(403, 'Origem não permitida.');
}

// ---------- limite de pedidos por IP ----------
const janelas = new Map();
function dentroDoLimite(chave, maximo, janelaMs = 60 * 1000) {
  const agora = Date.now();
  const lista = (janelas.get(chave) || []).filter(t => agora - t < janelaMs);
  lista.push(agora);
  janelas.set(chave, lista);
  return lista.length <= maximo;
}

async function entrar(req, res) {
  const motivo = motivoPainelDesligado();
  if (motivo) throw new ErroHttp(503, motivo);
  const ip = ipDe(req);
  const agora = Date.now();
  const QUINZE_MIN = 15 * 60 * 1000;
  const recentes = (tentativas.get(ip) || []).filter(t => agora - t < QUINZE_MIN);
  falhasGerais = falhasGerais.filter(t => agora - t < QUINZE_MIN);
  if (recentes.length >= 8 || falhasGerais.length >= 40) throw new ErroHttp(429, 'Muitas tentativas. Espere 15 minutos.');
  const corpo = await lerJson(req);
  const robo = typeof corpo.site === 'string' && corpo.site !== ''; // campo invisível: só robô preenche
  if (robo || typeof corpo.senha !== 'string' || !senhaConfere(corpo.senha)) {
    tentativas.set(ip, [...recentes, agora]);
    falhasGerais.push(agora);
    await new Promise(r => setTimeout(r, 600 + crypto.randomInt(400)));
    throw new ErroHttp(401, 'Senha incorreta.');
  }
  tentativas.delete(ip);
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessoes (token_hash, expira_em) VALUES (?, ?)').run(hashSessao(token), agora + SESSAO_MS);
  res.setHeader('Set-Cookie', cookieSessao(req, token, SESSAO_MS / 1000));
  responder(res, 200, { ok: true });
}
function sair(req, res) {
  const token = tokenDe(req);
  if (token) db.prepare('DELETE FROM sessoes WHERE token_hash = ?').run(hashSessao(token));
  res.setHeader('Set-Cookie', cookieSessao(req, '', 0));
  responder(res, 200, { ok: true });
}

// ---------- fotos ----------
const TIPOS_FOTO = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
function tipoReal(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}
async function gravarFoto(dataUrl) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(String(dataUrl || ''));
  if (!m) throw new ErroHttp(400, 'Foto inválida. Use JPG, PNG ou WEBP.');
  const bytes = Buffer.from(m[2], 'base64');
  if (bytes.length > MAX_FOTO_BYTES) throw new ErroHttp(413, 'Foto grande demais.');
  const tipo = tipoReal(bytes);
  if (!tipo) throw new ErroHttp(400, 'O arquivo não é uma imagem válida.');
  const arquivo = `${crypto.randomBytes(12).toString('hex')}.${TIPOS_FOTO[tipo]}`;
  await writeFile(path.join(PASTA_FOTOS, arquivo), bytes);
  return arquivo;
}
const arquivoValido = a => /^[a-f0-9]{24}\.(?:jpg|png|webp)$/.test(String(a));
function fotoEmUso(arquivo) {
  const cfg = lerConfig(db);
  if ([cfg.heroDesktop, cfg.heroMobile, cfg.logo].includes(arquivo)) return true;
  return db.prepare('SELECT 1 FROM produtos WHERE fotos LIKE ?').get(`%"${arquivo}"%`) !== undefined;
}
async function apagarFotos(arquivos) {
  for (const a of arquivos) if (arquivoValido(a) && !fotoEmUso(a)) await unlink(path.join(PASTA_FOTOS, a)).catch(() => {});
}
async function servirFoto(req, res, [arquivo]) {
  if (!arquivoValido(arquivo)) throw new ErroHttp(404, 'Foto não encontrada.');
  const caminho = path.join(PASTA_FOTOS, arquivo);
  try { await stat(caminho); } catch { throw new ErroHttp(404, 'Foto não encontrada.'); }
  res.writeHead(200, { 'Content-Type': { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[arquivo.split('.').pop()], 'Cache-Control': 'public, max-age=31536000, immutable' });
  createReadStream(caminho).pipe(res);
}

// ---------- peças ----------
const listarVisiveis = () => db.prepare('SELECT * FROM produtos WHERE visivel = 1 ORDER BY esgotado, id DESC').all().map(paraProduto);
const listarTodas = () => db.prepare('SELECT * FROM produtos ORDER BY id DESC').all().map(paraProduto);

function criarSlug(nome, marca, id) {
  const base = normalizar(`${marca} ${nome}`).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70) || 'peca';
  return `${base}-${id}`;
}

// Validação: só aceita texto (ou número, que vira texto); objetos e listas são recusados.
function texto(v, max, rotulo) {
  if (v !== null && v !== undefined && typeof v !== 'string' && typeof v !== 'number') throw new ErroHttp(400, `${rotulo}: valor inválido.`);
  const s = String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
  if (s.length > max) throw new ErroHttp(400, `${rotulo}: no máximo ${max} caracteres.`);
  return s;
}
function valor(v, rotulo) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v !== 'number' && typeof v !== 'string') throw new ErroHttp(400, `${rotulo}: valor inválido.`);
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 1e7) throw new ErroHttp(400, `${rotulo}: valor inválido.`);
  return Math.round(n * 100) / 100;
}
function linkSeguro(v) {
  const s = texto(v, 500, 'Link de pagamento');
  if (s && !/^https:\/\/[^\s"'<>]+$/i.test(s)) throw new ErroHttp(400, 'O link de pagamento precisa começar com https://');
  return s;
}

async function lerPeca(corpo, atual) {
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) throw new ErroHttp(400, 'Dados inválidos.');
  if (corpo.tamanhos !== undefined && !Array.isArray(corpo.tamanhos)) throw new ErroHttp(400, 'Tamanhos: valor inválido.');
  if (corpo.fotos !== undefined && !Array.isArray(corpo.fotos)) throw new ErroHttp(400, 'Fotos: valor inválido.');
  const dados = {
    nome: texto(corpo.nome, 120, 'Nome'),
    marca: texto(corpo.marca, 60, 'Marca'),
    categoria: texto(corpo.categoria, 40, 'Categoria'),
    descricao: texto(corpo.descricao, 4000, 'Descrição'),
    estado: texto(corpo.estado, 60, 'Estado'),
    tamanhos: JSON.stringify((Array.isArray(corpo.tamanhos) ? corpo.tamanhos : []).map(t => texto(t, 20, 'Tamanho')).filter(Boolean).slice(0, 20)),
    preco: valor(corpo.preco, 'Preço'),
    preco_antigo: valor(corpo.preco_antigo, 'Preço antigo'),
    link_pagamento: linkSeguro(corpo.link_pagamento),
    visivel: corpo.visivel === false ? 0 : 1,
    esgotado: corpo.esgotado === true ? 1 : 0,
    destaque: corpo.destaque === true ? 1 : 0,
    peca_unica: corpo.peca_unica === true ? 1 : 0,
  };
  if (!dados.nome) throw new ErroHttp(400, 'Digite o nome da peça.');
  // Fotos: as que já existem vêm como { arquivo }, as novas como { dados: 'data:image/...' }.
  const pedidas = Array.isArray(corpo.fotos) ? corpo.fotos.slice(0, MAX_FOTOS_PECA) : [];
  const antigas = new Set(atual?.fotos ?? []);
  const fotos = [];
  const novas = [];
  try {
    for (const f of pedidas) {
      if (typeof f?.arquivo === 'string' && antigas.has(f.arquivo)) fotos.push(f.arquivo);
      else if (typeof f?.dados === 'string') {
        const arquivo = await gravarFoto(f.dados);
        novas.push(arquivo);
        fotos.push(arquivo);
      }
    }
  } catch (erro) {
    await apagarFotos(novas);
    throw erro;
  }
  dados.fotos = JSON.stringify(fotos);
  return { dados, removidas: [...antigas].filter(a => !fotos.includes(a)), novas };
}

async function criarPeca(req, res) {
  const { dados, novas } = await lerPeca(await lerJson(req, MAX_CORPO), null);
  try {
    const colunas = Object.keys(dados);
    const { lastInsertRowid } = db.prepare(`INSERT INTO produtos (slug, ${colunas.join(', ')}) VALUES (?, ${colunas.map(() => '?').join(', ')})`)
      .run(`tmp-${crypto.randomUUID()}`, ...colunas.map(c => dados[c]));
    const id = Number(lastInsertRowid);
    db.prepare('UPDATE produtos SET slug = ? WHERE id = ?').run(criarSlug(dados.nome, dados.marca, id), id);
    responder(res, 201, paraProduto(db.prepare('SELECT * FROM produtos WHERE id = ?').get(id)));
  } catch (erro) {
    await apagarFotos(novas);
    throw erro;
  }
}

function buscarPeca(id) {
  const linha = db.prepare('SELECT * FROM produtos WHERE id = ?').get(Number(id));
  if (!linha) throw new ErroHttp(404, 'Essa peça não existe mais.');
  return paraProduto(linha);
}

async function editarPeca(req, res, [id]) {
  const atual = buscarPeca(id);
  const corpo = await lerJson(req, MAX_CORPO);
  // Mudança rápida (só esgotado/visível/destaque), sem mexer no resto.
  const rapidos = ['visivel', 'esgotado', 'destaque'];
  if (Object.keys(corpo).length && Object.keys(corpo).every(k => rapidos.includes(k))) {
    // O nome da coluna vem da lista fixa acima, nunca do que foi enviado; o valor vai como parâmetro.
    const comandos = { visivel: 'UPDATE produtos SET visivel = ?', esgotado: 'UPDATE produtos SET esgotado = ?', destaque: 'UPDATE produtos SET destaque = ?' };
    for (const k of Object.keys(corpo)) db.prepare(`${comandos[k]}, atualizado_em = datetime('now') WHERE id = ?`).run(corpo[k] === true ? 1 : 0, atual.id);
    return responder(res, 200, buscarPeca(atual.id));
  }
  const { dados, removidas, novas } = await lerPeca(corpo, atual);
  try {
    const colunas = Object.keys(dados);
    db.prepare(`UPDATE produtos SET ${colunas.map(c => `${c} = ?`).join(', ')}, slug = ?, atualizado_em = datetime('now') WHERE id = ?`)
      .run(...colunas.map(c => dados[c]), criarSlug(dados.nome, dados.marca, atual.id), atual.id);
  } catch (erro) {
    await apagarFotos(novas);
    throw erro;
  }
  await apagarFotos(removidas);
  responder(res, 200, buscarPeca(atual.id));
}

async function excluirPeca(req, res, [id]) {
  const atual = buscarPeca(id);
  db.prepare('DELETE FROM produtos WHERE id = ?').run(atual.id);
  await apagarFotos(atual.fotos);
  responder(res, 200, { ok: true });
}

// ---------- configuração do site ----------
const CAMPOS_TEXTO = {
  nomeLoja: 40, barraTopo: 120, linkTopoTexto: 40, fraseHero: 80, mensagemWhatsapp: 300, tituloPecas: 60,
  sobreTitulo: 80, sobreTexto: 4000, email: 120, cnpj: 30, cidade: 80,
};
async function salvarAparencia(req, res) {
  const corpo = await lerJson(req, MAX_CORPO);
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) throw new ErroHttp(400, 'Dados inválidos.');
  const cfg = lerConfig(db);
  const mudancas = {};
  for (const [campo, max] of Object.entries(CAMPOS_TEXTO)) if (campo in corpo) mudancas[campo] = texto(corpo[campo], max, campo);
  if ('linkTopoUrl' in corpo) {
    const u = texto(corpo.linkTopoUrl, 300, 'Link');
    if (u && !/^https:\/\/[^\s"'<>]+$/i.test(u)) throw new ErroHttp(400, 'O link da barra do topo precisa começar com https://');
    mudancas.linkTopoUrl = u;
  }
  if ('whatsapp' in corpo) {
    const n = texto(corpo.whatsapp, 30, 'WhatsApp').replace(/\D/g, '');
    if (n && (n.length < 12 || n.length > 13)) throw new ErroHttp(400, 'WhatsApp: use 55 + DDD + número. Ex.: 5571999998888');
    mudancas.whatsapp = n;
  }
  for (const rede of ['instagram']) {
    if (rede in corpo) mudancas[rede] = texto(corpo[rede], 60, rede).replace(/^@/, '').replace(/[^\w.]/g, '');
  }
  for (const chave of ['mostrarLogoHero', 'heroPretoBranco']) if (chave in corpo) mudancas[chave] = corpo[chave] === true;
  if ('email' in corpo && mudancas.email && !/^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(mudancas.email)) throw new ErroHttp(400, 'E-mail inválido.');
  if ('selos' in corpo) mudancas.selos = (Array.isArray(corpo.selos) ? corpo.selos : []).slice(0, 4).map(s => texto(s, 80, 'Selo'));
  if ('faq' in corpo) {
    mudancas.faq = (Array.isArray(corpo.faq) ? corpo.faq : []).slice(0, 20)
      .map(f => ({ p: texto(f?.p, 200, 'Pergunta'), r: texto(f?.r, 1500, 'Resposta') }))
      .filter(f => f.p && f.r);
  }
  // Imagens: { dados } para trocar, null para voltar à padrão.
  const trocadas = [];
  const novas = [];
  try {
    for (const chave of ['heroDesktop', 'heroMobile', 'logo']) {
      if (!(chave in corpo)) continue;
      if (corpo[chave] === null) mudancas[chave] = '';
      else if (typeof corpo[chave]?.dados === 'string') {
        mudancas[chave] = await gravarFoto(corpo[chave].dados);
        novas.push(mudancas[chave]);
      } else continue;
      if (cfg[chave]) trocadas.push(cfg[chave]);
    }
    salvarConfig(db, mudancas);
  } catch (erro) {
    await apagarFotos(novas);
    throw erro;
  }
  await apagarFotos(trocadas);
  responder(res, 200, lerConfig(db));
}

// ---------- páginas ----------
function inicio(req, res) {
  html(res, 200, paginaInicio(lerConfig(db), listarVisiveis()));
}
function catalogo(req, res, _p, url) {
  const q = Object.fromEntries(['categoria', 'marca', 'ordem', 'busca'].map(k => [k, String(url.searchParams.get(k) || '').slice(0, 80)]));
  if (!q.ordem) q.ordem = 'novidades';
  html(res, 200, paginaCatalogo(lerConfig(db), listarVisiveis(), q));
}
function peca(req, res, [slug]) {
  const produtos = listarVisiveis();
  const p = produtos.find(x => x.slug === slug);
  if (!p) return html(res, 404, pagina404(lerConfig(db), produtos));
  html(res, 200, paginaPeca(lerConfig(db), produtos, p));
}

// ---------- arquivos estáticos ----------
const TIPOS = {
  '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.txt': 'text/plain; charset=utf-8',
};
async function estatico(req, res, [arquivo]) {
  const caminho = path.normalize(path.join(PUBLICO, arquivo));
  if (!caminho.startsWith(PUBLICO + path.sep)) throw new ErroHttp(404, 'Não encontrado.');
  let info;
  try { info = await stat(caminho); } catch { throw new ErroHttp(404, 'Não encontrado.'); }
  if (!info.isFile()) throw new ErroHttp(404, 'Não encontrado.');
  res.writeHead(200, { 'Content-Type': TIPOS[path.extname(caminho)] || 'application/octet-stream', 'Cache-Control': 'public, max-age=3600' });
  createReadStream(caminho).pipe(res);
}

// ---------- rotas ----------
const exigirLogin = acao => (req, res, ...resto) => {
  if (!logado(req)) throw new ErroHttp(401, 'Entre no painel para continuar.');
  return acao(req, res, ...resto);
};
const ROTAS = [
  ['GET', /^\/$/, inicio],
  ['GET', /^\/pecas\/?$/, catalogo],
  ['GET', /^\/peca\/([a-z0-9-]+)$/, peca],
  ['GET', /^\/favoritos\/?$/, (req, res) => html(res, 200, paginaFavoritos(lerConfig(db), listarVisiveis()))],
  ['GET', /^\/admin\/?$/, (req, res) => { res.setHeader('Cache-Control', 'no-store'); html(res, 200, paginaAdmin()); }],
  ['GET', /^\/fotos\/([^/]+)$/, servirFoto],
  ['GET', /^\/static\/(.+)$/, estatico],
  ['GET', /^\/robots\.txt$/, (req, res) => { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('User-agent: *\nDisallow: /admin\nDisallow: /api/\n'); }],
  ['GET', /^\/api\/sessao$/, (req, res) => responder(res, 200, { logado: logado(req), painelLigado: !motivoPainelDesligado(), motivo: motivoPainelDesligado() })],
  ['POST', /^\/api\/entrar$/, entrar],
  ['POST', /^\/api\/sair$/, sair],
  ['GET', /^\/api\/admin\/pecas$/, exigirLogin((req, res) => responder(res, 200, listarTodas()))],
  ['POST', /^\/api\/admin\/pecas$/, exigirLogin(criarPeca)],
  ['PATCH', /^\/api\/admin\/pecas\/(\d+)$/, exigirLogin(editarPeca)],
  ['DELETE', /^\/api\/admin\/pecas\/(\d+)$/, exigirLogin(excluirPeca)],
  ['GET', /^\/api\/admin\/aparencia$/, exigirLogin((req, res) => responder(res, 200, lerConfig(db)))],
  ['PATCH', /^\/api\/admin\/aparencia$/, exigirLogin(salvarAparencia)],
];

const POLITICA = [
  "default-src 'self'", "img-src 'self' data: blob:", "style-src 'self' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com", "script-src 'self'", "connect-src 'self'", "frame-ancestors 'none'",
  "base-uri 'self'", "form-action 'self'",
].join('; ');

const servidor = http.createServer(async (req, res) => {
  // Cabeçalhos de segurança em todas as respostas.
  res.setHeader('Content-Security-Policy', POLITICA);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  if (conexaoSegura(req)) res.setHeader('Strict-Transport-Security', 'max-age=31536000');

  // HTTPS obrigatório: quem chegar por http:// é mandado para https://
  if (ATRAS_DE_PROXY && req.headers['x-forwarded-proto'] === 'http') {
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').replace(/[^\w.:-]/g, '');
    res.writeHead(301, { Location: `https://${host}${req.url.startsWith('/') ? req.url : '/'}` });
    return res.end();
  }

  let url;
  try {
    url = new URL(req.url, 'http://loja');
  } catch {
    res.writeHead(400);
    return res.end();
  }
  const ip = ipDe(req);
  const escrita = req.method !== 'GET' && req.method !== 'HEAD';
  if (!dentroDoLimite(`geral:${ip}`, 300) || (escrita && !dentroDoLimite(`escrita:${ip}`, 60))) {
    res.writeHead(429, { 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '60' });
    return res.end('Muitos pedidos seguidos. Espere um minuto.');
  }
  if (url.pathname === '/admin' || url.pathname.startsWith('/admin/') || url.pathname.startsWith('/api/')) {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  }
  try {
    const rota = ROTAS.find(([metodo, padrao]) => (metodo === req.method || (metodo === 'GET' && req.method === 'HEAD')) && padrao.test(url.pathname));
    if (!rota) {
      if (url.pathname.startsWith('/api/')) throw new ErroHttp(404, 'Rota não encontrada.');
      return html(res, 404, pagina404(lerConfig(db), listarVisiveis()));
    }
    if (escrita) conferirOrigem(req);
    if (url.pathname.startsWith('/api/admin/')) res.setHeader('Cache-Control', 'no-store');
    let params;
    try {
      params = rota[1].exec(url.pathname).slice(1).map(decodeURIComponent);
    } catch {
      throw new ErroHttp(400, 'Endereço inválido.');
    }
    await rota[2](req, res, params, url);
  } catch (erro) {
    const conhecido = erro instanceof ErroHttp;
    if (!conhecido) console.error(erro);
    if (res.headersSent) return res.end();
    if (!url.pathname.startsWith('/api/') && conhecido && erro.status === 404) return html(res, 404, pagina404(lerConfig(db), listarVisiveis()));
    responder(res, conhecido ? erro.status : 500, { erro: conhecido ? erro.message : 'Erro no servidor. Tente de novo.' });
  }
});

for (const sinal of ['SIGTERM', 'SIGINT']) {
  process.once(sinal, () => {
    servidor.close(() => { db.close(); process.exit(0); });
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
// Conexões lentas de propósito não ficam presas para sempre.
servidor.headersTimeout = 20 * 1000;
servidor.requestTimeout = 120 * 1000;
servidor.keepAliveTimeout = 10 * 1000;

setInterval(() => db.prepare('DELETE FROM sessoes WHERE expira_em < ?').run(Date.now()), 60 * 60 * 1000).unref();
setInterval(() => {
  const agora = Date.now();
  for (const [chave, lista] of janelas) if (!lista.some(t => agora - t < 60 * 1000)) janelas.delete(chave);
  for (const [ip, lista] of tentativas) if (!lista.some(t => agora - t < 15 * 60 * 1000)) tentativas.delete(ip);
}, 5 * 60 * 1000).unref();

servidor.listen(PORTA, () => {
  console.log(`\n  Loja rodando em http://localhost:${PORTA}`);
  console.log(`  Painel: http://localhost:${PORTA}/admin ${motivoPainelDesligado() ? `(desligado: ${motivoPainelDesligado()})` : ''}`);
  console.log(`  Dados em: ${DADOS}\n`);
});
