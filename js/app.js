// SIGAT Online - sistema interno (login, painel, termos, servidores)
let perfil = null;     // { id, nome, email, papel }
let termosCache = [];

const ehAdmin = () => perfil?.papel === "admin";

// ---------------------------------------------------------------------
// Início e login
// ---------------------------------------------------------------------
async function iniciar() {
  if (!CONFIGURADO) { $("aviso-config").hidden = false; return; }
  const { data } = await sb.auth.getSession();
  if (data.session) await entrar(data.session.user);
  else mostrarLogin();
}

function mostrarLogin() {
  perfil = null;
  $("tela-sistema").hidden = true;
  $("tela-login").hidden = false;
}

async function entrar(usuario) {
  const { data, error } = await sb.from("perfis").select("*").eq("id", usuario.id).single();
  if (error || !data) {
    await sb.auth.signOut();
    mostrarLogin();
    mensagem("login-msg", "Seu usuário não possui perfil no sistema. Fale com o administrador.");
    return;
  }
  if (!data.ativo) {
    await sb.auth.signOut();
    mostrarLogin();
    mensagem("login-msg", "Seu acesso está desativado. Fale com o administrador.");
    return;
  }
  perfil = data;
  $("usuario-nome").textContent = `${perfil.nome} (${ehAdmin() ? "admin" : "servidor"})`;
  document.querySelectorAll(".so-admin").forEach((el) => (el.hidden = !ehAdmin()));
  $("tela-login").hidden = true;
  $("tela-sistema").hidden = false;
  ir("painel");
}

$("form-login").addEventListener("submit", async (e) => {
  e.preventDefault();
  mensagem("login-msg", "");
  const { data, error } = await sb.auth.signInWithPassword({
    email: $("login-email").value.trim(),
    password: $("login-senha").value,
  });
  if (error) return mensagem("login-msg", textoErro(error));
  $("login-senha").value = "";
  await entrar(data.user);
});

$("btn-sair").addEventListener("click", async () => {
  await sb.auth.signOut();
  mostrarLogin();
});

// ---------------------------------------------------------------------
// Navegação
// ---------------------------------------------------------------------
function ir(nome, param) {
  document.querySelectorAll(".view").forEach((v) => (v.hidden = v.id !== `view-${nome}`));
  document.querySelectorAll(".menu button").forEach((b) => b.classList.toggle("ativo", b.dataset.ir === nome));
  window.scrollTo(0, 0);
  if (nome === "painel") carregarPainel();
  if (nome === "novo") abrirFormulario(param);
  if (nome === "termos") carregarTermos();
  if (nome === "termo") abrirTermo(param);
  if (nome === "servidores") carregarServidores();
}

document.querySelectorAll(".menu button").forEach((b) => b.addEventListener("click", () => ir(b.dataset.ir)));

function linhaTermo(t) {
  return `<tr class="clicavel" data-id="${t.id}">
    <td><strong>${esc(t.numero)}</strong></td>
    <td>${esc(dataBR(t.data_atendimento))}</td>
    <td>${esc(t.local)}${t.setor ? `<br><small>${esc(t.setor)}</small>` : ""}</td>
    <td>${esc(t.responsavel_nome)}</td>
    ${ehAdmin() ? `<td>${esc(t.servidor_nome)}</td>` : ""}
    <td>${t.status === "assinado"
      ? '<span class="selo assinado">Assinado</span>'
      : '<span class="selo pendente">Aguardando assinatura</span>'}</td>
  </tr>`;
}

function ligarCliques(tbody) {
  tbody.querySelectorAll("tr.clicavel").forEach((tr) => tr.addEventListener("click", () => ir("termo", Number(tr.dataset.id))));
}

const COLUNAS_LISTA = "id, numero, data_atendimento, local, setor, responsavel_nome, servidor_nome, status, criado_em";

