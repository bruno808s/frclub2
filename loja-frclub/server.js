// FR CLUB: site da loja com painel para cadastrar peças (sem dependências; Node 22.13+).
// Dados em DATA_DIR (padrão ./dados): loja.sqlite + pasta fotos/.
// Variáveis: ADMIN_SENHA (senha do painel), DATA_DIR, PORT, CONFIAR_PROXY=1 (no Render).
// Opcionais: MP_ACCESS_TOKEN, SUPERFRETE_TOKEN (pagamento e frete), BREVO_API_KEY e EMAIL_REMETENTE (e-mails).

import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { abrirBanco, lerConfig, paraCliente, paraPedido, paraProduto, salvarConfig } from './lib/banco.js';
import {
  normalizar, pagina404, paginaAdmin, paginaCatalogo, paginaCheckout, paginaConta, paginaDepoimentos, paginaFavoritos, paginaInicio,
  paginaLinkEntrada, paginaPeca, paginaPedido,
} from './lib/paginas.js';
import { ErroServico, buscarPagamento, cotarFrete, criarCobranca, freteLigado, pagamentoLigado } from './lib/pagamento.js';
import { emailLigado, emailLinkEntrada, emailNovaVenda, emailPedidoEnviado, emailPedidoPago, enviarDepois, enviarEmail } from './lib/email.js';

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

// ---------- frete e checkout ----------
function falhaServico(erro) {
  if (!(erro instanceof ErroServico)) console.error(erro);
  return new ErroHttp(502, erro instanceof ErroServico ? erro.message : 'Erro no servidor. Tente de novo.');
}
const soDigitos = v => String(v ?? '').replace(/\D/g, '');
function cpfValido(cpf) {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  for (const n of [9, 10]) {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(cpf[i]) * (n + 1 - i);
    if (((soma * 10) % 11) % 10 !== Number(cpf[n])) return false;
  }
  return true;
}
function lerCep(v) {
  const cep = soDigitos(typeof v === 'string' ? v : '');
  if (cep.length !== 8) throw new ErroHttp(400, 'Digite um CEP com 8 números.');
  return cep;
}
const urlDoSite = req => (process.env.SITE_URL || process.env.RENDER_EXTERNAL_URL
  || `${conexaoSegura(req) ? 'https' : 'http'}://${(ATRAS_DE_PROXY && req.headers['x-forwarded-host']) || req.headers.host}`).replace(/\/$/, '');

// Monta os itens com o preço do banco (o preço que vem do navegador é ignorado).
function montarItens(lista, conferirTamanho = true) {
  if (!Array.isArray(lista) || !lista.length) throw new ErroHttp(400, 'Sua sacola está vazia.');
  if (lista.length > 30) throw new ErroHttp(400, 'Itens demais na sacola.');
  const itens = new Map();
  for (const pedido of lista) {
    const linha = db.prepare('SELECT * FROM produtos WHERE id = ? AND visivel = 1').get(Number(pedido?.id));
    if (!linha) throw new ErroHttp(409, 'Uma das peças da sacola saiu do site. Tire ela da sacola e tente de novo.');
    const p = paraProduto(linha);
    if (p.esgotado) throw new ErroHttp(409, `"${p.nome}" esgotou. Tire ela da sacola para continuar.`);
    if (!(p.preco > 0)) throw new ErroHttp(409, `"${p.nome}" está sem preço. Fale com a gente pelo WhatsApp.`);
    const tamanho = texto(pedido.tamanho, 20, 'Tamanho');
    if (conferirTamanho && p.tamanhos.length && !p.tamanhos.includes(tamanho)) throw new ErroHttp(400, `Escolha o tamanho de "${p.nome}" de novo.`);
    const chave = `${p.id}:${tamanho}`;
    const atual = itens.get(chave);
    if (atual) {
      if (p.peca_unica) throw new ErroHttp(409, `"${p.nome}" é peça única: deixe só uma na sacola.`);
      atual.quantidade += 1;
    } else {
      itens.set(chave, { id: p.id, slug: p.slug, nome: p.nome, marca: p.marca, tamanho, preco: p.preco, quantidade: 1, foto: p.fotos[0] ? `/fotos/${p.fotos[0]}` : '', peca_unica: p.peca_unica });
    }
  }
  return [...itens.values()];
}
const somar = itens => Math.round(itens.reduce((t, i) => t + i.preco * i.quantidade, 0) * 100) / 100;
const contar = itens => itens.reduce((t, i) => t + i.quantidade, 0);

