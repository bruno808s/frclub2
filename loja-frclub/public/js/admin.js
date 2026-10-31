// Painel da loja: peças, fotos, imagens do topo e textos. Tudo sem mexer em código.
const raiz = document.getElementById('painel');
const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const reais = n => (typeof n === 'number' ? n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—');
const foto = a => `/fotos/${encodeURIComponent(a)}`;
const paraCampo = n => (n == null ? '' : String(n).replace('.', ','));
function lerValor(t) {
  const s = String(t ?? '').trim().replace(/^R\$\s*/i, '');
  if (!s) return null;
  const n = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s);
  return Number.isFinite(n) ? n : NaN;
}

async function api(metodo, caminho, corpo) {
  let r;
  try {
    r = await fetch(`/api${caminho}`, { method: metodo, headers: corpo === undefined ? {} : { 'Content-Type': 'application/json' }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  } catch {
    throw new Error('Sem conexão. Confira a internet e tente de novo.');
  }
  const dados = await r.json().catch(() => null);
  if (r.status === 401 && caminho !== '/entrar') { telaEntrar(); throw new Error('Sua sessão terminou. Entre de novo.'); }
  if (!r.ok) throw new Error(dados?.erro || 'Algo deu errado. Tente de novo.');
  return dados;
}

function avisar(texto, tipo = 'ok') {
  const el = document.createElement('div');
  el.className = `aviso aviso-${tipo}`;
  el.setAttribute('role', tipo === 'erro' ? 'alert' : 'status');
  el.textContent = texto;
  document.body.append(el);
  setTimeout(() => el.remove(), 3800);
}

// Diminui a foto no próprio aparelho antes de enviar (abre mais rápido no site e gasta menos espaço).
async function reduzir(arquivo, maximo, manterPng = false) {
  let imagem;
  try {
    imagem = await createImageBitmap(arquivo);
  } catch {
    throw new Error(`Não consegui abrir "${arquivo.name}". Use foto JPG, PNG ou WEBP.`);
  }
  const escala = Math.min(1, maximo / Math.max(imagem.width, imagem.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(imagem.width * escala);
  canvas.height = Math.round(imagem.height * escala);
  const ctx = canvas.getContext('2d');
  const png = manterPng && arquivo.type === 'image/png';
  if (!png) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
  ctx.drawImage(imagem, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL(png ? 'image/png' : 'image/jpeg', 0.86);
}

// ---------- entrar ----------
async function iniciar() {
  let sessao;
  try {
    sessao = await api('GET', '/sessao');
  } catch (e) {
    raiz.innerHTML = `<main class="entrar"><p>${esc(e.message)}</p></main>`;
    return;
  }
  if (!sessao.painelLigado) {
    raiz.innerHTML = `<main class="entrar"><div class="entrar-caixa"><img src="/static/img/logo-cor.png" alt="" width="72" height="72"><h1>Painel desligado</h1>
      <p>${esc(sessao.motivo || 'Crie no Render a variável ADMIN_SENHA com a senha do painel.')}</p></div></main>`;
    return;
  }
  if (!sessao.logado) return telaEntrar();
  telaPainel('pecas');
}

function telaEntrar() {
  raiz.innerHTML = `
  <main class="entrar">
    <form class="entrar-caixa" novalidate>
      <img src="/static/img/logo-cor.png" alt="" width="72" height="72">
      <h1>Painel da loja</h1>
      <label class="campo"><span>Senha</span><input type="password" name="senha" autocomplete="current-password" required></label>
      <p class="erro" role="alert" hidden></p>
      <button class="botao" type="submit">Entrar</button>
      <a class="link" href="/">Voltar para o site</a>
    </form>
  </main>`;
  const form = raiz.querySelector('form');
  form.senha.focus();
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const erro = form.querySelector('.erro');
    erro.hidden = true;
    try {
      await api('POST', '/entrar', { senha: form.senha.value });
      telaPainel('pecas');
    } catch (falha) {
      erro.textContent = falha.message;
      erro.hidden = false;
      form.senha.select();
    }
  });
}

// ---------- moldura do painel ----------
const ABAS = [['pecas', 'Peças'], ['pedidos', 'Pedidos'], ['depoimentos', 'Depoimentos'], ['aparencia', 'Aparência'], ['textos', 'Contato e textos'], ['entrega', 'Entrega e pagamento']];
function telaPainel(aba) {
  raiz.innerHTML = `
  <header class="painel-topo">
    <a class="painel-marca" href="/admin"><img src="/static/img/logo-cor.png" alt="" width="36" height="36"><span>Painel da loja</span></a>
    <nav class="abas" aria-label="Seções do painel">
      ${ABAS.map(([id, nome]) => `<button type="button" data-aba="${id}" aria-current="${id === aba}">${nome}</button>`).join('')}
    </nav>
    <div class="painel-acoes">
      <a class="link" href="/" target="_blank" rel="noopener">Ver o site</a>
      <button class="link" type="button" data-sair>Sair</button>
    </div>
  </header>
  <main class="painel-corpo" data-corpo></main>`;
  raiz.querySelectorAll('[data-aba]').forEach(b => b.addEventListener('click', () => telaPainel(b.dataset.aba)));
  raiz.querySelector('[data-sair]').addEventListener('click', async () => { await api('POST', '/sair').catch(() => {}); telaEntrar(); });
  const corpo = raiz.querySelector('[data-corpo]');
  if (aba === 'pecas') abaPecas(corpo);
  else if (aba === 'pedidos') abaPedidos(corpo);
  else if (aba === 'depoimentos') abaDepoimentos(corpo);
  else abaConfig(corpo, aba);
}

// ---------- peças ----------
let pecas = [];
async function abaPecas(corpo) {
  corpo.innerHTML = '<p class="nota">Carregando…</p>';
  try {
    pecas = await api('GET', '/admin/pecas');
  } catch (e) {
    corpo.innerHTML = `<p class="erro">${esc(e.message)}</p>`;
    return;
  }
  let busca = '';
  corpo.innerHTML = `
    <div class="cabeca-aba">
      <div><h1>Peças</h1><p class="nota">${pecas.length} cadastradas · ${pecas.filter(p => p.visivel && !p.esgotado).length} à venda no site</p></div>
      <button class="botao" type="button" data-nova>+ Nova peça</button>
    </div>
    <input class="busca" type="search" placeholder="Buscar por nome, marca ou categoria" aria-label="Buscar peça" data-busca>
    <ul class="lista" data-lista></ul>`;
  const lista = corpo.querySelector('[data-lista]');
  const desenhar = () => {
    const termo = busca.toLowerCase();
    const visiveis = pecas.filter(p => !termo || `${p.nome} ${p.marca} ${p.categoria}`.toLowerCase().includes(termo));
    lista.innerHTML = visiveis.length ? visiveis.map(p => `
      <li class="linha" data-id="${p.id}">
        ${p.fotos[0] ? `<img src="${foto(p.fotos[0])}" alt="" loading="lazy">` : '<span class="sem-img">Sem foto</span>'}
        <div class="linha-texto">
          <b>${esc(p.nome)}</b>
          <span class="nota">${esc([p.marca, p.categoria, p.tamanhos.join(', ')].filter(Boolean).join(' · '))}</span>
          <span>${reais(p.preco)}</span>
        </div>
        <div class="linha-chaves">
          <label class="chave"><input type="checkbox" data-rapido="visivel" ${p.visivel ? 'checked' : ''}><span>No site</span></label>
          <label class="chave"><input type="checkbox" data-rapido="esgotado" ${p.esgotado ? 'checked' : ''}><span>Esgotado</span></label>
          <label class="chave"><input type="checkbox" data-rapido="destaque" ${p.destaque ? 'checked' : ''}><span>Destaque</span></label>
        </div>
        <button class="botao botao-linha" type="button" data-editar>Editar</button>
      </li>`).join('') : `<li class="nota vazio">${pecas.length ? 'Nenhuma peça com essa busca.' : 'Nenhuma peça ainda. Clique em "Nova peça" para cadastrar a primeira.'}</li>`;
  };
  desenhar();
  corpo.querySelector('[data-busca]').addEventListener('input', e => { busca = e.target.value; desenhar(); });
  corpo.querySelector('[data-nova]').addEventListener('click', () => formPeca(corpo, null));
  lista.addEventListener('click', e => {
    if (!e.target.closest('[data-editar]')) return;
    const id = Number(e.target.closest('[data-id]').dataset.id);
    formPeca(corpo, pecas.find(p => p.id === id));
  });
  lista.addEventListener('change', async e => {
    const caixa = e.target.closest('[data-rapido]');
    if (!caixa) return;
    const id = Number(caixa.closest('[data-id]').dataset.id);
    try {
      const nova = await api('PATCH', `/admin/pecas/${id}`, { [caixa.dataset.rapido]: caixa.checked });
      pecas = pecas.map(p => (p.id === id ? nova : p));
      avisar('Salvo.');
    } catch (falha) {
      caixa.checked = !caixa.checked;
      avisar(falha.message, 'erro');
    }
  });
}

function formPeca(corpo, p) {
  const nova = !p;
  p = p ?? { nome: '', marca: '', categoria: '', descricao: '', estado: '', tamanhos: [], preco: null, preco_antigo: null, link_pagamento: '', fotos: [], visivel: true, esgotado: false, destaque: false, peca_unica: false };
  let fotos = p.fotos.map(arquivo => ({ arquivo, src: foto(arquivo) }));
  const sugestoes = campo => [...new Set(pecas.map(x => x[campo]).filter(Boolean))].map(v => `<option value="${esc(v)}">`).join('');
  corpo.innerHTML = `
    <button class="link voltar" type="button" data-voltar>← Voltar para as peças</button>
    <form class="form-peca" novalidate>
      <div class="cabeca-aba"><h1>${nova ? 'Nova peça' : 'Editar peça'}</h1></div>
      <section class="bloco">
        <h2>Fotos</h2>
        <p class="nota">Até 8 fotos. A primeira é a capa. Foto vertical fica melhor (proporção 4 por 5).</p>
        <div class="fotos" data-fotos></div>
        <label class="botao botao-linha subir">+ Adicionar fotos<input type="file" accept="image/*" multiple data-subir hidden></label>
      </section>
      <section class="bloco grade-campos">
        <label class="campo largo"><span>Nome da peça *</span><input name="nome" maxlength="120" value="${esc(p.nome)}" placeholder="Ex.: Camiseta oversized"></label>
        <label class="campo"><span>Marca</span><input name="marca" maxlength="60" list="lista-marcas" value="${esc(p.marca)}" placeholder="Ex.: All Saints"><datalist id="lista-marcas">${sugestoes('marca')}</datalist></label>
        <label class="campo"><span>Categoria (aparece no menu)</span><input name="categoria" maxlength="40" list="lista-categorias" value="${esc(p.categoria)}" placeholder="Ex.: Camisetas"><datalist id="lista-categorias">${sugestoes('categoria')}</datalist></label>
        <label class="campo"><span>Preço (R$)</span><input name="preco" inputmode="decimal" value="${esc(paraCampo(p.preco))}" placeholder="0,00"></label>
        <label class="campo"><span>Preço antigo, riscado (opcional)</span><input name="preco_antigo" inputmode="decimal" value="${esc(paraCampo(p.preco_antigo))}" placeholder="0,00"></label>
        <label class="campo"><span>Tamanhos (separe com vírgula)</span><input name="tamanhos" value="${esc(p.tamanhos.join(', '))}" placeholder="Ex.: P, M, G ou 40, 41, 42"></label>
        <label class="campo"><span>Estado (opcional)</span><input name="estado" maxlength="60" value="${esc(p.estado)}" placeholder="Ex.: Novo com etiqueta, 9/10"></label>
        <label class="campo largo"><span>Descrição</span><textarea name="descricao" rows="5" maxlength="4000" placeholder="Material, medidas, detalhes">${esc(p.descricao)}</textarea></label>
        <label class="campo largo"><span>Link de pagamento avulso (opcional)</span><input name="link_pagamento" maxlength="500" value="${esc(p.link_pagamento)}" placeholder="https://..."><small class="nota">Só é usado se o pagamento pelo site (Mercado Pago) estiver desligado. Com ele ligado, pode deixar vazio.</small></label>
      </section>
      <section class="bloco chaves">
        <label class="chave"><input type="checkbox" name="visivel" ${p.visivel ? 'checked' : ''}><span>Mostrar no site</span></label>
        <label class="chave"><input type="checkbox" name="esgotado" ${p.esgotado ? 'checked' : ''}><span>Esgotado</span></label>
        <label class="chave"><input type="checkbox" name="destaque" ${p.destaque ? 'checked' : ''}><span>Destaque na página inicial</span></label>
        <label class="chave"><input type="checkbox" name="peca_unica" ${p.peca_unica ? 'checked' : ''}><span>Peça única</span></label>
      </section>
      <p class="erro" role="alert" hidden></p>
      <div class="rodape-form">
        <button class="botao" type="submit">${nova ? 'Cadastrar peça' : 'Salvar alterações'}</button>
        ${nova ? '' : `<a class="link" href="/peca/${esc(p.slug)}" target="_blank" rel="noopener">Ver no site</a><button class="link perigo" type="button" data-excluir>Excluir peça</button>`}
      </div>
    </form>`;
  window.scrollTo(0, 0);
  const form = corpo.querySelector('form');
  const caixaFotos = corpo.querySelector('[data-fotos]');
  const erro = form.querySelector('.erro');

  const desenharFotos = () => {
    caixaFotos.innerHTML = fotos.length ? fotos.map((f, i) => `
      <figure class="foto-item">
        <img src="${esc(f.src)}" alt="Foto ${i + 1}">
        ${i === 0 ? '<span class="capa">Capa</span>' : ''}
        <div class="foto-botoes">
          <button type="button" data-mover="${i}" data-dir="-1" ${i === 0 ? 'disabled' : ''} aria-label="Mover para a esquerda">←</button>
          <button type="button" data-mover="${i}" data-dir="1" ${i === fotos.length - 1 ? 'disabled' : ''} aria-label="Mover para a direita">→</button>
          <button type="button" data-tirar="${i}" aria-label="Tirar foto">✕</button>
        </div>
      </figure>`).join('') : '<p class="nota">Nenhuma foto ainda.</p>';
  };
  desenharFotos();
  caixaFotos.addEventListener('click', e => {
    const mover = e.target.closest('[data-mover]');
    const tirar = e.target.closest('[data-tirar]');
    if (mover) {
      const i = Number(mover.dataset.mover);
      const j = i + Number(mover.dataset.dir);
      [fotos[i], fotos[j]] = [fotos[j], fotos[i]];
    } else if (tirar) fotos.splice(Number(tirar.dataset.tirar), 1);
    else return;
    desenharFotos();
  });
  corpo.querySelector('[data-subir]').addEventListener('change', async e => {
    const arquivos = [...e.target.files].slice(0, 8 - fotos.length);
    e.target.value = '';
    if (!arquivos.length) return avisar('Já tem 8 fotos. Tire uma para colocar outra.', 'erro');
    for (const a of arquivos) {
      try {
        const dados = await reduzir(a, 1600);
        fotos.push({ dados, src: dados });
      } catch (falha) {
        avisar(falha.message, 'erro');
      }
    }
    desenharFotos();
  });
  corpo.querySelector('[data-voltar]').addEventListener('click', () => abaPecas(corpo));
  corpo.querySelector('[data-excluir]')?.addEventListener('click', async () => {
    if (!confirm(`Excluir "${p.nome}"? As fotos também são apagadas. Não dá para desfazer.`)) return;
    try {
      await api('DELETE', `/admin/pecas/${p.id}`);
      avisar('Peça excluída.');
      abaPecas(corpo);
    } catch (falha) {
      avisar(falha.message, 'erro');
    }
  });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    erro.hidden = true;
    const mostrar = (texto, campo) => { erro.textContent = texto; erro.hidden = false; campo?.focus(); };
    const preco = lerValor(form.preco.value);
    const precoAntigo = lerValor(form.preco_antigo.value);
    if (!form.nome.value.trim()) return mostrar('Digite o nome da peça.', form.nome);
    if (Number.isNaN(preco)) return mostrar('Preço inválido. Ex.: 189,90', form.preco);
    if (Number.isNaN(precoAntigo)) return mostrar('Preço antigo inválido. Ex.: 249,90', form.preco_antigo);
    const corpoPedido = {
      nome: form.nome.value, marca: form.marca.value, categoria: form.categoria.value, descricao: form.descricao.value,
      estado: form.estado.value, tamanhos: form.tamanhos.value.split(',').map(t => t.trim()).filter(Boolean),
      preco, preco_antigo: precoAntigo, link_pagamento: form.link_pagamento.value.trim(),
      visivel: form.visivel.checked, esgotado: form.esgotado.checked, destaque: form.destaque.checked, peca_unica: form.peca_unica.checked,
      fotos: fotos.map(f => (f.arquivo ? { arquivo: f.arquivo } : { dados: f.dados })),
    };
    const botao = form.querySelector('button[type="submit"]');
    botao.disabled = true;
    botao.textContent = 'Salvando…';
    try {
      await api(nova ? 'POST' : 'PATCH', nova ? '/admin/pecas' : `/admin/pecas/${p.id}`, corpoPedido);
      avisar(nova ? 'Peça cadastrada.' : 'Alterações salvas.');
      abaPecas(corpo);
    } catch (falha) {
      mostrar(falha.message);
      botao.disabled = false;
      botao.textContent = nova ? 'Cadastrar peça' : 'Salvar alterações';
    }
  });
}

// ---------- pedidos ----------
const STATUS = { aguardando: 'Aguardando pagamento', pago: 'Pago: enviar', enviado: 'Enviado', cancelado: 'Cancelado' };
const STATUS_DEV = { aberta: 'Nova: responder', aprovada: 'Aprovada: aguardando a peça', concluida: 'Concluída', recusada: 'Recusada' };
const QUER_DEV = { troca: 'Quer trocar', reembolso: 'Quer o dinheiro de volta' };
const MOTIVO_DEV = { arrependimento: 'Desistiu da compra', tamanho: 'O tamanho não serviu', defeito: 'Defeito ou avaria', errado: 'Recebeu peça diferente', outro: 'Outro motivo' };
const devAberta = p => p.devolucoes?.some(d => ['aberta', 'aprovada'].includes(d.status));
const STATUS_MP = { approved: 'aprovado', pending: 'pendente', in_process: 'em análise', authorized: 'autorizado', rejected: 'recusado', cancelled: 'cancelado', refunded: 'devolvido', charged_back: 'contestado' };
const formatarCpf = c => String(c).replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
const formatarCep = c => String(c).replace(/^(\d{5})(\d{3})$/, '$1-$2');
async function abaPedidos(corpo) {
  corpo.innerHTML = '<p class="nota">Carregando…</p>';
  let pedidos;
  try {
    pedidos = await api('GET', '/admin/pedidos');
  } catch (e) {
    corpo.innerHTML = `<p class="erro">${esc(e.message)}</p>`;
    return;
  }
  let filtro = pedidos.some(devAberta) ? 'devolucao' : pedidos.some(p => p.status === 'pago') ? 'pago' : 'todos';
  const novasDev = pedidos.filter(p => p.devolucoes?.some(d => d.status === 'aberta')).length;
  corpo.innerHTML = `
    <div class="cabeca-aba">
      <div><h1>Pedidos</h1><p class="nota">${pedidos.filter(p => p.status === 'pago').length} pagos esperando envio${novasDev ? ` · <b>${novasDev} ${novasDev === 1 ? 'troca/devolução nova' : 'trocas/devoluções novas'}</b>` : ''}</p></div>
    </div>
    <div class="filtro-pedidos">
      <label class="campo"><span>Mostrar</span>
        <select data-filtro>
          <option value="todos">Todos</option>
          ${Object.entries(STATUS).map(([id, nome]) => `<option value="${id}">${nome}</option>`).join('')}
          <option value="devolucao">Com troca ou devolução em andamento</option>
        </select>
      </label>
    </div>
    <ul class="lista-pedidos" data-lista></ul>`;
  const lista = corpo.querySelector('[data-lista]');
  corpo.querySelector('[data-filtro]').value = filtro;
  const desenhar = () => {
    const visiveis = pedidos.filter(p => filtro === 'todos' || (filtro === 'devolucao' ? devAberta(p) : p.status === filtro));
    lista.innerHTML = visiveis.length ? visiveis.map(p => {
      const c = p.cliente;
      return `
      <li class="pedido-card" data-id="${p.id}">
        <div class="pedido-topo">
          <div><b>${esc(c.nome)}</b><span class="nota"> · ${new Date(`${p.criado_em.replace(' ', 'T')}Z`).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })} · ${esc(p.codigo)}</span></div>
          <span class="selo-status status-${esc(p.status)}">${STATUS[p.status] ?? esc(p.status)}</span>
        </div>
        <ul class="pedido-itens">
          ${p.itens.map(i => `<li>${i.quantidade > 1 ? `${i.quantidade}× ` : ''}${esc(`${i.marca ? `${i.marca} ` : ''}${i.nome}`)}${i.tamanho ? ` · tam. ${esc(i.tamanho)}` : ''} · ${reais(i.preco * i.quantidade)}</li>`).join('')}
          <li>Frete ${esc(p.frete_nome)} · ${reais(p.frete_valor)}</li>
          <li><b>Total ${reais(p.total)}</b>${p.mp_status ? ` <span class="nota">(Mercado Pago: ${esc(STATUS_MP[p.mp_status] ?? p.mp_status)})</span>` : ''}</li>
        </ul>
        <p class="pedido-endereco">
          ${esc(c.nome)} · CPF ${esc(formatarCpf(c.cpf))}<br>
          ${esc(`${c.rua}, ${c.numero}${c.complemento ? ` - ${c.complemento}` : ''}`)}<br>
          ${esc(`${c.bairro} · ${c.cidade}/${c.uf} · CEP ${formatarCep(c.cep)}`)}<br>
          ${esc(c.email)} · <a href="https://wa.me/55${esc(c.telefone)}" target="_blank" rel="noopener">${esc(c.telefone)}</a>
        </p>
        ${(p.devolucoes ?? []).map(d => `
        <div class="devolucao-admin" data-dev="${d.id}">
          <p><b>Troca ou devolução</b> <span class="nota">· ${new Date(`${d.criado_em.replace(' ', 'T')}Z`).toLocaleDateString('pt-BR')}</span></p>
          <p>${esc(QUER_DEV[d.quer] ?? d.quer)} · ${esc(MOTIVO_DEV[d.motivo] ?? d.motivo)}<br>${esc(d.itens.join(', '))}</p>
          ${d.mensagem ? `<p class="nota pre-linha">"${esc(d.mensagem)}"</p>` : ''}
          <label class="campo"><span>Situação da troca/devolução</span>
            <select data-dev-status>${Object.entries(STATUS_DEV).map(([id, nome]) => `<option value="${id}" ${id === d.status ? 'selected' : ''}>${nome}</option>`).join('')}</select>
          </label>
          <label class="campo"><span>Resposta para o cliente (vai por e-mail e aparece na página do pedido)</span>
            <textarea data-dev-resposta rows="3" maxlength="2000" placeholder="Ex.: Aprovado! Poste a peça nos Correios com o código de autorização XXXXX até sexta.">${esc(d.resposta)}</textarea>
          </label>
          <div><button class="botao botao-linha" type="button" data-dev-salvar>Salvar troca/devolução</button></div>
        </div>`).join('')}
        <div class="pedido-acoes">
          <label class="campo"><span>Situação</span>
            <select data-status>${Object.entries(STATUS).map(([id, nome]) => `<option value="${id}" ${id === p.status ? 'selected' : ''}>${nome}</option>`).join('')}</select>
          </label>
          <label class="campo"><span>Código de rastreio</span><input data-rastreio maxlength="60" value="${esc(p.rastreio)}"></label>
          <button class="botao botao-linha" type="button" data-salvar>Salvar</button>
        </div>
      </li>`;
    }).join('') : `<li class="nota vazio">${pedidos.length ? 'Nenhum pedido nessa situação.' : 'Nenhum pedido ainda. Eles aparecem aqui quando alguém finaliza uma compra no site.'}</li>`;
  };
  desenhar();
  corpo.querySelector('[data-filtro]').addEventListener('change', e => { filtro = e.target.value; desenhar(); });
  lista.addEventListener('click', async e => {
    const salvarDev = e.target.closest('[data-dev-salvar]');
    if (salvarDev) {
      const caixa = salvarDev.closest('[data-dev]');
      const idPedido = Number(salvarDev.closest('[data-id]').dataset.id);
      salvarDev.disabled = true;
      try {
        const nova = await api('PATCH', `/admin/devolucoes/${caixa.dataset.dev}`, { status: caixa.querySelector('[data-dev-status]').value, resposta: caixa.querySelector('[data-dev-resposta]').value });
        pedidos = pedidos.map(p => (p.id === idPedido ? { ...p, devolucoes: p.devolucoes.map(d => (d.id === nova.id ? nova : d)) } : p));
        avisar(nova.emailEnviado ? 'Salvo. O cliente recebe um e-mail com a resposta.' : 'Salvo. O cliente vê a resposta na página do pedido.');
        desenhar();
      } catch (falha) {
        avisar(falha.message, 'erro');
        salvarDev.disabled = false;
      }
      return;
    }
    const botao = e.target.closest('[data-salvar]');
    if (!botao) return;
    const card = botao.closest('[data-id]');
    const id = Number(card.dataset.id);
    botao.disabled = true;
    try {
      const novo = await api('PATCH', `/admin/pedidos/${id}`, { status: card.querySelector('[data-status]').value, rastreio: card.querySelector('[data-rastreio]').value });
      pedidos = pedidos.map(p => (p.id === id ? novo : p));
      avisar(novo.emailEnviado ? 'Pedido salvo. O cliente recebe um e-mail com o rastreio.' : 'Pedido salvo. O cliente vê a mudança na página do pedido.');
      desenhar();
    } catch (falha) {
      avisar(falha.message, 'erro');
      botao.disabled = false;
    }
  });
}

// ---------- depoimentos ----------
async function abaDepoimentos(corpo) {
  corpo.innerHTML = '<p class="nota">Carregando…</p>';
  let lista;
  try {
    lista = await api('GET', '/admin/depoimentos');
  } catch (e) {
    corpo.innerHTML = `<p class="erro">${esc(e.message)}</p>`;
    return;
  }
  const estrelas = n => '★'.repeat(n) + '☆'.repeat(5 - n);
  corpo.innerHTML = `
    <div class="cabeca-aba">
      <div><h1>Depoimentos</h1><p class="nota">${lista.filter(d => d.aprovado).length} no site</p></div>
    </div>
    <p class="nota com-espaco">Só você cadastra os depoimentos. Eles aparecem na página inicial e em /depoimentos.</p>
    <form class="bloco grade-campos" data-novo novalidate>
      <h2 class="largo">Cadastrar depoimento</h2>
      <label class="campo"><span>Nome</span><input name="nome" maxlength="60" required></label>
      <label class="campo"><span>Cidade (opcional)</span><input name="cidade" maxlength="60"></label>
      <label class="campo"><span>Nota</span><select name="nota">${[5, 4, 3, 2, 1].map(n => `<option value="${n}">${estrelas(n)}</option>`).join('')}</select></label>
      <label class="campo largo"><span>Depoimento</span><textarea name="texto" rows="4" maxlength="1000" required></textarea></label>
      <p class="erro largo" role="alert" hidden></p>
      <div><button class="botao" type="submit">Publicar no site</button></div>
    </form>
    <ul class="lista-pedidos" data-lista></ul>`;
  const ul = corpo.querySelector('[data-lista]');
  const desenhar = () => {
    ul.innerHTML = lista.length ? lista.map(d => `
      <li class="pedido-card" data-id="${d.id}">
        <div class="pedido-topo">
          <div><b>${esc(d.nome)}</b><span class="nota">${d.cidade ? ` · ${esc(d.cidade)}` : ''} · ${new Date(`${d.criado_em.replace(' ', 'T')}Z`).toLocaleDateString('pt-BR')}</span></div>
          <span class="selo-status ${d.aprovado ? 'status-pago' : ''}">${d.aprovado ? 'No site' : 'Escondido'}</span>
        </div>
        <p>${estrelas(d.nota)}</p>
        <p class="pre-linha">${esc(d.texto)}</p>
        <div class="linha-botoes">
          <button class="botao ${d.aprovado ? 'botao-linha' : ''}" type="button" data-aprovar="${d.aprovado ? '0' : '1'}">${d.aprovado ? 'Esconder do site' : 'Mostrar no site'}</button>
          <button class="link perigo" type="button" data-excluir>Excluir</button>
        </div>
      </li>`).join('') : '<li class="nota vazio">Nenhum depoimento ainda. Cadastre o primeiro acima.</li>';
  };
  desenhar();
  ul.addEventListener('click', async e => {
    const card = e.target.closest('[data-id]');
    if (!card) return;
    const id = Number(card.dataset.id);
    try {
      if (e.target.closest('[data-aprovar]')) {
        const novo = await api('PATCH', `/admin/depoimentos/${id}`, { aprovado: e.target.closest('[data-aprovar]').dataset.aprovar === '1' });
        lista = lista.map(d => (d.id === id ? novo : d));
        avisar(novo.aprovado ? 'Voltou para o site.' : 'Escondido do site.');
      } else if (e.target.closest('[data-excluir]')) {
        if (!confirm('Excluir este depoimento? Não dá para desfazer.')) return;
        await api('DELETE', `/admin/depoimentos/${id}`);
        lista = lista.filter(d => d.id !== id);
        avisar('Depoimento excluído.');
      } else return;
      desenhar();
    } catch (falha) {
      avisar(falha.message, 'erro');
    }
  });
  const form = corpo.querySelector('[data-novo]');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const erro = form.querySelector('.erro');
    erro.hidden = true;
    try {
      const novo = await api('POST', '/admin/depoimentos', { nome: form.nome.value, cidade: form.cidade.value, nota: Number(form.nota.value), texto: form.texto.value });
      lista = [novo, ...lista];
      form.reset();
      desenhar();
      avisar('Depoimento publicado.');
    } catch (falha) {
      erro.textContent = falha.message;
      erro.hidden = false;
    }
  });
}

