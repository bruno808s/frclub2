// E-mails da loja (Brevo). A chave fica só no Render, nunca no código.
// Variáveis: BREVO_API_KEY e EMAIL_REMETENTE (o e-mail cadastrado como remetente no Brevo).
import { esc } from './paginas.js';

const BREVO_URL = (process.env.BREVO_API_URL || 'https://api.brevo.com').replace(/\/$/, ''); // BREVO_API_URL só para testes
const reais = n => Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export const emailLigado = () => Boolean(process.env.BREVO_API_KEY && process.env.EMAIL_REMETENTE);

export async function enviarEmail(cfg, { para, nome, assunto, html, texto }) {
  if (!emailLigado() || !para) return false;
  const r = await fetch(`${BREVO_URL}/v3/smtp/email`, {
    method: 'POST',
    headers: { 'api-key': process.env.BREVO_API_KEY, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sender: { name: cfg.nomeLoja, email: process.env.EMAIL_REMETENTE },
      to: [{ email: para, ...(nome ? { name: nome } : {}) }],
      ...(cfg.email ? { replyTo: { email: cfg.email } } : {}),
      subject: assunto,
      htmlContent: html,
      textContent: texto,
    }),
    signal: AbortSignal.timeout(12 * 1000),
  });
  if (!r.ok) throw new Error(`Brevo respondeu ${r.status}: ${(await r.text().catch(() => '')).slice(0, 300)}`);
  return true;
}

// Envia sem travar a resposta do site; se falhar, só registra nos Logs.
export function enviarDepois(cfg, mensagem) {
  enviarEmail(cfg, mensagem).catch(erro => console.error(`E-mail "${mensagem.assunto}" não saiu:`, erro.message));
}

// ---------- modelo ----------
function moldura(cfg, titulo, conteudo) {
  return `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#f5f5f4;font-family:Helvetica,Arial,sans-serif;color:#000">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f4;padding:32px 12px"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff">
      <tr><td style="background:#000;color:#fff;padding:26px;text-align:center;font-size:20px;letter-spacing:6px;text-transform:uppercase">${esc(cfg.nomeLoja)}</td></tr>
      <tr><td style="padding:32px 28px">
        <h1 style="margin:0 0 18px;font-size:20px;font-weight:500;letter-spacing:2px;text-transform:uppercase">${esc(titulo)}</h1>
        ${conteudo}
      </td></tr>
      <tr><td style="padding:18px 28px;border-top:1px solid #e6e6e4;color:#8a8a86;font-size:12px">
        ${esc(cfg.nomeLoja)}${cfg.whatsapp ? ` · WhatsApp +${esc(cfg.whatsapp)}` : ''}${cfg.instagram ? ` · @${esc(cfg.instagram)}` : ''}
      </td></tr>
    </table>
  </td></tr></table></body></html>`;
}
const paragrafo = t => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#4a4a47">${t}</p>`;
const botao = (link, texto) => `<p style="margin:24px 0"><a href="${esc(link)}" style="display:inline-block;padding:14px 26px;background:#000;color:#fff;text-decoration:none;font-size:13px;letter-spacing:3px;text-transform:uppercase">${esc(texto)}</a></p>`;

function resumo(pedido) {
  const linha = (a, b, forte) => `<tr><td style="padding:8px 0;font-size:14px;${forte ? 'font-weight:600;border-top:1px solid #e6e6e4' : ''}">${a}</td><td align="right" style="padding:8px 0;font-size:14px;white-space:nowrap;${forte ? 'font-weight:600;border-top:1px solid #e6e6e4' : ''}">${b}</td></tr>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 18px;border-top:1px solid #e6e6e4">
    ${pedido.itens.map(i => linha(esc(`${i.quantidade > 1 ? `${i.quantidade}× ` : ''}${i.marca ? `${i.marca} ` : ''}${i.nome}${i.tamanho ? ` · tam. ${i.tamanho}` : ''}`), reais(i.preco * i.quantidade))).join('')}
    ${linha(`Frete · ${esc(pedido.frete_nome)}`, reais(pedido.frete_valor))}
    ${linha('Total', reais(pedido.total), true)}
  </table>`;
}
const endereco = c => esc(`${c.rua}, ${c.numero}${c.complemento ? ` - ${c.complemento}` : ''} · ${c.bairro} · ${c.cidade}/${c.uf}`);
const primeiroNome = nome => String(nome || '').split(' ')[0];

