// Loja: menu do celular, sacola, favoritos e galeria. A sacola e os favoritos ficam no aparelho de quem visita.
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const dados = $('#loja-dados').dataset;
  const reais = n => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ler = (chave, padrao) => { try { return JSON.parse(localStorage.getItem(chave)) ?? padrao; } catch { return padrao; } };
  const gravar = (chave, valor) => { try { localStorage.setItem(chave, JSON.stringify(valor)); } catch {} };

  // ---------- menu do celular ----------
  const menu = $('#menu');
  const botaoMenu = $('[data-abrir-menu]');
  const celular = () => matchMedia('(max-width: 860px)').matches;
  botaoMenu?.addEventListener('click', () => { menu.classList.add('aberto'); botaoMenu.setAttribute('aria-expanded', 'true'); document.body.style.overflow = 'hidden'; });
  $('[data-fechar-menu]')?.addEventListener('click', fecharMenu);
  function fecharMenu() { menu.classList.remove('aberto'); botaoMenu?.setAttribute('aria-expanded', 'false'); document.body.style.overflow = ''; }
  $$('.tem-sub > a').forEach(a => a.addEventListener('click', e => {
    if (!celular()) return;
    e.preventDefault();
    a.parentElement.classList.toggle('aberto');
  }));
  $$('.menu a[href^="/#"]').forEach(a => a.addEventListener('click', fecharMenu));

  // ---------- favoritos ----------
  let favoritos = ler('frclub-favoritos', []);
  function marcarFavoritos() {
    $$('[data-favoritar]').forEach(b => b.setAttribute('aria-pressed', String(favoritos.includes(Number(b.dataset.favoritar)))));
    const c = $('[data-contador-favoritos]');
    c.textContent = favoritos.length;
    c.hidden = !favoritos.length;
  }
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-favoritar]');
    if (!b) return;
    e.preventDefault();
    const id = Number(b.dataset.favoritar);
    favoritos = favoritos.includes(id) ? favoritos.filter(x => x !== id) : [...favoritos, id];
    gravar('frclub-favoritos', favoritos);
    marcarFavoritos();
    if ($('[data-lista-favoritos]')) mostrarFavoritos();
  });
  function mostrarFavoritos() {
    const lista = $('[data-lista-favoritos]');
    const todas = $('[data-todas]').content;
    lista.innerHTML = '';
    for (const id of favoritos) {
      const item = todas.querySelector(`[data-id="${id}"] .peca`);
      if (item) lista.append(item.cloneNode(true));
    }
    $('[data-favoritos-vazio]').hidden = lista.children.length > 0;
    marcarFavoritos();
  }
  if ($('[data-lista-favoritos]')) mostrarFavoritos();
  marcarFavoritos();

  // ---------- sacola ----------
  let sacola = ler('frclub-sacola', []);
  const caixa = $('[data-sacola]');
  function abrirSacola() { desenharSacola(); caixa.hidden = false; document.body.style.overflow = 'hidden'; $('.sacola-cabeca .icone', caixa).focus(); }
  function fecharSacola() { caixa.hidden = true; document.body.style.overflow = ''; }
  $('[data-abrir-sacola]').addEventListener('click', abrirSacola);
  $$('[data-fechar-sacola]').forEach(b => b.addEventListener('click', fecharSacola));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { fecharSacola(); fecharMenu(); } });

  function contarSacola() {
    const c = $('[data-contador-sacola]');
    c.textContent = sacola.length;
    c.hidden = !sacola.length;
  }
  function desenharSacola() {
    const itens = $('[data-sacola-itens]');
    const pe = $('[data-sacola-pe]');
    if (!sacola.length) {
      itens.innerHTML = '<p class="sacola-vazia">Sua sacola está vazia.</p>';
      pe.innerHTML = '<a class="botao" href="/pecas">Ver as peças</a>';
      return;
    }
    itens.innerHTML = sacola.map((p, i) => `
      <div class="sacola-item">
        ${p.foto ? `<img src="${esc(p.foto)}" alt="">` : '<span class="sem-img"></span>'}
        <div>
          ${p.marca ? `<p class="peca-marca">${esc(p.marca)}</p>` : ''}
          <p><a href="/peca/${esc(p.slug)}">${esc(p.nome)}</a></p>
          ${p.tamanho ? `<p class="nota">Tamanho ${esc(p.tamanho)}</p>` : ''}
          <p>${p.preco ? reais(p.preco) : 'Consulte'}</p>
        </div>
        <button type="button" data-remover="${i}">Remover</button>
      </div>`).join('');
    const total = sacola.reduce((t, p) => t + (p.preco || 0), 0);
    pe.innerHTML = `
      <p class="sacola-total"><span>Total</span><span>${reais(total)}</span></p>
      <a class="botao" href="${esc(linkPedido())}" target="_blank" rel="noopener">Finalizar pelo WhatsApp</a>
      <p class="nota">A gente confirma a disponibilidade, o frete e envia o pagamento.</p>`;
    $$('[data-remover]', itens).forEach(b => b.addEventListener('click', () => {
      sacola.splice(Number(b.dataset.remover), 1);
      gravar('frclub-sacola', sacola);
      contarSacola();
      desenharSacola();
    }));
  }
  function linkPedido() {
    const linhas = sacola.map(p => `• ${p.marca ? `${p.marca} ` : ''}${p.nome}${p.tamanho ? ` (tam. ${p.tamanho})` : ''}${p.preco ? ` - ${reais(p.preco)}` : ''}`);
    const total = sacola.reduce((t, p) => t + (p.preco || 0), 0);
    const texto = `Olá! Quero fazer um pedido na ${dados.loja}:\n${linhas.join('\n')}\nTotal: ${reais(total)}`;
    return dados.whatsapp ? `https://wa.me/${dados.whatsapp}?text=${encodeURIComponent(texto)}` : '/#contato';
  }
  contarSacola();

  // ---------- página da peça ----------
  const form = $('[data-comprar]');
  form?.addEventListener('submit', e => {
    e.preventDefault();
    const erro = $('.form-erro', form);
    const temTamanhos = $('.tamanhos', form);
    const tamanho = form.tamanho?.value || (form.querySelector('input[name="tamanho"]:checked')?.value ?? '');
    if (temTamanhos && !tamanho) {
      erro.textContent = 'Escolha o tamanho.';
      erro.hidden = false;
      return;
    }
    erro.hidden = true;
    const d = form.dataset;
    sacola.push({ id: Number(d.id), slug: d.slug, nome: d.nome, marca: d.marca, preco: d.preco ? Number(d.preco) : null, foto: d.foto, tamanho });
    gravar('frclub-sacola', sacola);
    contarSacola();
    abrirSacola();
  });

  const principal = $('[data-galeria-principal]');
  $$('[data-foto]').forEach(b => b.addEventListener('click', () => {
    principal.src = b.dataset.foto;
    $$('[data-foto]').forEach(x => x.setAttribute('aria-current', String(x === b)));
  }));
})();
