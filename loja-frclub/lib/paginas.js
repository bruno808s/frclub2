// Páginas públicas da loja, montadas no servidor (abrem rápido e aparecem bem no Google e no WhatsApp).
import { freteLigado, pagamentoLigado } from './pagamento.js';

const ENT = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ENT[c]);
const reais = n => (typeof n === 'number' ? n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '');
const foto = arquivo => `/fotos/${encodeURIComponent(arquivo)}`;
export const normalizar = t => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

const svg = (corpo, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${corpo}</svg>`;
export const ICONE = {
  instagram: svg('<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r=".6" fill="currentColor"/>'),
  whatsapp: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12.04 2a9.9 9.9 0 0 0-8.5 15l-1.5 5 5.2-1.4A9.9 9.9 0 1 0 12.04 2Zm0 18.1a8.2 8.2 0 0 1-4.2-1.1l-.3-.2-3.1.8.8-3-.2-.3a8.2 8.2 0 1 1 7 3.8Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.4a.5.5 0 0 0 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.1 5.1 0 0 0 1.1 2.7 11.6 11.6 0 0 0 4.4 3.9c1.6.7 2.3.8 3.1.6a2.7 2.7 0 0 0 1.8-1.2 2.2 2.2 0 0 0 .1-1.2c0-.2-.2-.2-.5-.4Z"/></svg>',
  coracao: svg('<path d="M12 20s-7.5-4.6-9.2-9.3C1.6 7.3 3.8 4 7.2 4c2 0 3.6 1.2 4.8 3 1.2-1.8 2.8-3 4.8-3 3.4 0 5.6 3.3 4.4 6.7C19.5 15.4 12 20 12 20Z"/>'),
  sacola: svg('<path d="M5 8h14l-1 13H6L5 8Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>'),
  seta: svg('<path d="m6 9 6 6 6-6"/>'),
  menu: svg('<path d="M3 7h18M3 12h18M3 17h18"/>'),
  fechar: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  voltar: svg('<path d="m15 18-6-6 6-6"/>'),
  escudo: svg('<path d="M12 3 4 6v6c0 4.4 3.4 8.3 8 9 4.6-.7 8-4.6 8-9V6l-8-3Z"/><path d="m9 12 2 2 4-4"/>'),
};

function linkWhats(cfg, texto) {
  if (!cfg.whatsapp) return '#contato';
  return `https://wa.me/${cfg.whatsapp}?text=${encodeURIComponent(texto ?? cfg.mensagemWhatsapp)}`;
}

const checkoutLigado = cfg => freteLigado(cfg) && pagamentoLigado();
// WhatsApp e Instagram só mostram a foto da prévia do link com o endereço completo.
const enderecoCompleto = caminho => `${(process.env.SITE_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '')}${caminho}`;

// Trocas e devoluções: o que o cliente pode pedir e em que pé está.
export const MOTIVOS_DEVOLUCAO = {
  arrependimento: 'Desisti da compra',
  tamanho: 'O tamanho não serviu',
  defeito: 'Veio com defeito ou avaria',
  errado: 'Recebi uma peça diferente',
  outro: 'Outro motivo',
};
export const QUER_DEVOLUCAO = { troca: 'Trocar', reembolso: 'Receber o dinheiro de volta' };
export const STATUS_DEVOLUCAO = {
  aberta: ['Recebemos o seu pedido', 'Vamos responder em até 2 dias úteis, por e-mail.'],
  aprovada: ['Aprovada', 'Siga as instruções abaixo para mandar a peça de volta.'],
  concluida: ['Concluída', 'A troca ou devolução foi finalizada.'],
  recusada: ['Não aprovada', 'Veja o motivo abaixo. Se tiver dúvida, fale com a gente.'],
};
const DIAS_PARA_PEDIR = 120; // conta da data da compra: cobre entrega + os 90 dias de defeito
export const podePedirDevolucao = pedido => ['pago', 'enviado'].includes(pedido.status)
  && Date.now() - new Date(`${String(pedido.criado_em).replace(' ', 'T')}Z`).getTime() < DIAS_PARA_PEDIR * 24 * 60 * 60 * 1000;

// "5571993258590" -> "+55 (71) 99325-8590"
const telefoneBonito = n => String(n).replace(/^55(\d{2})(\d{4,5})(\d{4})$/, '+55 ($1) $2-$3');

// Texto do painel em HTML: "## " é título, "- " é item de lista, linha em branco separa parágrafos.
function textoLongo(texto, cfg) {
  const blocos = [];
  let lista = [];
  const fecharLista = () => { if (lista.length) blocos.push(`<ul>${lista.join('')}</ul>`); lista = []; };
  for (const linha of String(texto || '').replaceAll('{loja}', cfg.nomeLoja).split(/\r?\n/).map(l => l.trim()).filter(Boolean)) {
    if (linha.startsWith('- ')) { lista.push(`<li>${esc(linha.slice(2))}</li>`); continue; }
    fecharLista();
    blocos.push(linha.startsWith('## ') ? `<h2>${esc(linha.slice(3))}</h2>` : `<p>${esc(linha)}</p>`);
  }
  fecharLista();
  return blocos.join('');
}

const unicos = lista => [...new Set(lista.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));