// ---------- mensagens ----------
export function emailPedidoPago(cfg, pedido, base) {
  const link = `${base}/pedido/${pedido.codigo}`;
  return {
    para: pedido.cliente.email,
    nome: pedido.cliente.nome,
    assunto: `Pedido confirmado · ${cfg.nomeLoja}`,
    html: moldura(cfg, 'Pagamento aprovado', `
      ${paragrafo(`Oi, ${esc(primeiroNome(pedido.cliente.nome))}! Recebemos o pagamento do seu pedido <b>${esc(pedido.codigo)}</b>. Já estamos separando tudo com cuidado.`)}
      ${resumo(pedido)}
      ${paragrafo(`Entrega para: ${endereco(pedido.cliente)}`)}
      ${paragrafo('Assim que o pedido for postado, você recebe outro e-mail com o código de rastreio.')}
      ${botao(link, 'Acompanhar pedido')}`),
    texto: `Pagamento aprovado! Pedido ${pedido.codigo}, total ${reais(pedido.total)}. Acompanhe em ${link}`,
  };
}

export function emailNovaVenda(cfg, pedido, base) {
  return {
    para: cfg.email,
    assunto: `Nova venda: ${reais(pedido.total)} · ${pedido.cliente.nome}`,
    html: moldura(cfg, 'Nova venda paga', `
      ${paragrafo(`<b>${esc(pedido.cliente.nome)}</b> pagou o pedido <b>${esc(pedido.codigo)}</b>.`)}
      ${resumo(pedido)}
      ${paragrafo(`Entrega: ${endereco(pedido.cliente)} · CEP ${esc(pedido.cliente.cep)}`)}
      ${botao(`${base}/admin`, 'Abrir o painel')}`),
    texto: `Nova venda: ${pedido.cliente.nome}, ${reais(pedido.total)}. Pedido ${pedido.codigo}. Veja no painel: ${base}/admin`,
  };
}

export function emailPedidoEnviado(cfg, pedido, base) {
  const link = `${base}/pedido/${pedido.codigo}`;
  const rastreio = pedido.rastreio ? `https://rastreamento.correios.com.br/app/index.php?objetos=${encodeURIComponent(pedido.rastreio)}` : '';
  return {
    para: pedido.cliente.email,
    nome: pedido.cliente.nome,
    assunto: `Seu pedido foi enviado · ${cfg.nomeLoja}`,
    html: moldura(cfg, 'Pedido enviado', `
      ${paragrafo(`Oi, ${esc(primeiroNome(pedido.cliente.nome))}! Seu pedido <b>${esc(pedido.codigo)}</b> já está a caminho (${esc(pedido.frete_nome)}).`)}
      ${pedido.rastreio ? paragrafo(`Código de rastreio: <b>${esc(pedido.rastreio)}</b>`) : ''}
      ${botao(rastreio || link, pedido.rastreio ? 'Rastrear entrega' : 'Ver pedido')}
      ${paragrafo(`Quando chegar, conta pra gente como foi: <a href="${esc(`${base}/depoimentos`)}" style="color:#000">deixe seu depoimento</a>.`)}`),
    texto: `Seu pedido ${pedido.codigo} foi enviado.${pedido.rastreio ? ` Rastreio: ${pedido.rastreio}.` : ''} ${link}`,
  };
}

export function emailLinkEntrada(cfg, email, link) {
  return {
    para: email,
    assunto: `Seu link para entrar · ${cfg.nomeLoja}`,
    html: moldura(cfg, 'Entrar na sua conta', `
      ${paragrafo('Clique no botão para entrar na sua conta. O link vale por 30 minutos e só pode ser usado uma vez.')}
      ${botao(link, 'Entrar')}
      ${paragrafo('Se não foi você que pediu, pode ignorar este e-mail.')}`),
    texto: `Entre na sua conta: ${link} (vale por 30 minutos). Se não foi você, ignore este e-mail.`,
  };
}
