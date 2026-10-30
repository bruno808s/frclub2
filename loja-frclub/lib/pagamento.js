// Frete (SuperFrete) e pagamento (Mercado Pago Checkout Pro). As chaves ficam só no Render, nunca no código.
// Variáveis: SUPERFRETE_TOKEN, MP_ACCESS_TOKEN. Opcionais: SUPERFRETE_URL (sandbox), SITE_URL.

const SUPERFRETE_URL = (process.env.SUPERFRETE_URL || 'https://api.superfrete.com').replace(/\/$/, '');
const MP_URL = (process.env.MP_API_URL || 'https://api.mercadopago.com').replace(/\/$/, ''); // MP_API_URL só para testes
const TEMPO_LIMITE = 12 * 1000;

export const freteLigado = cfg => Boolean(process.env.SUPERFRETE_TOKEN && /^\d{8}$/.test(cfg.cepOrigem || ''));
export const pagamentoLigado = () => Boolean(process.env.MP_ACCESS_TOKEN);

// Erro com mensagem que pode ser mostrada ao cliente.
export class ErroServico extends Error {}

async function chamar(url, opcoes, servico) {
  let r;
  try {
    r = await fetch(url, { ...opcoes, signal: AbortSignal.timeout(TEMPO_LIMITE) });
  } catch {
    throw new ErroServico(`${servico} não respondeu. Tente de novo em instantes.`);
  }
  const dados = await r.json().catch(() => null);
  if (!r.ok) {
    console.error(`${servico} respondeu ${r.status}:`, JSON.stringify(dados)?.slice(0, 500));
    throw new ErroServico(`${servico} recusou o pedido (${r.status}).`);
  }
  return dados;
}

// ---------- frete ----------
// Cada peça vai como um volume com as medidas padrão do painel; a SuperFrete monta a caixa ideal.
export async function cotarFrete(cfg, cepDestino, quantidade, valorDeclarado) {
  const opcoes = await cotarUmaVez(cfg, cepDestino, quantidade, valorDeclarado);
  // Os Correios recusam valor declarado fora dos limites de cada serviço; sem seguro a cotação sai mesmo assim.
  if (!opcoes.length && valorDeclarado > 0) return cotarUmaVez(cfg, cepDestino, quantidade, 0);
  return opcoes;
}

async function cotarUmaVez(cfg, cepDestino, quantidade, valorDeclarado) {
  const resposta = await chamar(`${SUPERFRETE_URL}/api/v0/calculator`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.SUPERFRETE_TOKEN}`,
      'User-Agent': `${cfg.nomeLoja} loja (${cfg.email || 'sem-email'})`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: { postal_code: cfg.cepOrigem },
      to: { postal_code: cepDestino },
      services: cfg.freteServicos || '1,2,17',
      options: { own_hand: false, receipt: false, insurance_value: valorDeclarado, use_insurance_value: valorDeclarado > 0 },
      products: [{ quantity: quantidade, weight: cfg.pacotePeso, height: cfg.pacoteAltura, width: cfg.pacoteLargura, length: cfg.pacoteComprimento }],
    }),
  }, 'O cálculo de frete');
  const lista = Array.isArray(resposta) ? resposta : Array.isArray(resposta?.data) ? resposta.data : [];
  const validas = lista.filter(o => !o.has_error && !o.error && Number(o.price) > 0);
  // Sem nenhuma opção, registra o motivo de cada serviço para aparecer nos Logs do Render.
  if (!validas.length) {
    const motivos = lista.length ? lista.map(o => `${o.name || o.id}: ${o.error || o.message || 'sem preço'}`).join(' | ') : JSON.stringify(resposta)?.slice(0, 500);
    console.error(`SuperFrete sem opções (${cfg.cepOrigem} -> ${cepDestino}, seguro ${valorDeclarado}):`, motivos);
  }
  return validas
    .map(o => ({
      id: Number(o.id),
      nome: String(o.name || ''),
      empresa: String(o.company?.name || ''),
      preco: Math.round(Number(o.price) * 100) / 100,
      prazo: Number(o.delivery_time) || null,
    }))
    .sort((a, b) => a.preco - b.preco);
}

// ---------- Mercado Pago ----------
const cabecalhoMp = () => ({ Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' });

export async function criarCobranca({ pedido, itens, cliente, frete, baseUrl, nomeLoja }) {
  const https = baseUrl.startsWith('https://');
  const volta = `${baseUrl}/pedido/${pedido.codigo}`;
  const [nome, ...sobrenome] = cliente.nome.split(' ');
  const pref = await chamar(`${MP_URL}/checkout/preferences`, {
    method: 'POST',
    headers: { ...cabecalhoMp(), 'X-Idempotency-Key': pedido.codigo },
    body: JSON.stringify({
      items: itens.map(i => ({
        id: String(i.id),
        title: `${i.marca ? `${i.marca} ` : ''}${i.nome}${i.tamanho ? ` (tam. ${i.tamanho})` : ''}`.slice(0, 250),
        quantity: i.quantidade,
        unit_price: i.preco,
        currency_id: 'BRL',
        ...(https && i.foto ? { picture_url: `${baseUrl}${i.foto}` } : {}),
      })),
      payer: {
        name: nome,
        surname: sobrenome.join(' '),
        email: cliente.email,
        identification: { type: 'CPF', number: cliente.cpf },
        address: { zip_code: cliente.cep, street_name: cliente.rua, street_number: cliente.numero },
      },
      shipments: { cost: frete.preco, mode: 'not_specified' },
      external_reference: pedido.codigo,
      back_urls: { success: volta, pending: volta, failure: volta },
      ...(https ? { auto_return: 'approved', notification_url: `${baseUrl}/api/mercadopago/aviso` } : {}),
      statement_descriptor: nomeLoja.replace(/[^A-Za-z0-9 ]/g, '').slice(0, 13) || undefined,
      payment_methods: { installments: 12 },
      expires: true,
      expiration_date_to: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
    }),
  }, 'O Mercado Pago');
  return { id: String(pref.id), link: String(pref.init_point) };
}

// O status sempre vem do Mercado Pago, nunca do que o navegador ou o aviso mandam.
export async function buscarPagamento(id) {
  const p = await chamar(`${MP_URL}/v1/payments/${encodeURIComponent(id)}`, { headers: cabecalhoMp() }, 'O Mercado Pago');
  return {
    id: String(p.id),
    status: String(p.status || ''),
    referencia: String(p.external_reference || ''),
    // Com o frete à parte (shipping_amount) ou já somado (total_paid_amount, que inclui juros do parcelamento).
    valor: Math.max((Number(p.transaction_amount) || 0) + (Number(p.shipping_amount) || 0), Number(p.transaction_details?.total_paid_amount) || 0),
    metodo: String(p.payment_type_id || ''),
  };
}