// ---------------------------------------------------------------------
// Painel
// ---------------------------------------------------------------------
async function carregarPainel() {
  $("painel-titulo").textContent = ehAdmin() ? "Painel geral" : "Meus atendimentos";
  $("ind-total-rotulo").textContent = ehAdmin() ? "Total de atendimentos" : "Meus atendimentos";

  // As regras do banco já limitam o servidor aos próprios termos
  const contar = (filtro) => {
    let q = sb.from("termos").select("id", { count: "exact", head: true });
    if (filtro) q = q.eq("status", filtro);
    return q;
  };
  const [total, assinados, pendentes, ultimos] = await Promise.all([
    contar(), contar("assinado"), contar("pendente"),
    sb.from("termos").select(COLUNAS_LISTA).order("criado_em", { ascending: false }).limit(10),
  ]);
  $("ind-total").textContent = total.count ?? "–";
  $("ind-assinados").textContent = assinados.count ?? "–";
  $("ind-pendentes").textContent = pendentes.count ?? "–";

  if (ehAdmin()) {
    const serv = await sb.from("perfis").select("id", { count: "exact", head: true }).eq("papel", "servidor");
    $("ind-servidores").textContent = serv.count ?? "–";
  }

  const tbody = $("painel-lista");
  if (ultimos.error) {
    tbody.innerHTML = `<tr><td colspan="6" class="vazio">${esc(textoErro(ultimos.error))}</td></tr>`;
  } else if (!ultimos.data.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="vazio">Nenhum atendimento cadastrado ainda.</td></tr>';
  } else {
    tbody.innerHTML = ultimos.data.map(linhaTermo).join("");
    ligarCliques(tbody);
  }
}

// ---------------------------------------------------------------------
// Cadastro / edição de atendimento
// ---------------------------------------------------------------------
const CAMPOS = {
  "f-data": "data_atendimento", "f-tipo": "tipo", "f-local": "local", "f-setor": "setor",
  "f-resp": "responsavel_nome", "f-tel": "responsavel_telefone", "f-desc": "descricao", "f-sit": "situacao",
};

async function abrirFormulario(id) {
  $("form-termo").reset();
  mensagem("form-msg", "");
  $("termo-id").value = id || "";
  $("form-titulo").textContent = id ? "Editar atendimento" : "Novo atendimento";
  $("btn-salvar").disabled = false;
  if (!id) {
    $("f-data").value = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
    return;
  }
  const { data, error } = await sb.from("termos").select("*").eq("id", id).single();
  if (error) return mensagem("form-msg", textoErro(error));
  if (data.status === "assinado") {
    $("btn-salvar").disabled = true;
    return mensagem("form-msg", "Este termo já foi assinado e não pode mais ser alterado.", "aviso");
  }
  $("form-titulo").textContent = `Editar atendimento ${data.numero}`;
  for (const [campo, coluna] of Object.entries(CAMPOS)) $(campo).value = data[coluna] ?? "";
}

$("form-termo").addEventListener("submit", async (e) => {
  e.preventDefault();
  const dados = {};
  for (const [campo, coluna] of Object.entries(CAMPOS)) dados[coluna] = $(campo).value.trim() || null;
  const id = Number($("termo-id").value) || null;

  $("btn-salvar").disabled = true;
  const res = id
    ? await sb.from("termos").update(dados).eq("id", id).select("id").single()
    : await sb.from("termos").insert(dados).select("id").single();
  $("btn-salvar").disabled = false;

  if (res.error) return mensagem("form-msg", textoErro(res.error));
  ir("termo", res.data.id);
});

$("btn-cancelar").addEventListener("click", () => {
  const id = Number($("termo-id").value);
  id ? ir("termo", id) : ir("painel");
});

// ---------------------------------------------------------------------
// Lista de termos
// ---------------------------------------------------------------------
async function carregarTermos() {
  const tbody = $("termos-lista");
  tbody.innerHTML = '<tr><td colspan="6" class="vazio">Carregando…</td></tr>';
  const { data, error } = await sb.from("termos").select(COLUNAS_LISTA).order("criado_em", { ascending: false }).limit(1000);
  if (error) {
    tbody.innerHTML = `<tr><td colspan="6" class="vazio">${esc(textoErro(error))}</td></tr>`;
    return;
  }
  termosCache = data;
  filtrarTermos();
}