// ---------- aparência, contato, textos, entrega e pagamento ----------
async function abaConfig(corpo, aba) {
  corpo.innerHTML = '<p class="nota">Carregando…</p>';
  let cfg;
  try {
    cfg = await api('GET', '/admin/aparencia');
  } catch (e) {
    corpo.innerHTML = `<p class="erro">${esc(e.message)}</p>`;
    return;
  }
  const imagens = {}; // trocas pendentes: { dados } ou null (voltar à padrão)
  const quadroImagem = (chave, titulo, dica, padrao, escuro) => `
    <div class="quadro-imagem" data-imagem="${chave}">
      <h3>${titulo}</h3>
      <p class="nota">${dica}</p>
      <div class="previa ${escuro ? 'escura' : ''} previa-${chave}"><img alt="" data-previa src="${esc(cfg[chave] ? foto(cfg[chave]) : padrao)}"></div>
      <div class="linha-botoes">
        <label class="botao botao-linha">Trocar imagem<input type="file" accept="image/*" hidden data-arquivo></label>
        <button class="link" type="button" data-padrao>Voltar à padrão</button>
      </div>
    </div>`;

  if (aba === 'aparencia') {
    corpo.innerHTML = `
    <form class="form-config" novalidate>
      <div class="cabeca-aba"><h1>Aparência</h1></div>
      <section class="bloco">
        <h2>Imagem grande do topo</h2>
        <p class="nota">É a primeira coisa que aparece no site. Use uma imagem deitada para o computador e uma em pé para o celular.</p>
        <div class="imagens-topo">
          ${quadroImagem('heroDesktop', 'Computador', 'Deitada, de preferência 1920 × 1080 ou maior.', '/static/img/hero-padrao-pc.jpg')}
          ${quadroImagem('heroMobile', 'Celular', 'Em pé, de preferência 1080 × 1600. Sem ela, o celular usa a do computador.', '/static/img/hero-padrao-celular.jpg')}
        </div>
        <label class="chave"><input type="checkbox" name="heroPretoBranco" ${cfg.heroPretoBranco ? 'checked' : ''}><span>Deixar a imagem em preto e branco</span></label>
        <label class="chave"><input type="checkbox" name="mostrarLogoHero" ${cfg.mostrarLogoHero ? 'checked' : ''}><span>Mostrar a logo no centro da imagem</span></label>
        <label class="campo"><span>Frase embaixo da logo (letra de mão)</span><input name="fraseHero" maxlength="80" value="${esc(cfg.fraseHero)}" placeholder="Deixe vazio para não mostrar"></label>
      </section>
      <section class="bloco">
        <h2>Logo</h2>
        ${quadroImagem('logo', 'Logo do site', 'Use PNG com fundo transparente, de preferência branca (o topo do site é escuro).', '/static/img/logo-branca.png', true)}
      </section>
      <section class="bloco grade-campos">
        <h2 class="largo">Barra fina do topo</h2>
        <label class="campo largo"><span>Frase do meio</span><input name="barraTopo" maxlength="120" value="${esc(cfg.barraTopo)}"></label>
        <label class="campo"><span>Texto do link da direita</span><input name="linkTopoTexto" maxlength="40" value="${esc(cfg.linkTopoTexto)}"></label>
        <label class="campo"><span>Link (vazio = abre o WhatsApp)</span><input name="linkTopoUrl" maxlength="300" value="${esc(cfg.linkTopoUrl)}" placeholder="https://..."></label>
        <label class="campo largo"><span>Título da vitrine na página inicial</span><input name="tituloPecas" maxlength="60" value="${esc(cfg.tituloPecas)}"></label>
      </section>
      <p class="erro" role="alert" hidden></p>
      <div class="rodape-form"><button class="botao" type="submit">Salvar aparência</button></div>
    </form>`;
  } else if (aba === 'entrega') {
    const servicos = String(cfg.freteServicos || '').split(',');
    const ligado = (ok, sim, nao) => `<p class="integracao ${ok ? 'ok' : ''}">${ok ? '●' : '○'} ${ok ? sim : nao}</p>`;
    corpo.innerHTML = `
    <form class="form-config" novalidate>
      <div class="cabeca-aba"><h1>Entrega e pagamento</h1></div>
      <section class="bloco">
        <h2>Situação</h2>
        ${ligado(cfg.integracoes.pagamento, 'Mercado Pago ligado: o cliente paga no site.', 'Mercado Pago desligado: falta a variável MP_ACCESS_TOKEN no Render.')}
        ${ligado(cfg.integracoes.frete, 'SuperFrete ligado.', 'SuperFrete desligado: falta a variável SUPERFRETE_TOKEN no Render.')}
        ${ligado(/^\d{8}$/.test(cfg.cepOrigem), 'CEP de origem preenchido.', 'Falta o CEP de onde as peças saem (abaixo).')}
        <p class="nota">Enquanto algum item acima estiver desligado, a sacola continua finalizando pelo WhatsApp.</p>
        ${ligado(cfg.integracoes.email, 'E-mails ligados (Brevo): o cliente recebe a confirmação do pedido e o rastreio.', 'E-mails desligados: faltam as variáveis BREVO_API_KEY e EMAIL_REMETENTE no Render.')}
        <p class="nota">Os avisos de venda nova vão para o e-mail da aba "Contato e textos".</p>
        ${cfg.integracoes.email ? '<div class="linha-botoes"><button class="botao botao-linha" type="button" data-email-teste>Enviar e-mail de teste</button></div>' : ''}
      </section>
      <section class="bloco grade-campos">
        <h2 class="largo">De onde as peças saem</h2>
        <label class="campo"><span>CEP de origem</span><input name="cepOrigem" inputmode="numeric" maxlength="9" value="${esc(formatarCep(cfg.cepOrigem))}" placeholder="00000-000"></label>
      </section>
      <section class="bloco grade-campos">
        <h2 class="largo">Caixa padrão de uma peça</h2>
        <p class="nota largo">Medidas de uma peça já embalada. Com mais peças no pedido, a SuperFrete calcula a caixa certa sozinha.</p>
        <label class="campo"><span>Peso (kg)</span><input name="pacotePeso" data-numero inputmode="decimal" value="${esc(paraCampo(cfg.pacotePeso))}"></label>
        <label class="campo"><span>Altura (cm)</span><input name="pacoteAltura" data-numero inputmode="decimal" value="${esc(paraCampo(cfg.pacoteAltura))}"></label>
        <label class="campo"><span>Largura (cm)</span><input name="pacoteLargura" data-numero inputmode="decimal" value="${esc(paraCampo(cfg.pacoteLargura))}"></label>
        <label class="campo"><span>Comprimento (cm)</span><input name="pacoteComprimento" data-numero inputmode="decimal" value="${esc(paraCampo(cfg.pacoteComprimento))}"></label>
      </section>
      <section class="bloco">
        <h2>Formas de envio oferecidas</h2>
        ${[[1, 'PAC (Correios)'], [2, 'SEDEX (Correios)'], [17, 'Mini Envios (Correios, até 300 g)'], [3, 'Jadlog'], [33, 'J&T Express']]
          .map(([id, nome]) => `<label class="chave"><input type="checkbox" data-servico value="${id}" ${servicos.includes(String(id)) ? 'checked' : ''}><span>${nome}</span></label>`).join('')}
        <p class="nota">Jadlog e J&T só aparecem se houver ponto de postagem perto do seu CEP.</p>
      </section>
      <p class="erro" role="alert" hidden></p>
      <div class="rodape-form"><button class="botao" type="submit">Salvar</button></div>
    </form>`;
  } else {
    corpo.innerHTML = `
    <form class="form-config" novalidate>
      <div class="cabeca-aba"><h1>Contato e textos</h1></div>
      <section class="bloco grade-campos">
        <h2 class="largo">Contato</h2>
        <label class="campo"><span>Nome da loja</span><input name="nomeLoja" maxlength="40" value="${esc(cfg.nomeLoja)}"></label>
        <label class="campo"><span>WhatsApp com DDD</span><input name="whatsapp" inputmode="tel" value="${esc(cfg.whatsapp)}" placeholder="(71) 99999-8888"></label>
        <label class="campo largo"><span>Mensagem que já vem escrita no WhatsApp</span><input name="mensagemWhatsapp" maxlength="300" value="${esc(cfg.mensagemWhatsapp)}"></label>
        <label class="campo"><span>Instagram (sem @)</span><input name="instagram" value="${esc(cfg.instagram)}" placeholder="frclub"></label>
        <label class="campo"><span>E-mail</span><input name="email" type="email" value="${esc(cfg.email)}"></label>
        <label class="campo"><span>Cidade</span><input name="cidade" value="${esc(cfg.cidade)}" placeholder="Salvador, BA"></label>
        <label class="campo"><span>CNPJ (aparece no rodapé)</span><input name="cnpj" value="${esc(cfg.cnpj)}"></label>
      </section>
      <section class="bloco grade-campos">
        <h2 class="largo">Sobre a loja</h2>
        <label class="campo largo"><span>Título</span><input name="sobreTitulo" maxlength="80" value="${esc(cfg.sobreTitulo)}"></label>
        <label class="campo largo"><span>Texto (pule linha para separar parágrafos)</span><textarea name="sobreTexto" rows="6" maxlength="4000">${esc(cfg.sobreTexto)}</textarea></label>
      </section>
      <section class="bloco grade-campos">
        <h2 class="largo">Páginas de regras</h2>
        <p class="nota largo">Aparecem no rodapé. Linha começando com "## " vira título; com "- " vira item de lista. {loja} vira o nome da loja. Revise para que valha para a sua loja.</p>
        <label class="campo largo"><span>Trocas e devoluções</span><textarea name="textoDevolucoes" rows="12" maxlength="12000">${esc(cfg.textoDevolucoes)}</textarea></label>
        <label class="campo largo"><span>Termos de uso e privacidade</span><textarea name="textoTermos" rows="12" maxlength="12000">${esc(cfg.textoTermos)}</textarea></label>
      </section>
      <section class="bloco grade-campos">
        <h2 class="largo">Faixa de destaques (até 4 frases curtas)</h2>
        ${[0, 1, 2, 3].map(i => `<label class="campo"><span>Frase ${i + 1}</span><input name="selo" maxlength="80" value="${esc(cfg.selos?.[i] ?? '')}"></label>`).join('')}
      </section>
      <section class="bloco">
        <h2>Perguntas frequentes</h2>
        <p class="nota">Revise as respostas: elas precisam valer para a sua loja.</p>
        <div class="faq-editor" data-faq></div>
        <button class="link" type="button" data-mais-faq>+ Adicionar pergunta</button>
      </section>
      <p class="erro" role="alert" hidden></p>
      <div class="rodape-form"><button class="botao" type="submit">Salvar</button></div>
    </form>`;
    const caixa = corpo.querySelector('[data-faq]');
    const linhaFaq = (f = { p: '', r: '' }) => `
      <div class="faq-linha">
        <label class="campo"><span>Pergunta</span><input data-p maxlength="200" value="${esc(f.p)}"></label>
        <label class="campo"><span>Resposta</span><textarea data-r rows="3" maxlength="1500">${esc(f.r)}</textarea></label>
        <button class="link perigo" type="button" data-tirar-faq>Tirar</button>
      </div>`;
    caixa.innerHTML = (cfg.faq ?? []).map(linhaFaq).join('');
    corpo.querySelector('[data-mais-faq]').addEventListener('click', () => caixa.insertAdjacentHTML('beforeend', linhaFaq()));
    caixa.addEventListener('click', e => e.target.closest('[data-tirar-faq]')?.closest('.faq-linha').remove());
  }

  const form = corpo.querySelector('form');
  const erro = form.querySelector('.erro');
  form.querySelector('[data-email-teste]')?.addEventListener('click', async e => {
    const botao = e.currentTarget;
    botao.disabled = true;
    botao.textContent = 'Enviando…';
    try {
      const { para } = await api('POST', '/admin/email-teste', {});
      avisar(`E-mail enviado para ${para}. Confira a caixa de entrada e o spam.`);
    } catch (falha) {
      avisar(falha.message, 'erro');
    } finally {
      botao.disabled = false;
      botao.textContent = 'Enviar e-mail de teste';
    }
  });
  // Troca de imagens (com pré-visualização).
  form.querySelectorAll('[data-imagem]').forEach(q => {
    const chave = q.dataset.imagem;
    const previa = q.querySelector('[data-previa]');
    const maximo = chave === 'logo' ? 800 : chave === 'heroMobile' ? 1600 : 2400;
    q.querySelector('[data-arquivo]').addEventListener('change', async e => {
      const arquivo = e.target.files[0];
      e.target.value = '';
      if (!arquivo) return;
      try {
        const dados = await reduzir(arquivo, maximo, chave === 'logo');
        imagens[chave] = { dados };
        previa.src = dados;
        avisar('Imagem pronta. Clique em Salvar para publicar.');
      } catch (falha) {
        avisar(falha.message, 'erro');
      }
    });
    q.querySelector('[data-padrao]').addEventListener('click', () => {
      imagens[chave] = null;
      previa.src = { heroDesktop: '/static/img/hero-padrao-pc.jpg', heroMobile: '/static/img/hero-padrao-celular.jpg', logo: '/static/img/logo-branca.png' }[chave];
    });
  });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    erro.hidden = true;
    const dados = { ...imagens };
    for (const el of form.querySelectorAll('input[name], textarea[name]')) {
      if (el.name === 'selo' || el.type === 'file') continue;
      dados[el.name] = el.type === 'checkbox' ? el.checked : el.hasAttribute('data-numero') ? lerValor(el.value) : el.value;
    }
    if (aba === 'entrega') dados.freteServicos = [...form.querySelectorAll('[data-servico]:checked')].map(c => Number(c.value));
    if (aba === 'textos') {
      dados.selos = [...form.querySelectorAll('[name="selo"]')].map(i => i.value.trim()).filter(Boolean);
      dados.faq = [...form.querySelectorAll('.faq-linha')].map(l => ({ p: l.querySelector('[data-p]').value.trim(), r: l.querySelector('[data-r]').value.trim() })).filter(f => f.p && f.r);
    }
    const botao = form.querySelector('button[type="submit"]');
    botao.disabled = true;
    try {
      await api('PATCH', '/admin/aparencia', dados);
      avisar('Salvo. Já está no site.');
      abaConfig(corpo, aba);
    } catch (falha) {
      // Nada é salvo quando um campo está errado: o aviso precisa aparecer na tela.
      erro.textContent = `Não salvou: ${falha.message}`;
      erro.hidden = false;
      erro.scrollIntoView({ block: 'center', behavior: 'smooth' });
      avisar(`Não salvou: ${falha.message}`, 'erro');
      botao.disabled = false;
    }
  });
}

iniciar();