async function calcularFrete(req, res) {
  const cfg = lerConfig(db);
  if (!freteLigado(cfg)) throw new ErroHttp(503, 'O cálculo de frete ainda não foi configurado.');
  if (!dentroDoLimite(`frete:${ipDe(req)}`, 20)) throw new ErroHttp(429, 'Muitos cálculos seguidos. Espere um minuto.');
  const corpo = await lerJson(req);
  const cep = lerCep(corpo.cep);
  const itens = montarItens(corpo.itens, false);
  let opcoes;
  try {
    opcoes = await cotarFrete(cfg, cep, contar(itens), somar(itens));
  } catch (erro) {
    throw falhaServico(erro);
  }
  if (!opcoes.length) throw new ErroHttp(404, 'Não encontramos entrega para esse CEP. Confira o número.');
  responder(res, 200, opcoes);
}

// Endereço pelo CEP (ViaCEP), passando pelo servidor para o site não depender de outro domínio.
async function buscarEndereco(req, res, [cep]) {
  if (!dentroDoLimite(`cep:${ipDe(req)}`, 30)) throw new ErroHttp(429, 'Muitas buscas seguidas. Espere um minuto.');
  let dados;
  try {
    const r = await fetch(`https://viacep.com.br/ws/${lerCep(cep)}/json/`, { signal: AbortSignal.timeout(6000) });
    dados = await r.json();
  } catch {
    throw new ErroHttp(502, 'Não consegui buscar o endereço. Preencha à mão.');
  }
  if (!dados || dados.erro) throw new ErroHttp(404, 'CEP não encontrado.');
  responder(res, 200, { rua: dados.logradouro || '', bairro: dados.bairro || '', cidade: dados.localidade || '', uf: dados.uf || '' });
}