// ---------- moldura comum (barra do topo, cabeçalho, sacola, rodapé, WhatsApp) ----------
// Sem foto própria (página de peça), a prévia do link mostra o logo da loja.
function moldura(cfg, produtos, { titulo, descricao, corpo, sobreFoto = false, imagemOg = '/static/img/compartilhar.jpg' }) {
  const logo = cfg.logo ? foto(cfg.logo) : '/static/img/logo-branca.png';
  const categorias = unicos(produtos.map(p => p.categoria));
  const marcas = unicos(produtos.map(p => p.marca));
  const redes = [
    cfg.instagram && `<a href="https://instagram.com/${esc(cfg.instagram)}" target="_blank" rel="noopener" aria-label="Instagram">${ICONE.instagram}</a>`,
    cfg.whatsapp && `<a href="${esc(linkWhats(cfg))}" target="_blank" rel="noopener" aria-label="WhatsApp">${ICONE.whatsapp}</a>`,
  ].filter(Boolean).join('');
  const linkTopo = cfg.linkTopoUrl || linkWhats(cfg);
  const submenu = (nome, itens, param) => itens.length ? `
      <li class="menu-item tem-sub">
        <a href="/pecas">${esc(nome)}${ICONE.seta}</a>
        <ul class="submenu">
          <li><a href="/pecas">Ver tudo</a></li>
          ${itens.map(i => `<li><a href="/pecas?${param}=${encodeURIComponent(i)}">${esc(i)}</a></li>`).join('')}
        </ul>
      </li>` : '';

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(titulo ? `${titulo} | ${cfg.nomeLoja}` : cfg.nomeLoja)}</title>
  <meta name="description" content="${esc(descricao || cfg.barraTopo)}">
  <meta name="theme-color" content="#000000">
  <meta property="og:type" content="website">
  <meta property="og:title" content="${esc(titulo || cfg.nomeLoja)}">
  <meta property="og:description" content="${esc(descricao || cfg.barraTopo)}">
  ${imagemOg ? `<meta property="og:image" content="${esc(enderecoCompleto(imagemOg))}">` : ''}
  <link rel="icon" href="/favicon.ico" sizes="48x48">
  <link rel="icon" href="/static/img/icone-192.png" type="image/png" sizes="192x192">
  <link rel="apple-touch-icon" href="/static/img/icone-180.png">
  ${cfg.logo ? `<link rel="icon" href="/icone.svg?v=${esc(cfg.logo)}" type="image/svg+xml">` : ''}
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Jost:wght@300;400;500&family=Caveat:wght@500&display=swap">
  <link rel="stylesheet" href="/static/css/loja.css">
</head>
<body class="${sobreFoto ? 'com-hero' : ''}">
  <a class="pular" href="#conteudo">Pular para o conteúdo</a>
  <div class="barra-topo">
    <div class="barra-redes">${redes}${redes ? '<span class="barra-traco" aria-hidden="true"></span>' : ''}</div>
    <p class="barra-texto">${esc(cfg.barraTopo)}</p>
    <a class="barra-link" href="${esc(linkTopo)}" ${linkTopo.startsWith('http') ? 'target="_blank" rel="noopener"' : ''}>${esc(cfg.linkTopoTexto)}</a>
  </div>

  <header class="cabecalho">
    <button class="icone so-celular" type="button" data-abrir-menu aria-label="Abrir menu" aria-expanded="false" aria-controls="menu">${ICONE.menu}</button>
    <a class="logo" href="/" aria-label="${esc(cfg.nomeLoja)}, início"><img src="${esc(logo)}" alt="${esc(cfg.nomeLoja)}" width="96" height="96"></a>
    <nav class="menu" id="menu" aria-label="Principal">
      <button class="icone so-celular menu-fechar" type="button" data-fechar-menu aria-label="Fechar menu">${ICONE.fechar}</button>
      <ul>
        ${submenu('Peças', categorias, 'categoria') || '<li class="menu-item"><a href="/pecas">Peças</a></li>'}
        ${submenu('Marcas', marcas, 'marca')}
        <li class="menu-item"><a href="/#sobre">Sobre a ${esc(cfg.nomeLoja)}</a></li>
      </ul>
    </nav>
    <div class="acoes">
      <a class="icone" href="/favoritos" aria-label="Favoritos">${ICONE.coracao}<span class="contador" data-contador-favoritos hidden></span></a>
      <button class="icone" type="button" data-abrir-sacola aria-label="Sacola">${ICONE.sacola}<span class="contador" data-contador-sacola hidden></span></button>
    </div>
  </header>

  <main id="conteudo">${corpo}</main>

  <footer class="rodape" id="contato">
    <div class="rodape-colunas">
      <div>
        <img class="rodape-logo" src="${esc(logo)}" alt="${esc(cfg.nomeLoja)}" width="72" height="72">
        <div class="rodape-redes">${redes}</div>
      </div>
      <div>
        <h2>Loja</h2>
        <ul>
          <li><a href="/pecas">Todas as peças</a></li>
          <li><a href="/depoimentos">Depoimentos</a></li>
          <li><a href="/#sobre">Sobre</a></li>
          <li><a href="/#duvidas">Dúvidas</a></li>
        </ul>
      </div>
      <div>
        <h2>Atendimento</h2>
        <ul>
          <li><a href="/devolucoes#meus-pedidos">Meus pedidos</a></li>
          <li><a href="/devolucoes">Trocas e devoluções</a></li>
          <li><a href="/termos">Termos de uso e privacidade</a></li>
        </ul>
      </div>
      ${cfg.whatsapp || cfg.email || cfg.cidade ? `
      <div>
        <h2>Contato</h2>
        <ul>
          ${cfg.whatsapp ? `<li><a href="${esc(linkWhats(cfg))}" target="_blank" rel="noopener">${esc(telefoneBonito(cfg.whatsapp))}</a></li>` : ''}
          ${cfg.email ? `<li><a href="mailto:${esc(cfg.email)}">${esc(cfg.email)}</a></li>` : ''}
          ${cfg.cidade ? `<li class="rodape-cidade">${esc(cfg.cidade)}</li>` : ''}
        </ul>
      </div>` : ''}
    </div>
    <p class="rodape-legal">© ${new Date().getFullYear()} ${esc(cfg.nomeLoja)}${cfg.cnpj ? ` · CNPJ ${esc(cfg.cnpj)}` : ''} · <a href="/admin" rel="nofollow">Área do lojista</a></p>
  </footer>

  <div class="sacola" data-sacola hidden>
    <div class="sacola-fundo" data-fechar-sacola></div>
    <aside class="sacola-painel" role="dialog" aria-modal="true" aria-labelledby="sacola-titulo">
      <div class="sacola-cabeca">
        <h2 id="sacola-titulo">Sua sacola</h2>
        <button class="icone" type="button" data-fechar-sacola aria-label="Fechar sacola">${ICONE.fechar}</button>
      </div>
      <div class="sacola-itens" data-sacola-itens></div>
      <div class="sacola-pe" data-sacola-pe></div>
    </aside>
  </div>

  ${cfg.whatsapp ? `<a class="whats-flutuante" href="${esc(linkWhats(cfg))}" target="_blank" rel="noopener" aria-label="Falar no WhatsApp">${ICONE.whatsapp}</a>` : ''}
  <div id="loja-dados" hidden data-whatsapp="${esc(cfg.whatsapp)}" data-loja="${esc(cfg.nomeLoja)}" data-checkout="${checkoutLigado(cfg) ? '1' : ''}"></div>
  <script src="/static/js/loja.js" defer></script>