function filtrarTermos() {
  const busca = $("busca").value.trim().toLowerCase();
  const status = $("filtro-status").value;
  const lista = termosCache.filter((t) =>
    (!status || t.status === status) &&
    (!busca || [t.numero, t.local, t.setor, t.responsavel_nome, t.servidor_nome].join(" ").toLowerCase().includes(busca)));
  const tbody = $("termos-lista");
  tbody.innerHTML = lista.length
    ? lista.map(linhaTermo).join("")
    : '<tr><td colspan="6" class="vazio">Nenhum termo encontrado.</td></tr>';
  ligarCliques(tbody);
}

$("busca").addEventListener("input", filtrarTermos);
$("filtro-status").addEventListener("change", filtrarTermos);

// ---------------------------------------------------------------------
// Visualizar termo, link de assinatura, impressão
// ---------------------------------------------------------------------
function linkAssinatura(token) {
  return new URL(`assinar.html?t=${token}`, window.location.href).href;
}

function linkWhatsApp(t) {
  const texto = `Olá, ${t.responsavel_nome}! Segue o link para assinatura do Termo de Atendimento ${t.numero} `
    + `(${CFG.EMPRESA}):\n${linkAssinatura(t.token_assinatura)}`;
  let fone = (t.responsavel_telefone || "").replace(/\D/g, "");
  if (fone.length === 10 || fone.length === 11) fone = "55" + fone;
  return `https://wa.me/${fone}?text=${encodeURIComponent(texto)}`;
}

async function abrirTermo(id) {
  const acoes = $("termo-acoes");
  acoes.innerHTML = "Carregando…";
  $("termo-documento").innerHTML = "";
  const { data: t, error } = await sb.from("termos").select("*").eq("id", id).single();
  if (error) { acoes.innerHTML = `<div class="msg erro">${esc(textoErro(error))}</div>`; return; }

  $("termo-documento").innerHTML = htmlDocumento(t);

  if (t.status === "assinado") {
    acoes.innerHTML = `
      <div class="msg ok" style="margin-top:0">Termo assinado por <strong>${esc(t.assinado_por)}</strong> em ${esc(dataHoraBR(t.assinado_em))}.
        Documento bloqueado: não pode mais ser alterado.</div>
      <div class="botoes">
        <button class="btn" id="btn-imprimir">Imprimir / Salvar PDF</button>
        <button class="btn sec" id="btn-voltar">Voltar</button>
        ${ehAdmin() ? '<button class="btn perigo" id="btn-excluir">Excluir</button>' : ""}
      </div>
      <div id="termo-msg"></div>`;
  } else {
    const link = linkAssinatura(t.token_assinatura);
    acoes.innerHTML = `
      <h2>Termo ${esc(t.numero)} — aguardando assinatura</h2>
      <label for="link-assinatura">Link para o responsável assinar</label>
      <div class="link-box"><input id="link-assinatura" readonly value="${esc(link)}"><button class="btn sec pequeno" id="btn-copiar">Copiar</button></div>
      <div class="botoes">
        <a class="btn verde" href="${esc(linkWhatsApp(t))}" target="_blank" rel="noopener">Enviar pelo WhatsApp</a>
        <button class="btn sec" id="btn-editar">Editar</button>
        <button class="btn sec" id="btn-novo-link">Gerar novo link</button>
        <button class="btn sec" id="btn-imprimir">Imprimir</button>
        <button class="btn sec" id="btn-voltar">Voltar</button>
        ${ehAdmin() ? '<button class="btn perigo" id="btn-excluir">Excluir</button>' : ""}
      </div>
      <div id="termo-msg"></div>`;

    $("btn-copiar").addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(link); } catch { $("link-assinatura").select(); document.execCommand("copy"); }
      mensagem("termo-msg", "Link copiado.", "ok");
    });
    $("btn-editar").addEventListener("click", () => ir("novo", t.id));
    $("btn-novo-link").addEventListener("click", async () => {
      if (!confirm("Gerar um novo link? O link anterior deixará de funcionar.")) return;
      const { error: erro } = await sb.from("termos").update({ token_assinatura: crypto.randomUUID() }).eq("id", t.id);
      if (erro) return mensagem("termo-msg", textoErro(erro));
      abrirTermo(t.id);
    });
  }
  $("btn-imprimir").addEventListener("click", () => window.print());
  $("btn-voltar").addEventListener("click", () => ir("termos"));
  if (ehAdmin()) $("btn-excluir").addEventListener("click", () => excluirTermo(t));
}

