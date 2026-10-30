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
    pe.innerHTML = dados.checkout ? `
      <p class="sacola-total"><span>Subtotal</span><span>${reais(total)}</span></p>
      <a class="botao" href="/checkout">Finalizar compra</a>
      <a class="botao botao-linha" href="${esc(linkPedido())}" target="_blank" rel="noopener">Comprar pelo WhatsApp</a>
      <p class="nota">O frete é calculado com o seu CEP na próxima tela.</p>` : `
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
    const igual = p => p.id === Number(d.id) && p.tamanho === tamanho;
    // Comprar agora não duplica a peça se ela já estiver na sacola.
    if (!(e.submitter?.hasAttribute('data-comprar-agora') && sacola.some(igual))) {
      sacola.push({ id: Number(d.id), slug: d.slug, nome: d.nome, marca: d.marca, preco: d.preco ? Number(d.preco) : null, foto: d.foto, tamanho });
      gravar('frclub-sacola', sacola);
    }
    contarSacola();
    if (e.submitter?.hasAttribute('data-comprar-agora')) location.href = '/checkout';
    else abrirSacola();
  });

  // ---------- frete ----------
  const mascaraCep = input => input.addEventListener('input', () => {
    const n = input.value.replace(/\D/g, '').slice(0, 8);
    input.value = n.length > 5 ? `${n.slice(0, 5)}-${n.slice(5)}` : n;
  });
  $$('[data-cep]').forEach(mascaraCep);
  async function postar(caminho, corpo) {
    let r;
    try {
      r = await fetch(caminho, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
    } catch {
      throw new Error('Sem conexão. Confira a internet e tente de novo.');
    }
    const resposta = await r.json().catch(() => null);
    if (!r.ok) throw new Error(resposta?.erro || 'Algo deu errado. Tente de novo.');
    return resposta;
  }

  // ---------- conferência dos campos (o servidor confere de novo) ----------
  function cpfValido(cpf) {
    if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
    for (const n of [9, 10]) {
      let soma = 0;
      for (let i = 0; i < n; i++) soma += Number(cpf[i]) * (n + 1 - i);
      if (((soma * 10) % 11) % 10 !== Number(cpf[n])) return false;
    }
    return true;
  }
  const NOME_COMPLETO = /^\p{L}{2,}(?: [\p{L}'.-]+)* [\p{L}'.-]{2,}$/u;
  const REGRAS = {
    nome: v => (NOME_COMPLETO.test(v.normalize('NFC').replace(/\s+/g, ' ').trim()) ? '' : 'Digite seu nome completo (nome e sobrenome), só com letras.'),
    email: v => (/^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(v.trim()) ? '' : 'E-mail inválido.'),
    cpf: v => (cpfValido(v.replace(/\D/g, '')) ? '' : 'CPF inválido.'),
    telefone: v => { const n = v.replace(/\D/g, ''); return n.length >= 10 && n.length <= 11 ? '' : 'Celular inválido: DDD + número.'; },
    cep: v => (v.replace(/\D/g, '').length === 8 ? '' : 'CEP inválido.'),
    uf: v => (/^[A-Za-z]{2}$/.test(v.trim()) ? '' : 'Use a sigla, como BA ou SP.'),
  };
  // Mostra o erro embaixo do campo. Campo opcional vazio passa.
  function conferirCampo(input) {
    const v = input.value;
    let msg = '';
    if (!v.trim()) msg = input.required ? 'Preencha este campo.' : '';
    else if (REGRAS[input.name]) msg = REGRAS[input.name](v);
    const aviso = input.parentElement.querySelector('.campo-erro');
    input.setAttribute('aria-invalid', String(Boolean(msg)));
    if (aviso) { aviso.textContent = msg; aviso.hidden = !msg; }
    return !msg;
  }
  function conferirForm(form) {
    const ruins = [...form.querySelectorAll('.campo input')].filter(i => !conferirCampo(i));
    ruins[0]?.focus();
    return !ruins.length;
  }
  // Confere ao sair do campo; depois do primeiro erro, confere a cada letra até ficar certo.
  document.addEventListener('focusout', e => { if (e.target.matches?.('.campo input') && e.target.value) conferirCampo(e.target); });
  document.addEventListener('input', e => { if (e.target.matches?.('.campo input[aria-invalid="true"]')) conferirCampo(e.target); });
  $$('[data-cpf]').forEach(input => input.addEventListener('input', () => {
    const n = input.value.replace(/\D/g, '').slice(0, 11);
    input.value = n.replace(/^(\d{3})(\d)/, '$1.$2').replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d{1,2})$/, '.$1-$2');
  }));
  $$('[data-telefone]').forEach(input => input.addEventListener('input', () => {
    const n = input.value.replace(/\D/g, '').slice(0, 11);
    input.value = n.length > 10 ? `(${n.slice(0, 2)}) ${n.slice(2, 7)}-${n.slice(7)}` : n.length > 6 ? `(${n.slice(0, 2)}) ${n.slice(2, 6)}-${n.slice(6)}` : n.length > 2 ? `(${n.slice(0, 2)}) ${n.slice(2)}` : n;
  }));
  // Endereço pelo CEP, sem apagar o que a pessoa já digitou.
  function preencherEndereco(form, cep) {
    return fetch(`/api/cep/${cep}`).then(r => (r.ok ? r.json() : null)).then(end => {
      if (!end) return;
      for (const k of ['rua', 'bairro', 'cidade', 'uf']) if (end[k] && form[k] && !form[k].value) { form[k].value = end[k]; conferirCampo(form[k]); }
      if (form.numero && !form.numero.value) form.numero.focus();
    }).catch(() => {});
  }

  const prazo = o => (o.prazo ? `até ${o.prazo} ${o.prazo === 1 ? 'dia útil' : 'dias úteis'}` : '');
  const nomeFrete = o => `${o.empresa && !o.nome.toLowerCase().includes(o.empresa.toLowerCase()) ? `${o.empresa} ` : ''}${o.nome}`;

  const formFrete = $('[data-frete-peca]');
  formFrete?.addEventListener('submit', async e => {
    e.preventDefault();
    const saida = $('[data-frete-resultado]', formFrete);
    const botao = $('button', formFrete);
    botao.disabled = true;
    saida.innerHTML = '<p class="nota">Calculando…</p>';
    try {
      const opcoes = await postar('/api/frete', { cep: formFrete.cep.value, itens: [{ id: Number(formFrete.dataset.fretePeca) }] });
      saida.innerHTML = opcoes.map(o => `<p class="frete-opcao"><span>${esc(nomeFrete(o))}<small>${esc(prazo(o))}</small></span><b>${reais(o.preco)}</b></p>`).join('');
    } catch (falha) {
      saida.innerHTML = `<p class="form-erro">${esc(falha.message)}</p>`;
    } finally {
      botao.disabled = false;
    }
  });

  // ---------- checkout ----------
  const checkout = $('[data-checkout]');
  if (checkout) {
    const saida = $('[data-frete-resultado]', checkout);
    const erro = $('.form-erro', checkout);
    const itensPedido = () => sacola.map(p => ({ id: p.id, tamanho: p.tamanho || '' }));
    const subtotal = sacola.reduce((t, p) => t + (p.preco || 0), 0);
    let opcoes = [];
    let cepCotado = '';
    // Preenche com o que ficou guardado neste aparelho na última compra.
    const salvo = ler('frclub-cliente', {});
    for (const [k, v] of Object.entries(salvo)) if (checkout[k] && typeof v === 'string' && v) { checkout[k].value = v; checkout[k].dispatchEvent(new Event('input')); }

    if (!sacola.length) {
      checkout.innerHTML = '<p class="vazio">Sua sacola está vazia. <a href="/pecas">Ver as peças</a></p>';
    } else {
      $('[data-resumo-itens]', checkout).innerHTML = sacola.map(p => `
        <div class="resumo-item">
          ${p.foto ? `<img src="${esc(p.foto)}" alt="">` : '<span class="sem-img"></span>'}
          <div><p>${esc(`${p.marca ? `${p.marca} ` : ''}${p.nome}`)}</p>${p.tamanho ? `<p class="nota">Tamanho ${esc(p.tamanho)}</p>` : ''}</div>
          <span>${p.preco ? reais(p.preco) : '—'}</span>
        </div>`).join('');
      $('[data-subtotal]', checkout).textContent = reais(subtotal);
    }
    function atualizarTotal() {
      const escolhida = opcoes.find(o => String(o.id) === checkout.querySelector('input[name="frete"]:checked')?.value);
      $('[data-valor-frete]', checkout).textContent = escolhida ? reais(escolhida.preco) : '—';
      $('[data-total]', checkout).textContent = escolhida ? reais(subtotal + escolhida.preco) : '—';
    }
    async function cotar() {
      const cep = checkout.cep.value.replace(/\D/g, '');
      if (cep.length !== 8 || cep === cepCotado) return;
      cepCotado = cep;
      saida.innerHTML = '<p class="nota">Calculando o frete…</p>';
      preencherEndereco(checkout, cep);
      try {
        opcoes = await postar('/api/frete', { cep, itens: itensPedido() });
        saida.innerHTML = opcoes.map((o, i) => `
          <label class="frete-escolha">
            <input type="radio" name="frete" value="${o.id}" ${i === 0 ? 'checked' : ''}>
            <span>${esc(nomeFrete(o))}<small>${esc(prazo(o))}</small></span>
            <b>${reais(o.preco)}</b>
          </label>`).join('');
      } catch (falha) {
        opcoes = [];
        cepCotado = '';
        saida.innerHTML = `<p class="form-erro">${esc(falha.message)}</p>`;
      }
      atualizarTotal();
    }
    checkout.cep?.addEventListener('input', cotar);
    checkout.addEventListener('change', e => { if (e.target.name === 'frete') atualizarTotal(); });
    if (checkout.cep?.value) cotar();

    checkout.addEventListener('submit', async e => {
      e.preventDefault();
      erro.hidden = true;
      const frete = checkout.querySelector('input[name="frete"]:checked')?.value;
      const campos = ['nome', 'email', 'telefone', 'cpf', 'cep', 'rua', 'numero', 'complemento', 'bairro', 'cidade', 'uf'];
      const cliente = Object.fromEntries(campos.map(k => [k, checkout[k].value.trim()]));
      const mostrar = texto => { erro.textContent = texto; erro.hidden = false; };
      if (!conferirForm(checkout)) return mostrar('Confira os campos marcados em vermelho.');
      if (!frete) return mostrar('Digite o CEP e escolha a forma de entrega.');
      const { cpf, ...lembrar } = cliente; // o CPF não fica guardado no aparelho
      gravar('frclub-cliente', lembrar);
      const botao = $('button[type="submit"]', checkout);
      botao.disabled = true;
      botao.textContent = 'Abrindo o pagamento…';
      try {
        const pedido = await postar('/api/pedidos', { itens: itensPedido(), cliente, frete: Number(frete) });
        gravar('frclub-ultimo-pedido', pedido.codigo);
        location.href = pedido.link;
      } catch (falha) {
        mostrar(falha.message);
        botao.disabled = false;
        botao.textContent = 'Ir para o pagamento';
      }
    });
  }

  // ---------- página do pedido ----------
  const pedido = $('.pedido');
  if (pedido?.hasAttribute('data-pago') && sacola.length) {
    sacola = []; // pago: esvazia a sacola
    gravar('frclub-sacola', sacola);
    contarSacola();
  }
  if (pedido?.hasAttribute('data-atualizar')) setTimeout(() => location.reload(), 15000);

  const principal = $('[data-galeria-principal]');
  $$('[data-foto]').forEach(b => b.addEventListener('click', () => {
    principal.src = b.dataset.foto;
    $$('[data-foto]').forEach(x => x.setAttribute('aria-current', String(x === b)));
  }));
})();