// Nome e sobrenome, só letras (aceita acentos, apóstrofo e hífen), cada ponta com 2 letras ou mais.
const NOME_COMPLETO = /^\p{L}{2,}(?: [\p{L}'.-]+)* [\p{L}'.-]{2,}$/u;
const nomeValido = nome => NOME_COMPLETO.test(nome);
function lerEmail(v) {
  const email = texto(v, 120, 'E-mail').toLowerCase();
  if (!/^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(email)) throw new ErroHttp(400, 'E-mail inválido.');
  return email;
}

function lerCliente(c) {
  if (!c || typeof c !== 'object' || Array.isArray(c)) throw new ErroHttp(400, 'Preencha seus dados.');
  const cliente = {
    nome: texto(c.nome, 120, 'Nome').replace(/\s+/g, ' '),
    email: lerEmail(c.email),
    cpf: soDigitos(texto(c.cpf, 20, 'CPF')),
    telefone: soDigitos(texto(c.telefone, 20, 'Telefone')),
    cep: lerCep(c.cep),
    rua: texto(c.rua, 120, 'Rua'),
    numero: texto(c.numero, 20, 'Número'),
    complemento: texto(c.complemento, 80, 'Complemento'),
    bairro: texto(c.bairro, 80, 'Bairro'),
    cidade: texto(c.cidade, 80, 'Cidade'),
    uf: texto(c.uf, 2, 'Estado').toUpperCase(),
  };
  if (!nomeValido(cliente.nome)) throw new ErroHttp(400, 'Digite seu nome completo (nome e sobrenome).');
  if (!cpfValido(cliente.cpf)) throw new ErroHttp(400, 'CPF inválido.');
  if (cliente.telefone.length < 10 || cliente.telefone.length > 11) throw new ErroHttp(400, 'Telefone: DDD + número.');
  if (!cliente.rua || !cliente.numero || !cliente.bairro || !cliente.cidade) throw new ErroHttp(400, 'Preencha o endereço completo.');
  if (!/^[A-Z]{2}$/.test(cliente.uf)) throw new ErroHttp(400, 'Estado: use a sigla, como BA ou SP.');
  return cliente;
}

async function criarPedido(req, res) {
  const cfg = lerConfig(db);
  if (!freteLigado(cfg) || !pagamentoLigado()) throw new ErroHttp(503, 'O pagamento pelo site ainda não foi configurado. Finalize pelo WhatsApp.');
  if (!dentroDoLimite(`pedido:${ipDe(req)}`, 6)) throw new ErroHttp(429, 'Muitas tentativas seguidas. Espere um minuto.');
  const corpo = await lerJson(req);
  const itens = montarItens(corpo.itens);
  const cliente = lerCliente(corpo.cliente);
  const conta = sessaoCliente(req);
  const subtotal = somar(itens);
  // O frete é recalculado aqui: o valor escolhido no navegador não vale.
  let opcoes;
  try {
    opcoes = await cotarFrete(cfg, cliente.cep, contar(itens), subtotal);
  } catch (erro) {
    throw falhaServico(erro);
  }
  const frete = opcoes.find(o => o.id === Number(corpo.frete));
  if (!frete) throw new ErroHttp(409, 'Escolha a forma de entrega de novo.');
  const total = Math.round((subtotal + frete.preco) * 100) / 100;
  const codigo = crypto.randomBytes(9).toString('base64url');
  const { lastInsertRowid } = db.prepare(`INSERT INTO pedidos (codigo, itens, cliente, subtotal, frete_nome, frete_valor, frete_prazo, total, cliente_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(codigo, JSON.stringify(itens), JSON.stringify(cliente), subtotal,
    `${frete.empresa ? `${frete.empresa} ` : ''}${frete.nome}`.trim(), frete.preco, frete.prazo, total, conta?.id ?? null);
  let cobranca;
  try {
    cobranca = await criarCobranca({ pedido: { codigo }, itens, cliente, frete, baseUrl: urlDoSite(req), nomeLoja: cfg.nomeLoja });
  } catch (erro) {
    db.prepare('DELETE FROM pedidos WHERE id = ?').run(Number(lastInsertRowid));
    throw falhaServico(erro);
  }
  db.prepare('UPDATE pedidos SET mp_link = ? WHERE id = ?').run(cobranca.link, Number(lastInsertRowid));
  // A conta guarda o endereço da última compra para preencher sozinho na próxima (o CPF não fica guardado).
  if (conta) {
    const { nome, email, cpf, ...endereco } = cliente;
    db.prepare(`UPDATE clientes SET dados = ?, nome = CASE WHEN nome = '' THEN ? ELSE nome END WHERE id = ?`).run(JSON.stringify(endereco), nome, conta.id);
  }
  responder(res, 201, { codigo, link: cobranca.link });
}

// Atualiza o pedido com o que o Mercado Pago diz sobre o pagamento.
function aplicarPagamento(pagamento, base) {
  const linha = db.prepare('SELECT * FROM pedidos WHERE codigo = ?').get(pagamento.referencia);
  if (!linha) return null;
  const pedido = paraPedido(linha);
  let status = pedido.status;
  if (pagamento.status === 'approved' && pagamento.valor >= pedido.total - 0.01) {
    if (status === 'aguardando' || status === 'cancelado') status = 'pago';
  } else if (['refunded', 'charged_back'].includes(pagamento.status)) status = 'cancelado';
  db.prepare(`UPDATE pedidos SET status = ?, mp_pagamento = ?, mp_status = ?, atualizado_em = datetime('now') WHERE id = ?`)
    .run(status, pagamento.id, pagamento.status, pedido.id);
  const atualizado = paraPedido(db.prepare('SELECT * FROM pedidos WHERE id = ?').get(pedido.id));
  if (status === 'pago' && pedido.status !== 'pago') {
    // Peça única vendida sai da loja na hora.
    for (const i of pedido.itens) if (i.peca_unica) db.prepare(`UPDATE produtos SET esgotado = 1, atualizado_em = datetime('now') WHERE id = ?`).run(i.id);
    const cfg = lerConfig(db);
    enviarDepois(cfg, emailPedidoPago(cfg, atualizado, base));
    if (cfg.email) enviarDepois(cfg, emailNovaVenda(cfg, atualizado, base));
  }
  return atualizado;
}

// Aviso automático do Mercado Pago. Só usamos o número do pagamento e conferimos tudo direto na API deles.
async function avisoMercadoPago(req, res, _p, url) {
  if (!pagamentoLigado()) return responder(res, 200, { ok: true });
  const corpo = await lerJson(req).catch(() => ({}));
  const tipo = url.searchParams.get('type') || url.searchParams.get('topic') || corpo.type || corpo.topic;
  const id = url.searchParams.get('data.id') || corpo.data?.id || url.searchParams.get('id');
  if (tipo !== 'payment' || !/^\d{1,20}$/.test(String(id || ''))) return responder(res, 200, { ok: true });
  try {
    aplicarPagamento(await buscarPagamento(String(id)), urlDoSite(req));
  } catch (erro) {
    console.error('Aviso do Mercado Pago:', erro.message);
    throw new ErroHttp(502, 'Tente de novo.'); // o Mercado Pago reenvia mais tarde
  }
  responder(res, 200, { ok: true });
}

async function verPedido(req, res, [codigo], url) {
  const linha = db.prepare('SELECT * FROM pedidos WHERE codigo = ?').get(codigo);
  if (!linha) throw new ErroHttp(404, 'Pedido não encontrado.');
  let pedido = paraPedido(linha);
  // Na volta do Mercado Pago vem o número do pagamento: confere na hora, sem esperar o aviso.
  const pagamentoId = url.searchParams.get('payment_id') || url.searchParams.get('collection_id');
  if (pagamentoLigado() && /^\d{1,20}$/.test(String(pagamentoId || '')) && (pedido.mp_pagamento !== pagamentoId || pedido.status === 'aguardando')) {
    try {
      const pagamento = await buscarPagamento(pagamentoId);
      if (pagamento.referencia === pedido.codigo) pedido = aplicarPagamento(pagamento, urlDoSite(req)) ?? pedido;
    } catch (erro) {
      console.error('Conferindo pagamento:', erro.message);
    }
  }
  res.setHeader('Cache-Control', 'no-store');
  html(res, 200, paginaPedido(lerConfig(db), listarVisiveis(), pedido));
}

const STATUS_PEDIDO = ['aguardando', 'pago', 'enviado', 'cancelado'];
async function editarPedido(req, res, [id]) {
  const linha = db.prepare('SELECT * FROM pedidos WHERE id = ?').get(Number(id));
  if (!linha) throw new ErroHttp(404, 'Pedido não encontrado.');
  const corpo = await lerJson(req);
  const status = corpo.status === undefined ? linha.status : String(corpo.status);
  if (!STATUS_PEDIDO.includes(status)) throw new ErroHttp(400, 'Status inválido.');
  const rastreio = corpo.rastreio === undefined ? linha.rastreio : texto(corpo.rastreio, 60, 'Rastreio');
  db.prepare(`UPDATE pedidos SET status = ?, rastreio = ?, atualizado_em = datetime('now') WHERE id = ?`).run(status, rastreio, linha.id);
  const pedido = paraPedido(db.prepare('SELECT * FROM pedidos WHERE id = ?').get(linha.id));
  if (status === 'enviado' && linha.status !== 'enviado') {
    const cfg = lerConfig(db);
    enviarDepois(cfg, emailPedidoEnviado(cfg, pedido, urlDoSite(req)));
  }
  responder(res, 200, { ...pedido, emailEnviado: status === 'enviado' && linha.status !== 'enviado' && emailLigado() });
}

// ---------- contas de clientes ----------
const COOKIE_CLIENTE = 'loja_cliente';
const COOKIE_CLIENTE_SEGURO = '__Host-loja_cliente';
const SESSAO_CLIENTE_MS = 30 * 24 * 60 * 60 * 1000;
const LINK_MS = 30 * 60 * 1000;
const QUINZE_MIN = 15 * 60 * 1000;
const scrypt = promisify(crypto.scrypt);
const nomeCookieCliente = req => (conexaoSegura(req) ? COOKIE_CLIENTE_SEGURO : COOKIE_CLIENTE);
const hashCliente = token => sha256(`cliente:${token}`);
// Lax (e não Strict): quem chega pelo link do e-mail já entra logado. O que muda dados passa pelo conferirOrigem.
function cookieCliente(req, valor, segundos) {
  return `${nomeCookieCliente(req)}=${valor}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${segundos}${conexaoSegura(req) ? '; Secure' : ''}`;
}
function tokenCliente(req) {
  const t = lerCookies(req)[nomeCookieCliente(req)];
  return typeof t === 'string' && /^[A-Za-z0-9_-]{43}$/.test(t) ? t : null;
}
function sessaoCliente(req) {
  const token = tokenCliente(req);
  if (!token) return null;
  const linha = db.prepare(`SELECT c.*, s.via FROM sessoes_clientes s JOIN clientes c ON c.id = s.cliente_id
    WHERE s.token_hash = ? AND s.expira_em > ?`).get(hashCliente(token), Date.now());
  return linha ? paraCliente(linha) : null;
}
function abrirSessaoCliente(req, res, clienteId, via) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessoes_clientes (token_hash, cliente_id, via, expira_em) VALUES (?, ?, ?, ?)').run(hashCliente(token), clienteId, via, Date.now() + SESSAO_CLIENTE_MS);
  res.setHeader('Set-Cookie', cookieCliente(req, token, SESSAO_CLIENTE_MS / 1000));
}
function exigirCliente(req) {
  const cliente = sessaoCliente(req);
  if (!cliente) throw new ErroHttp(401, 'Entre na sua conta para continuar.');
  return cliente;
}

// Senha guardada como scrypt$sal$hash: nem quem abrir o banco consegue ler a senha.
async function gerarHashSenha(senha) {
  const sal = crypto.randomBytes(16);
  return `scrypt$${sal.toString('hex')}$${(await scrypt(senha, sal, 64)).toString('hex')}`;
}
async function senhaDoClienteConfere(senha, guardado) {
  const [, sal = '', hash = ''] = String(guardado || '').split('$');
  const calculado = await scrypt(String(senha), Buffer.from(sal || '00', 'hex'), 64); // calcula mesmo sem conta: o tempo não entrega nada
  const esperado = Buffer.from(hash, 'hex');
  return esperado.length === 64 && crypto.timingSafeEqual(calculado, esperado);
}
function lerSenhaNova(v) {
  if (typeof v !== 'string' || v.length < 8) throw new ErroHttp(400, 'A senha precisa ter pelo menos 8 caracteres.');
  if (v.length > 200) throw new ErroHttp(400, 'Senha longa demais.');
  return v;
}
const ehRobo = corpo => typeof corpo?.site === 'string' && corpo.site !== ''; // campo invisível: só robô preenche
function limiteConta(req) {
  if (!dentroDoLimite(`conta:${ipDe(req)}`, 10, QUINZE_MIN)) throw new ErroHttp(429, 'Muitas tentativas. Espere 15 minutos.');
}

async function criarConta(req, res) {
  limiteConta(req);
  const corpo = await lerJson(req);
  if (ehRobo(corpo)) throw new ErroHttp(400, 'Não foi possível criar a conta.');
  const nome = texto(corpo.nome, 120, 'Nome').replace(/\s+/g, ' ');
  const email = lerEmail(corpo.email);
  if (!nomeValido(nome)) throw new ErroHttp(400, 'Digite seu nome completo (nome e sobrenome).');
  const senha = lerSenhaNova(corpo.senha);
  if (db.prepare('SELECT 1 FROM clientes WHERE email = ?').get(email)) throw new ErroHttp(409, 'Já existe uma conta com esse e-mail. Entre com a senha ou use "Sem senha".');
  const { lastInsertRowid } = db.prepare('INSERT INTO clientes (email, nome, senha) VALUES (?, ?, ?)').run(email, nome, await gerarHashSenha(senha));
  abrirSessaoCliente(req, res, Number(lastInsertRowid), 'senha');
  responder(res, 201, { ok: true });
}

async function entrarConta(req, res) {
  limiteConta(req);
  const corpo = await lerJson(req);
  const email = lerEmail(corpo.email);
  const linha = db.prepare('SELECT * FROM clientes WHERE email = ?').get(email);
  const confere = await senhaDoClienteConfere(corpo.senha, linha?.senha);
  if (ehRobo(corpo) || !linha || !confere) {
    await new Promise(r => setTimeout(r, 400 + crypto.randomInt(400)));
    if (linha && !linha.senha) throw new ErroHttp(401, 'Essa conta ainda não tem senha. Use "Sem senha" para receber um link no e-mail.');
    throw new ErroHttp(401, 'E-mail ou senha incorretos.');
  }
  abrirSessaoCliente(req, res, linha.id, 'senha');
  responder(res, 200, { ok: true });
}

async function pedirLink(req, res) {
  if (!emailLigado()) throw new ErroHttp(503, 'A entrada sem senha ainda não está disponível. Entre com e-mail e senha.');
  const corpo = await lerJson(req);
  const email = lerEmail(corpo.email);
  if (!dentroDoLimite(`link:${ipDe(req)}`, 5, QUINZE_MIN) || !dentroDoLimite(`link:${email}`, 3, QUINZE_MIN)) throw new ErroHttp(429, 'Muitos links pedidos. Espere 15 minutos.');
  if (!ehRobo(corpo)) {
    const token = crypto.randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO links_entrada (token_hash, email, expira_em) VALUES (?, ?, ?)').run(hashCliente(token), email, Date.now() + LINK_MS);
    const cfg = lerConfig(db);
    try {
      await enviarEmail(cfg, emailLinkEntrada(cfg, email, `${urlDoSite(req)}/conta/link/${token}`));
    } catch (erro) {
      console.error('Link de entrada:', erro.message);
      throw new ErroHttp(502, 'Não consegui enviar o e-mail agora. Tente de novo em instantes.');
    }
  }
  responder(res, 200, { ok: true });
}

// O link do e-mail abre uma página com um botão: robôs que "visitam" links de e-mail não gastam o link.
async function usarLink(req, res) {
  limiteConta(req);
  const { token } = await lerJson(req);
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new ErroHttp(400, 'Link inválido.');
  const hash = hashCliente(token);
  const link = db.prepare('SELECT * FROM links_entrada WHERE token_hash = ? AND expira_em > ?').get(hash, Date.now());
  db.prepare('DELETE FROM links_entrada WHERE token_hash = ?').run(hash);
  if (!link) throw new ErroHttp(400, 'Esse link expirou ou já foi usado. Peça outro.');
  db.prepare('INSERT OR IGNORE INTO clientes (email) VALUES (?)').run(link.email);
  db.prepare('UPDATE clientes SET email_confirmado = 1 WHERE email = ?').run(link.email);
  abrirSessaoCliente(req, res, db.prepare('SELECT id FROM clientes WHERE email = ?').get(link.email).id, 'link');
  responder(res, 200, { ok: true });
}

function sairConta(req, res) {
  const token = tokenCliente(req);
  if (token) db.prepare('DELETE FROM sessoes_clientes WHERE token_hash = ?').run(hashCliente(token));
  res.setHeader('Set-Cookie', cookieCliente(req, '', 0));
  responder(res, 200, { ok: true });
}

const CAMPOS_ENDERECO = { telefone: 20, cep: 9, rua: 120, numero: 20, complemento: 80, bairro: 80, cidade: 80, uf: 2 };
async function atualizarConta(req, res) {
  const cliente = exigirCliente(req);
  const corpo = await lerJson(req);
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) throw new ErroHttp(400, 'Dados inválidos.');
  const nome = 'nome' in corpo ? texto(corpo.nome, 120, 'Nome').replace(/\s+/g, ' ') : cliente.nome;
  if (!nomeValido(nome)) throw new ErroHttp(400, 'Digite seu nome completo (nome e sobrenome).');
  const dados = { ...cliente.dados };
  for (const [campo, max] of Object.entries(CAMPOS_ENDERECO)) if (campo in corpo) dados[campo] = texto(corpo[campo], max, campo);
  if (dados.telefone) dados.telefone = soDigitos(dados.telefone);
  if (dados.cep) dados.cep = soDigitos(dados.cep);
  if (dados.uf) dados.uf = dados.uf.toUpperCase();
  if (corpo.senhaNova) {
    limiteConta(req);
    const senhaNova = lerSenhaNova(corpo.senhaNova);
    // Quem entrou pelo link do e-mail já provou que é dono da conta (é o "esqueci a senha").
    if (cliente.temSenha && cliente.via !== 'link') {
      const linha = db.prepare('SELECT senha FROM clientes WHERE id = ?').get(cliente.id);
      if (!(await senhaDoClienteConfere(corpo.senhaAtual ?? '', linha.senha))) throw new ErroHttp(400, 'A senha atual não confere.');
    }
    db.prepare('UPDATE clientes SET senha = ? WHERE id = ?').run(await gerarHashSenha(senhaNova), cliente.id);
  }
  db.prepare('UPDATE clientes SET nome = ?, dados = ? WHERE id = ?').run(nome, JSON.stringify(dados), cliente.id);
  responder(res, 200, { ok: true });
}

function pedidosDoCliente(cliente) {
  // Pedidos feitos logado; com o e-mail confirmado, também os feitos antes de ter conta.
  return db.prepare(`SELECT * FROM pedidos WHERE cliente_id = ? OR (? = 1 AND json_extract(cliente, '$.email') = ?) ORDER BY id DESC LIMIT 50`)
    .all(cliente.id, cliente.email_confirmado ? 1 : 0, cliente.email).map(paraPedido);
}
function verConta(req, res) {
  const cliente = sessaoCliente(req);
  res.setHeader('Cache-Control', 'no-store');
  html(res, 200, paginaConta(lerConfig(db), listarVisiveis(), { cliente, pedidos: cliente ? pedidosDoCliente(cliente) : [], semSenhaLigado: emailLigado() }));
}
const dadosParaCheckout = cliente => (cliente ? { nome: cliente.nome, email: cliente.email, ...cliente.dados } : null);

// ---------- depoimentos ----------
const listarDepoimentos = () => db.prepare('SELECT * FROM depoimentos WHERE aprovado = 1 ORDER BY id DESC LIMIT 60').all();
function lerDepoimento(corpo) {
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) throw new ErroHttp(400, 'Dados inválidos.');
  const d = {
    nome: texto(corpo.nome, 60, 'Nome').replace(/\s+/g, ' '),
    cidade: texto(corpo.cidade, 60, 'Cidade'),
    texto: texto(corpo.texto, 1000, 'Depoimento'),
    nota: Number(corpo.nota),
  };
  if (d.nome.length < 2) throw new ErroHttp(400, 'Digite seu nome.');
  if (d.texto.length < 10) throw new ErroHttp(400, 'Escreva um pouco mais sobre a sua experiência.');
  if (!Number.isInteger(d.nota) || d.nota < 1 || d.nota > 5) throw new ErroHttp(400, 'Escolha de 1 a 5 estrelas.');
  return d;
}
async function criarDepoimento(req, res) {
  if (!dentroDoLimite(`depoimento:${ipDe(req)}`, 3, 60 * 60 * 1000)) throw new ErroHttp(429, 'Você já mandou depoimentos agora há pouco. Tente mais tarde.');
  const corpo = await lerJson(req);
  if (ehRobo(corpo)) return responder(res, 201, { ok: true });
  const d = lerDepoimento(corpo);
  // Entra escondido: só aparece no site depois que a loja aprovar no painel.
  db.prepare('INSERT INTO depoimentos (nome, cidade, texto, nota, cliente_id) VALUES (?, ?, ?, ?, ?)').run(d.nome, d.cidade, d.texto, d.nota, sessaoCliente(req)?.id ?? null);
  responder(res, 201, { ok: true });
}
async function criarDepoimentoAdmin(req, res) {
  const d = lerDepoimento(await lerJson(req));
  const { lastInsertRowid } = db.prepare('INSERT INTO depoimentos (nome, cidade, texto, nota, aprovado) VALUES (?, ?, ?, ?, 1)').run(d.nome, d.cidade, d.texto, d.nota);
  responder(res, 201, db.prepare('SELECT * FROM depoimentos WHERE id = ?').get(Number(lastInsertRowid)));
}
async function editarDepoimento(req, res, [id]) {
  const corpo = await lerJson(req);
  const { changes } = db.prepare('UPDATE depoimentos SET aprovado = ? WHERE id = ?').run(corpo.aprovado === true ? 1 : 0, Number(id));
  if (!changes) throw new ErroHttp(404, 'Depoimento não encontrado.');
  responder(res, 200, db.prepare('SELECT * FROM depoimentos WHERE id = ?').get(Number(id)));
}
function excluirDepoimento(req, res, [id]) {
  db.prepare('DELETE FROM depoimentos WHERE id = ?').run(Number(id));
  responder(res, 200, { ok: true });
}

// ---------- configuração do site ----------
const CAMPOS_TEXTO = {
  nomeLoja: 40, barraTopo: 120, linkTopoTexto: 40, fraseHero: 80, mensagemWhatsapp: 300, tituloPecas: 60,
  sobreTitulo: 80, sobreTexto: 4000, email: 120, cnpj: 30, cidade: 80,
};
// Medidas da caixa padrão: [mínimo, máximo] em kg ou cm.
const CAMPOS_PACOTE = { pacotePeso: [0.01, 30], pacoteAltura: [1, 100], pacoteLargura: [8, 100], pacoteComprimento: [13, 100] };
const configPainel = () => ({ ...lerConfig(db), integracoes: { frete: Boolean(process.env.SUPERFRETE_TOKEN), pagamento: pagamentoLigado(), email: emailLigado() } });
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
  if ('cepOrigem' in corpo) {
    const cep = soDigitos(texto(corpo.cepOrigem, 12, 'CEP de origem'));
    if (cep && cep.length !== 8) throw new ErroHttp(400, 'CEP de origem: use os 8 números.');
    mudancas.cepOrigem = cep;
  }
  for (const [campo, [min, max]] of Object.entries(CAMPOS_PACOTE)) {
    if (!(campo in corpo)) continue;
    const n = valor(corpo[campo], 'Medida da caixa');
    if (n === null || n < min || n > max) throw new ErroHttp(400, `Medida da caixa fora do limite (entre ${min} e ${max}).`);
    mudancas[campo] = n;
  }
  if ('freteServicos' in corpo) {
    const servicos = (Array.isArray(corpo.freteServicos) ? corpo.freteServicos : []).map(Number).filter(n => [1, 2, 3, 17, 31, 33].includes(n));
    if (!servicos.length) throw new ErroHttp(400, 'Escolha pelo menos uma forma de envio.');
    mudancas.freteServicos = [...new Set(servicos)].join(',');
  }
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
  responder(res, 200, configPainel());
}

// ---------- páginas ----------
function inicio(req, res) {
  html(res, 200, paginaInicio(lerConfig(db), listarVisiveis(), listarDepoimentos().slice(0, 12)));
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
  ['GET', /^\/checkout\/?$/, (req, res) => {
    const cfg = lerConfig(db);
    res.setHeader('Cache-Control', 'no-store');
    html(res, 200, paginaCheckout(cfg, listarVisiveis(), freteLigado(cfg) && pagamentoLigado(), dadosParaCheckout(sessaoCliente(req))));
  }],
  ['GET', /^\/conta\/?$/, verConta],
  ['GET', /^\/conta\/link\/([A-Za-z0-9_-]{43})$/, (req, res, [token]) => { res.setHeader('Cache-Control', 'no-store'); html(res, 200, paginaLinkEntrada(lerConfig(db), listarVisiveis(), token)); }],
  ['GET', /^\/depoimentos\/?$/, (req, res) => html(res, 200, paginaDepoimentos(lerConfig(db), listarVisiveis(), listarDepoimentos(), sessaoCliente(req)?.nome ?? ''))],
  ['POST', /^\/api\/conta\/criar$/, criarConta],
  ['POST', /^\/api\/conta\/entrar$/, entrarConta],
  ['POST', /^\/api\/conta\/link$/, pedirLink],
  ['POST', /^\/api\/conta\/link\/entrar$/, usarLink],
  ['POST', /^\/api\/conta\/sair$/, sairConta],
  ['PATCH', /^\/api\/conta$/, atualizarConta],
  ['POST', /^\/api\/depoimentos$/, criarDepoimento],
  ['GET', /^\/pedido\/([A-Za-z0-9_-]{12})$/, verPedido],
  ['POST', /^\/api\/frete$/, calcularFrete],
  ['GET', /^\/api\/cep\/(\d{5}-?\d{3})$/, buscarEndereco],
  ['POST', /^\/api\/pedidos$/, criarPedido],
  ['POST', /^\/api\/mercadopago\/aviso$/, avisoMercadoPago],
  ['GET', /^\/admin\/?$/, (req, res) => { res.setHeader('Cache-Control', 'no-store'); html(res, 200, paginaAdmin()); }],
  ['GET', /^\/fotos\/([^/]+)$/, servirFoto],
  ['GET', /^\/static\/(.+)$/, estatico],
  ['GET', /^\/robots\.txt$/, (req, res) => { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('User-agent: *\nDisallow: /admin\nDisallow: /api/\nDisallow: /checkout\nDisallow: /pedido/\nDisallow: /conta\n'); }],
  ['GET', /^\/api\/sessao$/, (req, res) => responder(res, 200, { logado: logado(req), painelLigado: !motivoPainelDesligado(), motivo: motivoPainelDesligado() })],
  ['POST', /^\/api\/entrar$/, entrar],
  ['POST', /^\/api\/sair$/, sair],
  ['GET', /^\/api\/admin\/pecas$/, exigirLogin((req, res) => responder(res, 200, listarTodas()))],
  ['POST', /^\/api\/admin\/pecas$/, exigirLogin(criarPeca)],
  ['PATCH', /^\/api\/admin\/pecas\/(\d+)$/, exigirLogin(editarPeca)],
  ['DELETE', /^\/api\/admin\/pecas\/(\d+)$/, exigirLogin(excluirPeca)],
  ['GET', /^\/api\/admin\/pedidos$/, exigirLogin((req, res) => responder(res, 200, db.prepare('SELECT * FROM pedidos ORDER BY id DESC LIMIT 300').all().map(paraPedido)))],
  ['PATCH', /^\/api\/admin\/pedidos\/(\d+)$/, exigirLogin(editarPedido)],
  ['GET', /^\/api\/admin\/depoimentos$/, exigirLogin((req, res) => responder(res, 200, db.prepare('SELECT * FROM depoimentos ORDER BY aprovado, id DESC LIMIT 500').all()))],
  ['POST', /^\/api\/admin\/depoimentos$/, exigirLogin(criarDepoimentoAdmin)],
  ['PATCH', /^\/api\/admin\/depoimentos\/(\d+)$/, exigirLogin(editarDepoimento)],
  ['DELETE', /^\/api\/admin\/depoimentos\/(\d+)$/, exigirLogin(excluirDepoimento)],
  ['GET', /^\/api\/admin\/aparencia$/, exigirLogin((req, res) => responder(res, 200, configPainel()))],
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
    // O aviso do Mercado Pago vem de fora do site; ele não muda nada sem conferir o pagamento na API deles.
    if (escrita && url.pathname !== '/api/mercadopago/aviso') conferirOrigem(req);
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

setInterval(() => {
  for (const tabela of ['sessoes', 'sessoes_clientes', 'links_entrada']) db.prepare(`DELETE FROM ${tabela} WHERE expira_em < ?`).run(Date.now());
}, 60 * 60 * 1000).unref();
setInterval(() => {
  const agora = Date.now();
  for (const [chave, lista] of janelas) if (!lista.some(t => agora - t < 60 * 60 * 1000)) janelas.delete(chave); // a maior janela usada é de 1 hora
  for (const [ip, lista] of tentativas) if (!lista.some(t => agora - t < 15 * 60 * 1000)) tentativas.delete(ip);
}, 5 * 60 * 1000).unref();

servidor.listen(PORTA, () => {
  console.log(`\n  Loja rodando em http://localhost:${PORTA}`);
  console.log(`  Painel: http://localhost:${PORTA}/admin ${motivoPainelDesligado() ? `(desligado: ${motivoPainelDesligado()})` : ''}`);
  console.log(`  Dados em: ${DADOS}\n`);
});
