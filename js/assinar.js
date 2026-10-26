// SIGAT Online - página pública de assinatura (não exige login)
const token = new URLSearchParams(window.location.search).get("t");
const quadro = $("quadro");
const ctx = quadro.getContext("2d");
let termo = null;
let desenhou = false;

function erro(texto) {
  $("carregando").hidden = true;
  $("erro").hidden = false;
  $("erro").innerHTML = `<div class="cartao"><div class="msg erro" style="margin-top:0">${esc(texto)}</div></div>`;
}

async function carregar() {
  if (!CONFIGURADO) return erro("Sistema ainda não configurado.");
  if (!/^[0-9a-f-]{36}$/i.test(token || "")) return erro("Link de assinatura inválido.");

  const { data, error } = await sb.rpc("termo_para_assinatura", { p_token: token });
  if (error) return erro(textoErro(error));
  if (!data) return erro("Link de assinatura inválido ou substituído por um novo link. Peça um novo link ao servidor que realizou o atendimento.");

  termo = data;
  $("carregando").hidden = true;
  if (termo.status === "assinado") {
    $("documento").innerHTML = `<div class="cartao"><div class="msg ok" style="margin-top:0">Este termo já foi assinado por
      <strong>${esc(termo.assinado_por)}</strong> em ${esc(dataHoraBR(termo.assinado_em))}.</div></div>`;
    return;
  }
  $("documento").innerHTML = htmlDocumento(termo, { semAssinatura: true });
  $("nome").value = termo.responsavel_nome || "";
  $("form-assinar").hidden = false;
  prepararQuadro();
}

// ---------- Quadro de desenho ----------
function prepararQuadro() {
  const escala = window.devicePixelRatio || 1;
  const r = quadro.getBoundingClientRect();
  quadro.width = r.width * escala;
  quadro.height = r.height * escala;
  ctx.scale(escala, escala);
  ctx.lineWidth = 2.4;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#0b1f3a";
  desenhou = false;
}

let desenhando = false;
function ponto(e) {
  const r = quadro.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}
quadro.addEventListener("pointerdown", (e) => {
  desenhando = true;
  quadro.setPointerCapture(e.pointerId);
  const p = ponto(e);
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
});
quadro.addEventListener("pointermove", (e) => {
  if (!desenhando) return;
  const p = ponto(e);
  ctx.lineTo(p.x, p.y);
  ctx.stroke();
  desenhou = true;
});
["pointerup", "pointercancel"].forEach((ev) => quadro.addEventListener(ev, () => (desenhando = false)));

$("btn-limpar").addEventListener("click", () => {
  ctx.clearRect(0, 0, quadro.width, quadro.height);
  desenhou = false;
});

// Reduz a imagem para um tamanho padrão antes de enviar
function imagemAssinatura() {
  const saida = document.createElement("canvas");
  saida.width = 600;
  saida.height = Math.round(600 * quadro.height / quadro.width);
  const c = saida.getContext("2d");
  c.fillStyle = "#fff";
  c.fillRect(0, 0, saida.width, saida.height);
  c.drawImage(quadro, 0, 0, saida.width, saida.height);
  return saida.toDataURL("image/png");
}

$("form-assinar").addEventListener("submit", async (e) => {
  e.preventDefault();
  mensagem("msg", "");
  const nome = $("nome").value.trim();
  if (nome.length < 3) return mensagem("msg", "Informe seu nome completo.");
  if (!desenhou) return mensagem("msg", "Desenhe sua assinatura no quadro.");
  if (!confirm("Confirmar a assinatura deste termo? Depois de assinado ele não poderá ser alterado.")) return;

  const img = imagemAssinatura();
  $("btn-assinar").disabled = true;
  const { data, error } = await sb.rpc("assinar_termo", { p_token: token, p_nome: nome, p_assinatura: img });
  $("btn-assinar").disabled = false;
  if (error) return mensagem("msg", textoErro(error));

  $("form-assinar").hidden = true;
  $("documento").innerHTML = htmlDocumento({
    ...termo, status: "assinado", assinado_por: nome, assinatura_img: img, assinado_em: data.assinado_em,
  });
  $("sucesso").hidden = false;
  window.scrollTo(0, 0);
});

carregar();
