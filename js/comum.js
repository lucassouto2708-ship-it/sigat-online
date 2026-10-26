// Funções usadas tanto no sistema quanto na página de assinatura
const CFG = window.SIGAT_CONFIG;
const CONFIGURADO = CFG && CFG.SUPABASE_URL.startsWith("https://") && !CFG.SUPABASE_ANON_KEY.startsWith("COLE_");
const sb = CONFIGURADO ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY) : null;

const $ = (id) => document.getElementById(id);

function esc(valor) {
  return String(valor ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function dataBR(iso) {
  if (!iso) return "";
  const [a, m, d] = String(iso).slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

function dataHoraBR(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function mensagem(alvoId, texto, tipo = "erro") {
  $(alvoId).innerHTML = texto ? `<div class="msg ${tipo}">${esc(texto)}</div>` : "";
}

// Traduz mensagens de erro comuns do Supabase
function textoErro(erro) {
  const m = erro?.message || String(erro);
  if (/Invalid login credentials/i.test(m)) return "E-mail ou senha incorretos.";
  if (/Failed to fetch|NetworkError/i.test(m)) return "Sem conexão com o servidor. Verifique a internet.";
  if (/row-level security/i.test(m)) return "Você não tem permissão para esta ação.";
  return m;
}

// Monta o HTML do termo (usado na tela, na impressão e na página de assinatura)
function htmlDocumento(t, opcoes = {}) {
  const assinado = t.status === "assinado";
  const assinatura = assinado ? `
    <div class="doc-assinatura">
      ${t.assinatura_img ? `<img src="${esc(t.assinatura_img)}" alt="Assinatura de ${esc(t.assinado_por)}">` : ""}
      <div class="linha"></div>
      <strong>${esc(t.assinado_por)}</strong>
      <small>Responsável pelo atendimento — assinado eletronicamente em ${esc(dataHoraBR(t.assinado_em))}</small>
    </div>` : (opcoes.semAssinatura ? "" : `
    <div class="doc-assinatura">
      <div style="height:70px"></div><div class="linha"></div>
      <strong>${esc(t.responsavel_nome)}</strong>
      <small>Aguardando assinatura do responsável</small>
    </div>`);

  return `
  <div class="documento">
    <div class="doc-cabecalho">
      <div class="empresa">${esc(CFG?.EMPRESA || "TR Assessoria Pública")}<small>SIGAT Online — Sistema Integrado de Gestão de Atendimentos e Termos</small></div>
      <div class="doc-numero">Termo nº<br><strong>${esc(t.numero)}</strong></div>
    </div>
    <p class="doc-titulo">TERMO DE ATENDIMENTO</p>
    <div class="doc-grade">
      <div><span>Data do atendimento</span>${esc(dataBR(t.data_atendimento))}</div>
      <div><span>Tipo de atendimento</span>${esc(t.tipo)}</div>
      <div><span>Local</span>${esc(t.local)}</div>
      <div><span>Setor</span>${esc(t.setor || "—")}</div>
      <div><span>Responsável</span>${esc(t.responsavel_nome)}</div>
      <div><span>Servidor que realizou</span>${esc(t.servidor_nome)}</div>
    </div>
    <div class="doc-texto"><span>Descrição do serviço realizado</span><p>${esc(t.descricao)}</p></div>
    <div class="doc-texto"><span>Situação / resolução</span><p>${esc(t.situacao)}</p></div>
    <p>Declaro, para os devidos fins, que o atendimento acima descrito foi realizado.</p>
    ${assinatura}
    <div class="doc-rodape">
      Documento gerado pelo SIGAT Online. Assinatura eletrônica simples, realizada por desenho em tela
      mediante link exclusivo${assinado ? `, registrada em ${esc(dataHoraBR(t.assinado_em))}` : ""}.
      Não se trata de assinatura digital com certificado ICP-Brasil.
    </div>
  </div>`;
}