// Só o administrador exclui. O banco guarda uma cópia na lixeira (termos_excluidos).
async function excluirTermo(t) {
  const aviso = t.status === "assinado" ? "ATENÇÃO: este termo JÁ FOI ASSINADO.\n\n" : "";
  const digitado = prompt(`${aviso}Para excluir, digite o número do termo:\n${t.numero}`);
  if (digitado === null) return;
  if (digitado.trim().toUpperCase() !== t.numero) return mensagem("termo-msg", "Número digitado não confere. Nada foi excluído.");
  const { data, error } = await sb.from("termos").delete().eq("id", t.id).select("id");
  if (error) return mensagem("termo-msg", textoErro(error));
  if (!data?.length) return mensagem("termo-msg", "Não foi possível excluir este termo.");
  alert(`Termo ${t.numero} excluído.`);
  ir("termos");
}

// ---------------------------------------------------------------------
// Servidores (somente admin)
// ---------------------------------------------------------------------
async function carregarServidores() {
  const tbody = $("servidores-lista");
  const { data, error } = await sb.from("perfis").select("*").order("nome");
  if (error) { tbody.innerHTML = `<tr><td colspan="5" class="vazio">${esc(textoErro(error))}</td></tr>`; return; }
  tbody.innerHTML = data.map((p) => `
    <tr>
      <td>${esc(p.nome)}</td>
      <td>${esc(p.email)}</td>
      <td>${p.papel === "admin" ? "Administrador" : "Servidor"}</td>
      <td>${p.ativo ? '<span class="selo assinado">Ativo</span>' : '<span class="selo inativo">Desativado</span>'}</td>
      <td>${p.id === perfil.id ? "" : `<button class="btn sec pequeno" data-ativar="${p.id}" data-valor="${!p.ativo}">${p.ativo ? "Desativar" : "Reativar"}</button>`}</td>
    </tr>`).join("");
  tbody.querySelectorAll("[data-ativar]").forEach((b) => b.addEventListener("click", async () => {
    const { error: erro } = await sb.from("perfis").update({ ativo: b.dataset.valor === "true" }).eq("id", b.dataset.ativar);
    if (erro) return mensagem("servidor-msg", textoErro(erro));
    carregarServidores();
  }));
}

$("form-servidor").addEventListener("submit", async (e) => {
  e.preventDefault();
  mensagem("servidor-msg", "");
  const { data, error } = await sb.functions.invoke("criar-servidor", {
    body: {
      nome: $("s-nome").value, email: $("s-email").value,
      senha: $("s-senha").value, papel: $("s-papel").value,
    },
  });
  if (error) {
    let texto = textoErro(error);
    try { texto = (await error.context.json()).erro || texto; } catch { /* resposta sem JSON */ }
    return mensagem("servidor-msg", texto);
  }
  if (data?.erro) return mensagem("servidor-msg", data.erro);
  mensagem("servidor-msg", "Servidor cadastrado. Ele já pode entrar com o e-mail e a senha inicial.", "ok");
  $("form-servidor").reset();
  carregarServidores();
});

iniciar();