</body>
</html>`;
}

// ---------- cartão de peça ----------
export function cartao(p) {
  const capa = p.fotos[0];
  const segunda = p.fotos[1];
  return `
  <article class="peca ${p.esgotado ? 'esgotada' : ''}">
    <a class="peca-foto" href="/peca/${esc(p.slug)}">
      ${capa ? `<img src="${foto(capa)}" alt="${esc(`${p.marca} ${p.nome}`)}" loading="lazy" width="800" height="1000">` : '<span class="sem-foto">Sem foto</span>'}
      ${segunda ? `<img class="foto-2" src="${foto(segunda)}" alt="" loading="lazy" width="800" height="1000">` : ''}
      ${p.esgotado ? '<span class="selo-peca">Esgotado</span>' : p.peca_unica ? '<span class="selo-peca">Peça única</span>' : ''}
    </a>
    <button class="favoritar" type="button" data-favoritar="${p.id}" aria-label="Favoritar ${esc(p.nome)}" aria-pressed="false">${ICONE.coracao}</button>
    <div class="peca-info">
      ${p.marca ? `<p class="peca-marca">${esc(p.marca)}</p>` : ''}
      <h3><a href="/peca/${esc(p.slug)}">${esc(p.nome)}</a></h3>
      ${p.estado || p.tamanhos.length ? `<p class="peca-detalhe">${esc([p.tamanhos.length ? `Tam. ${p.tamanhos.join(', ')}` : '', p.estado].filter(Boolean).join(' · '))}</p>` : ''}
      <p class="peca-preco">${p.preco_antigo ? `<s>${reais(p.preco_antigo)}</s>` : ''}${p.preco != null ? reais(p.preco) : 'Consulte'}</p>
    </div>
  </article>`;
}

// ---------- depoimentos ----------
const estrelas = nota => `<p class="estrelas" aria-label="${nota} de 5 estrelas">${'★'.repeat(nota)}<span aria-hidden="true">${'★'.repeat(5 - nota)}</span></p>`;
const quando = data => new Date(`${String(data).replace(' ', 'T')}Z`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' });
function cartaoDepoimento(d) {
  return `
  <figure class="depoimento">
    ${estrelas(d.nota)}
    <blockquote>${String(d.texto).split(/\n+/).filter(Boolean).map(par => `<p>${esc(par)}</p>`).join('')}</blockquote>
    <figcaption><span><b>${esc(d.nome)}</b>${d.cidade ? ` · ${esc(d.cidade)}` : ''}</span><span class="depoimento-data">${esc(quando(d.criado_em))}</span></figcaption>
  </figure>`;
}

// ---------- início ----------
export function paginaInicio(cfg, produtos, depoimentos = []) {
  const heroPc = cfg.heroDesktop ? foto(cfg.heroDesktop) : '/static/img/hero-padrao-pc.jpg';
  const heroCel = cfg.heroMobile ? foto(cfg.heroMobile) : cfg.heroDesktop ? heroPc : '/static/img/hero-padrao-celular.jpg';
  const logo = cfg.logo ? foto(cfg.logo) : '/static/img/logo-branca.png';
  const ultimas = produtos.slice(0, 8);
  const destaques = produtos.filter(p => p.destaque).slice(0, 8);
  const corpo = `
  <section class="hero ${cfg.heroPretoBranco ? 'pb' : ''}" aria-label="${esc(cfg.nomeLoja)}">
    <picture class="hero-foto">
      <source media="(max-width: 760px)" srcset="${esc(heroCel)}">
      <img src="${esc(heroPc)}" alt="" fetchpriority="high">
    </picture>
    <div class="hero-centro">
      ${cfg.mostrarLogoHero ? `<img class="hero-logo" src="${esc(logo)}" alt="${esc(cfg.nomeLoja)}" width="320" height="320">` : `<h1 class="hero-nome">${esc(cfg.nomeLoja)}</h1>`}
      ${cfg.fraseHero ? `<p class="hero-frase">${esc(cfg.fraseHero)}</p>` : ''}
    </div>
    ${cfg.mostrarLogoHero ? `<h1 class="visualmente-oculto">${esc(cfg.nomeLoja)}</h1>` : ''}
  </section>

  <section class="secao" aria-labelledby="ultimas">
    <div class="secao-cabeca">
      <h2 id="ultimas">${esc(cfg.tituloPecas)}</h2>
      <a class="link-linha" href="/pecas">Ver todas as peças</a>
    </div>
    ${ultimas.length ? `<div class="grade">${ultimas.map(cartao).join('')}</div>` : '<p class="vazio">As peças aparecem aqui assim que forem cadastradas no painel.</p>'}
  </section>

  ${destaques.length ? `
  <section class="secao secao-cinza" aria-labelledby="destaques">
    <div class="secao-cabeca"><h2 id="destaques">Destaques</h2></div>
    <div class="trilho">${destaques.map(cartao).join('')}</div>
  </section>` : ''}

  ${depoimentos.length ? `
  <section class="secao" aria-labelledby="depoimentos-titulo">
    <div class="secao-cabeca">
      <h2 id="depoimentos-titulo">Depoimentos</h2>
      <a class="link-linha" href="/depoimentos">Ver todos</a>
    </div>
    <div class="trilho trilho-depoimentos">${depoimentos.map(cartaoDepoimento).join('')}</div>
  </section>` : ''}

  ${cfg.selos?.filter(Boolean).length ? `
  <section class="selos" aria-label="Por que comprar com a gente">
    ${cfg.selos.filter(Boolean).map(s => `<p>${esc(s)}</p>`).join('')}
  </section>` : ''}

  <section class="secao sobre" id="sobre" aria-labelledby="sobre-titulo">
    <h2 id="sobre-titulo">${esc(cfg.sobreTitulo)}</h2>
    ${String(cfg.sobreTexto || '').split(/\n+/).filter(Boolean).map(par => `<p>${esc(par)}</p>`).join('')}
  </section>

  ${cfg.faq?.length ? `
  <section class="secao duvidas" id="duvidas" aria-labelledby="duvidas-titulo">
    <h2 id="duvidas-titulo">Perguntas frequentes</h2>
    <div class="faq">${cfg.faq.map(f => `<details><summary>${esc(f.p)}</summary><p>${esc(f.r)}</p></details>`).join('')}</div>
  </section>` : ''}`;
  return moldura(cfg, produtos, { corpo, sobreFoto: true });
}

// ---------- catálogo ----------
const ORDENS = {
  novidades: { nome: 'Mais recentes', f: (a, b) => b.id - a.id },
  menor: { nome: 'Menor preço', f: (a, b) => (a.preco ?? Infinity) - (b.preco ?? Infinity) },
  maior: { nome: 'Maior preço', f: (a, b) => (b.preco ?? -1) - (a.preco ?? -1) },
};
export function paginaCatalogo(cfg, produtos, { categoria = '', marca = '', ordem = 'novidades', busca = '' }) {
  const termo = normalizar(busca);
  const lista = produtos
    .filter(p => (!categoria || p.categoria === categoria) && (!marca || p.marca === marca)
      && (!termo || normalizar(`${p.nome} ${p.marca} ${p.categoria}`).includes(termo)))
    .sort((ORDENS[ordem] ?? ORDENS.novidades).f);
  const titulo = categoria || marca || (busca ? `Busca: ${busca}` : 'Todas as peças');
  const url = mudar => {
    const q = new URLSearchParams({ categoria, marca, ordem, busca, ...mudar });
    for (const [k, v] of [...q]) if (!v || (k === 'ordem' && v === 'novidades')) q.delete(k);
    return `/pecas${q.toString() ? `?${q}` : ''}`;
  };
  const filtro = (nome, itens, chave, atual) => itens.length > 1 ? `
    <div class="filtro">
      <span>${nome}</span>
      <a href="${url({ [chave]: '' })}" ${!atual ? 'aria-current="true"' : ''}>Todas</a>
      ${itens.map(i => `<a href="${url({ [chave]: i })}" ${i === atual ? 'aria-current="true"' : ''}>${esc(i)}</a>`).join('')}
    </div>` : '';
  const corpo = `
  <section class="secao catalogo">
    <div class="catalogo-cabeca">
      <h1>${esc(titulo)}</h1>
      <p class="nota">${lista.length} ${lista.length === 1 ? 'peça' : 'peças'}</p>
    </div>
    <div class="filtros">
      ${filtro('Categoria', unicos(produtos.map(p => p.categoria)), 'categoria', categoria)}
      ${filtro('Marca', unicos(produtos.map(p => p.marca)), 'marca', marca)}
      <div class="filtro">
        <span>Ordenar</span>
        ${Object.entries(ORDENS).map(([id, o]) => `<a href="${url({ ordem: id })}" ${id === ordem ? 'aria-current="true"' : ''}>${o.nome}</a>`).join('')}
      </div>
    </div>
    ${lista.length ? `<div class="grade">${lista.map(cartao).join('')}</div>` : `<p class="vazio">Nenhuma peça encontrada. <a href="/pecas">Ver todas</a></p>`}
  </section>`;
  return moldura(cfg, produtos, { titulo, corpo });
}

// ---------- peça ----------
export function paginaPeca(cfg, produtos, p) {
  const relacionados = produtos.filter(o => o.id !== p.id && (o.categoria === p.categoria || o.marca === p.marca)).slice(0, 4);
  const mensagem = `Olá! Tenho interesse na peça ${p.nome}${p.marca ? ` da ${p.marca}` : ''}.`;
  const corpo = `
  <section class="secao peca-pagina">
    <a class="voltar" href="/pecas">${ICONE.voltar}Todas as peças</a>
    <div class="peca-grade">
      <div class="galeria" data-galeria>
        <div class="galeria-principal">
          ${p.fotos[0] ? `<img src="${foto(p.fotos[0])}" alt="${esc(`${p.marca} ${p.nome}`)}" data-galeria-principal width="1000" height="1250">` : '<span class="sem-foto">Sem foto</span>'}
        </div>
        ${p.fotos.length > 1 ? `<div class="galeria-miniaturas">${p.fotos.map((f, i) => `<button type="button" data-foto="${foto(f)}" aria-label="Ver foto ${i + 1}" ${i === 0 ? 'aria-current="true"' : ''}><img src="${foto(f)}" alt="" loading="lazy"></button>`).join('')}</div>` : ''}
      </div>
      <div class="peca-texto">
        ${p.peca_unica && !p.esgotado ? '<p class="selo-texto">Peça única</p>' : ''}
        ${p.marca ? `<p class="peca-marca">${esc(p.marca)}</p>` : ''}
        <h1>${esc(p.nome)}</h1>
        <p class="peca-preco grande">${p.preco_antigo ? `<s>${reais(p.preco_antigo)}</s>` : ''}${p.preco != null ? reais(p.preco) : 'Consulte o valor'}</p>
        ${p.estado ? `<p class="peca-estado">Estado: ${esc(p.estado)}</p>` : ''}
        <form class="comprar-form" data-comprar data-id="${p.id}" data-slug="${esc(p.slug)}" data-nome="${esc(p.nome)}" data-marca="${esc(p.marca)}" data-preco="${p.preco ?? ''}" data-foto="${p.fotos[0] ? foto(p.fotos[0]) : ''}">
          ${p.tamanhos.length ? `
          <fieldset class="tamanhos">
            <legend>Tamanho</legend>
            ${p.tamanhos.map((t, i) => `<label><input type="radio" name="tamanho" value="${esc(t)}" ${p.tamanhos.length === 1 ? 'checked' : ''} ${p.esgotado ? 'disabled' : ''}><span>${esc(t)}</span></label>`).join('')}
          </fieldset>` : ''}
          <p class="form-erro" role="alert" hidden></p>
          ${p.esgotado
            ? '<p class="esgotado-aviso">Esta peça esgotou.</p>'
            : checkoutLigado(cfg) && p.preco > 0
              ? `<button class="botao" type="submit" data-comprar-agora>Comprar agora</button>
                 <button class="botao botao-linha" type="submit">Adicionar à sacola</button>`
              : `<button class="botao" type="submit">Adicionar à sacola</button>
                 ${p.link_pagamento ? `<a class="botao botao-linha" href="${esc(p.link_pagamento)}" target="_blank" rel="noopener">Comprar agora</a>` : ''}`}
          <a class="botao botao-linha" href="${esc(linkWhats(cfg, mensagem))}" target="_blank" rel="noopener">${p.esgotado ? 'Avise-me quando chegar' : 'Tirar dúvida no WhatsApp'}</a>
          <button class="favoritar-texto" type="button" data-favoritar="${p.id}" aria-pressed="false">${ICONE.coracao}<span>Favoritar</span></button>
        </form>
        ${freteLigado(cfg) && !p.esgotado && p.preco > 0 ? `
        <form class="frete-form" data-frete-peca="${p.id}" novalidate>
          <label for="cep-peca">Calcular frete</label>
          <div class="frete-linha">
            <input id="cep-peca" name="cep" inputmode="numeric" autocomplete="postal-code" placeholder="00000-000" maxlength="9" data-cep>
            <button class="botao botao-linha" type="submit">Calcular</button>
          </div>
          <a class="nota" href="https://buscacepinter.correios.com.br/app/endereco/index.php" target="_blank" rel="noopener">Não sei meu CEP</a>
          <div class="frete-opcoes" data-frete-resultado aria-live="polite"></div>
        </form>` : ''}
        ${p.descricao ? `<div class="peca-descricao">${String(p.descricao).split(/\n+/).filter(Boolean).map(par => `<p>${esc(par)}</p>`).join('')}</div>` : ''}
      </div>
    </div>
  </section>
  ${relacionados.length ? `
  <section class="secao" aria-labelledby="relacionados">
    <div class="secao-cabeca"><h2 id="relacionados">Você também pode gostar</h2></div>
    <div class="grade">${relacionados.map(cartao).join('')}</div>
  </section>` : ''}`;
  return moldura(cfg, produtos, { titulo: `${p.marca ? `${p.marca} ` : ''}${p.nome}`, descricao: p.descricao?.slice(0, 160), corpo, imagemOg: p.fotos[0] ? foto(p.fotos[0]) : undefined });
}

// ---------- checkout (a sacola vem do aparelho; o servidor confere preço e frete) ----------
const campo = (nome, rotulo, extra = '', classe = '') => `<label class="campo ${classe}"><span>${rotulo}</span><input name="${nome}" ${extra}><small class="campo-erro" hidden></small></label>`;
export function paginaCheckout(cfg, produtos, ligado) {
  const corpo = ligado ? `
  <section class="secao checkout">
    <div class="catalogo-cabeca"><h1>Finalizar compra</h1></div>
    <form class="checkout-grade" data-checkout novalidate>
      <div class="checkout-dados">
        <fieldset>
          <legend>Seus dados</legend>
          ${campo('nome', 'Nome completo', 'autocomplete="name" maxlength="120" required', 'largo')}
          ${campo('email', 'E-mail', 'type="email" autocomplete="email" maxlength="120" required')}
          ${campo('telefone', 'Celular com DDD', 'type="tel" autocomplete="tel" inputmode="tel" maxlength="20" required data-telefone')}
          ${campo('cpf', 'CPF', 'inputmode="numeric" maxlength="14" placeholder="000.000.000-00" required data-cpf')}
        </fieldset>
        <fieldset>
          <legend>Entrega</legend>
          ${campo('cep', 'CEP', 'inputmode="numeric" autocomplete="postal-code" maxlength="9" placeholder="00000-000" required data-cep')}
          ${campo('rua', 'Rua', 'autocomplete="address-line1" maxlength="120" required', 'largo')}
          ${campo('numero', 'Número', 'maxlength="20" required')}
          ${campo('complemento', 'Complemento (opcional)', 'autocomplete="address-line2" maxlength="80"')}
          ${campo('bairro', 'Bairro', 'maxlength="80" required')}
          ${campo('cidade', 'Cidade', 'autocomplete="address-level2" maxlength="80" required')}
          ${campo('uf', 'Estado (sigla)', 'autocomplete="address-level1" maxlength="2" required')}
        </fieldset>
        <fieldset>
          <legend>Forma de entrega</legend>
          <div class="frete-opcoes" data-frete-resultado aria-live="polite"><p class="nota">Digite o CEP para ver as opções.</p></div>
        </fieldset>
      </div>
      <aside class="checkout-resumo">
        <h2>Resumo</h2>
        <div data-resumo-itens></div>
        <p class="resumo-linha"><span>Peças</span><span data-subtotal>—</span></p>
        <p class="resumo-linha"><span>Frete</span><span data-valor-frete>—</span></p>
        <p class="resumo-linha total"><span>Total</span><span data-total>—</span></p>
        <p class="form-erro" role="alert" hidden></p>
        <button class="botao" type="submit">Ir para o pagamento</button>
        <p class="nota">Você paga com Pix, cartão em até 12x ou boleto no ambiente seguro do Mercado Pago.</p>
      </aside>
    </form>
  </section>` : `
  <section class="secao catalogo">
    <div class="catalogo-cabeca"><h1>Finalizar compra</h1></div>
    <p class="vazio">O pagamento pelo site ainda não está ligado. Abra a sacola e finalize pelo WhatsApp.</p>
  </section>`;
  return moldura(cfg, produtos, { titulo: 'Finalizar compra', corpo });
}

const NOME_STATUS = {
  aguardando: ['Aguardando pagamento', 'Assim que o pagamento for aprovado, esta página muda sozinha. Pix costuma cair na hora; boleto, em até 3 dias úteis.'],
  pago: ['Pagamento aprovado', 'Obrigado! Já estamos separando o seu pedido. Você recebe o código de rastreio quando ele for enviado.'],
  enviado: ['Pedido enviado', 'Seu pedido já está a caminho.'],
  cancelado: ['Pedido cancelado', 'Se tiver alguma dúvida, fale com a gente.'],
};
export function paginaPedido(cfg, produtos, pedido, devolucao = null) {
  const [titulo, texto] = NOME_STATUS[pedido.status] ?? NOME_STATUS.aguardando;
  const recusado = pedido.status === 'aguardando' && ['rejected', 'cancelled'].includes(pedido.mp_status);
  const corpo = `
  <section class="secao checkout pedido" ${pedido.status === 'aguardando' ? 'data-atualizar' : ''} ${['pago', 'enviado'].includes(pedido.status) ? 'data-pago' : ''}>
    <p class="peca-marca">Pedido ${esc(pedido.codigo)}</p>
    <h1>${recusado ? 'Pagamento não aprovado' : titulo}</h1>
    <p>${recusado ? 'O pagamento foi recusado. Tente de novo com outra forma de pagamento.' : texto}</p>
    ${pedido.rastreio ? `<p>Código de rastreio: <b>${esc(pedido.rastreio)}</b></p>` : ''}
    ${pedido.status === 'aguardando' && pedido.mp_link ? `<a class="botao" href="${esc(pedido.mp_link)}">${recusado ? 'Tentar pagar de novo' : 'Pagar agora'}</a>` : ''}
    <div class="checkout-resumo">
      ${pedido.itens.map(i => `
        <div class="resumo-item">
          ${i.foto ? `<img src="${esc(i.foto)}" alt="">` : '<span class="sem-img"></span>'}
          <div><p>${esc(`${i.marca ? `${i.marca} ` : ''}${i.nome}`)}</p>${i.tamanho ? `<p class="nota">Tamanho ${esc(i.tamanho)}</p>` : ''}${i.quantidade > 1 ? `<p class="nota">${i.quantidade} unidades</p>` : ''}</div>
          <span>${reais(i.preco * i.quantidade)}</span>
        </div>`).join('')}
      <p class="resumo-linha"><span>Peças</span><span>${reais(pedido.subtotal)}</span></p>
      <p class="resumo-linha"><span>Frete · ${esc(pedido.frete_nome)}${pedido.frete_prazo ? ` · até ${pedido.frete_prazo} dias úteis` : ''}</span><span>${reais(pedido.frete_valor)}</span></p>
      <p class="resumo-linha total"><span>Total</span><span>${reais(pedido.total)}</span></p>
    </div>
    <p class="nota">Entrega para ${esc(pedido.cliente.nome)} · ${esc(`${pedido.cliente.rua}, ${pedido.cliente.numero} · ${pedido.cliente.cidade}/${pedido.cliente.uf}`)}</p>
    ${blocoDevolucao(pedido, devolucao)}
    ${cfg.whatsapp ? `<a class="botao botao-linha" href="${esc(linkWhats(cfg, `Olá! Sobre o meu pedido ${pedido.codigo}.`))}" target="_blank" rel="noopener">Falar no WhatsApp</a>` : ''}
  </section>`;
  return moldura(cfg, produtos, { titulo, corpo });
}

function blocoDevolucao(pedido, d) {
  // Pedido em andamento (ou fora do prazo de pedir outro): mostra a situação; senão, o formulário.
  if (d && (['aberta', 'aprovada'].includes(d.status) || !podePedirDevolucao(pedido))) {
    const [titulo, texto] = STATUS_DEVOLUCAO[d.status] ?? STATUS_DEVOLUCAO.aberta;
    return `
    <div class="devolucao-caixa" id="devolucao">
      <p class="peca-marca">Troca ou devolução</p>
      <h2>${esc(titulo)}</h2>
      <p>${esc(texto)}</p>
      <p class="nota">${esc(QUER_DEVOLUCAO[d.quer] ?? d.quer)} · ${esc(MOTIVOS_DEVOLUCAO[d.motivo] ?? d.motivo)} · ${esc(d.itens.join(', '))}</p>
      ${d.resposta ? `<div class="devolucao-resposta">${d.resposta.split(/\n+/).filter(Boolean).map(par => `<p>${esc(par)}</p>`).join('')}</div>` : ''}
    </div>`;
  }
  if (!podePedirDevolucao(pedido)) return '';
  const nomeItem = i => `${i.nome}${i.marca ? ` da ${i.marca}` : ''}${i.tamanho ? ` · tam. ${i.tamanho}` : ''}`;
  const anterior = d ? `<p class="nota">O pedido anterior ficou como "${esc(STATUS_DEVOLUCAO[d.status][0])}". Se precisar, faça um novo.</p>` : '';
  return `
    <details class="devolucao-caixa" id="devolucao">
      <summary>Pedir troca ou devolução</summary>
      ${anterior}
      <p class="nota">Antes, veja as regras em <a class="sublinhado" href="/devolucoes" target="_blank" rel="noopener">Trocas e devoluções</a>.</p>
      <form class="devolucao-form" data-devolucao="${esc(pedido.codigo)}" novalidate>
        <fieldset>
          <legend>Quais peças?</legend>
          ${pedido.itens.map((i, n) => `<label class="opcao"><input type="checkbox" name="itens" value="${n}" ${pedido.itens.length === 1 ? 'checked' : ''}><span>${esc(nomeItem(i))}</span></label>`).join('')}
        </fieldset>
        <label class="campo"><span>O que você quer?</span><select name="quer">${Object.entries(QUER_DEVOLUCAO).map(([id, nome]) => `<option value="${id}">${esc(nome)}</option>`).join('')}</select></label>
        <label class="campo"><span>Motivo</span><select name="motivo">${Object.entries(MOTIVOS_DEVOLUCAO).map(([id, nome]) => `<option value="${id}">${esc(nome)}</option>`).join('')}</select></label>
        <label class="campo largo"><span>Conte o que aconteceu (opcional)</span><textarea name="mensagem" rows="4" maxlength="1000" placeholder="Ex.: queria trocar pelo tamanho G"></textarea></label>
        <p class="form-erro" role="alert" hidden></p>
        <button class="botao" type="submit">Enviar pedido de troca ou devolução</button>
        <p class="nota">Se a peça veio com defeito, mande fotos pelo WhatsApp depois de enviar.</p>
      </form>
    </details>`;
}

// ---------- trocas e devoluções, termos ----------
export function paginaDevolucoes(cfg, produtos, emailLigado) {
  const corpo = `
  <section class="secao catalogo politica">
    <div class="catalogo-cabeca"><h1>Trocas e devoluções</h1></div>
    <div class="politica-caixa" id="meus-pedidos">
      <h2>Meus pedidos</h2>
      ${emailLigado ? `
      <p>Para pedir uma troca ou devolução, abra a página do seu pedido. Não achou o link? Digite o e-mail usado na compra e mandamos os links de todos os seus pedidos.</p>
      <form class="meus-pedidos-form" data-meus-pedidos novalidate>
        <label class="campo"><span>E-mail da compra</span><input name="email" type="email" autocomplete="email" maxlength="120" required><small class="campo-erro" hidden></small></label>
        <button class="botao" type="submit">Receber os links</button>
        <p class="form-erro" role="alert" hidden></p>
        <p class="form-ok" role="status" hidden></p>
      </form>` : `<p>Para pedir uma troca ou devolução, abra a página do seu pedido pelo link do e-mail de confirmação${cfg.whatsapp ? ', ou fale com a gente no WhatsApp' : ''}.</p>`}
      ${cfg.whatsapp ? `<a class="botao botao-linha" href="${esc(linkWhats(cfg, 'Olá! Preciso de ajuda com uma troca ou devolução.'))}" target="_blank" rel="noopener">Falar no WhatsApp</a>` : ''}
    </div>
    <div class="politica-texto">${textoLongo(cfg.textoDevolucoes, cfg)}</div>
  </section>`;
  return moldura(cfg, produtos, { titulo: 'Trocas e devoluções', descricao: `Como trocar ou devolver uma compra da ${cfg.nomeLoja}.`, corpo });
}

export function paginaTermos(cfg, produtos) {
  const corpo = `
  <section class="secao catalogo politica">
    <div class="catalogo-cabeca"><h1>Termos de uso e privacidade</h1></div>
    <div class="politica-texto">
      ${textoLongo(cfg.textoTermos, cfg)}
      ${cfg.email || cfg.whatsapp || cfg.cnpj ? `<h2>Contato</h2><p>${esc([cfg.nomeLoja, cfg.cnpj && `CNPJ ${cfg.cnpj}`, cfg.email, cfg.whatsapp && telefoneBonito(cfg.whatsapp), cfg.cidade].filter(Boolean).join(' · '))}</p>` : ''}
    </div>
  </section>`;
  return moldura(cfg, produtos, { titulo: 'Termos de uso e privacidade', corpo });
}

export function paginaDepoimentos(cfg, produtos, depoimentos) {
  const media = depoimentos.length ? depoimentos.reduce((t, d) => t + d.nota, 0) / depoimentos.length : 0;
  const corpo = `
  <section class="secao catalogo">
    <div class="catalogo-cabeca">
      <h1>Depoimentos</h1>
      ${depoimentos.length ? `<p class="nota">${media.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} de 5 · ${depoimentos.length} ${depoimentos.length === 1 ? 'avaliação' : 'avaliações'}</p>` : ''}
    </div>
    ${depoimentos.length ? `<div class="grade-depoimentos">${depoimentos.map(cartaoDepoimento).join('')}</div>` : '<p class="vazio">Os depoimentos aparecem aqui em breve.</p>'}
  </section>`;
  return moldura(cfg, produtos, { titulo: 'Depoimentos', descricao: `O que dizem os clientes da ${cfg.nomeLoja}.`, corpo });
}

// ---------- favoritos (a lista fica no aparelho de quem visita) ----------
export function paginaFavoritos(cfg, produtos) {
  const corpo = `
  <section class="secao catalogo">
    <div class="catalogo-cabeca"><h1>Favoritos</h1></div>
    <div class="grade" data-lista-favoritos></div>
    <p class="vazio" data-favoritos-vazio hidden>Você ainda não favoritou nenhuma peça. Toque no coração de uma peça para guardar aqui.</p>
    <template data-todas>${produtos.map(p => `<div data-id="${p.id}">${cartao(p)}</div>`).join('')}</template>
  </section>`;
  return moldura(cfg, produtos, { titulo: 'Favoritos', corpo });
}

export function pagina404(cfg, produtos) {
  const corpo = `
  <section class="secao catalogo">
    <div class="catalogo-cabeca"><h1>Página não encontrada</h1></div>
    <p class="vazio">Essa página não existe ou a peça saiu do ar. <a href="/pecas">Ver todas as peças</a></p>
  </section>`;
  return moldura(cfg, produtos, { titulo: 'Não encontrada', corpo });
}

// ---------- painel (a tela é montada pelo admin.js) ----------
export function paginaAdmin() {
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>Painel da loja</title>
  <link rel="icon" href="/favicon.ico" sizes="48x48">
  <link rel="icon" href="/static/img/icone-192.png" type="image/png" sizes="192x192">
  <link rel="apple-touch-icon" href="/static/img/icone-180.png">
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Jost:wght@300;400;500&display=swap">
  <link rel="stylesheet" href="/static/css/admin.css">
</head>
<body>
  <div id="painel"></div>
  <script type="module" src="/static/js/admin.js"></script>
</body>
</html>`;
}
