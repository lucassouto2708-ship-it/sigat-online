// SIGAT Online - agenda semanal dos técnicos
// O admin envia a imagem da agenda; o painel mostra quem vai para onde em cada dia
// e cobra um termo de atendimento por dia agendado (inclusive dias no escritório).
const DIAS_SEMANA = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta"];
const DESTINOS_PADRAO = [
  "TR", "Home Office", "Coroaci", "Cisdoce", "Jampruca", "Mathias Lobato", "Itabirinha", "Sardoa", "Mutum",
  "Santa Efigênia de Minas", "Capitão Andrade", "Alpercata",
];
const ehEscritorio = (d) => normalizar(d) === "tr";

const hojeISO = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
function segundaDaSemana(iso) {
  const d = new Date(iso + "T12:00:00Z");
  return somarDias(iso, -((d.getUTCDay() + 6) % 7));
}
const diaMes = (iso) => dataBR(iso).slice(0, 5);

let agendaSemana = segundaDaSemana(hojeISO());
let agendaAtualId = null;

// Local sugerido no termo, a partir do destino da agenda
function localDoDestino(destino) {
  if (ehEscritorio(destino)) return "TR Assessoria Pública (sede)";
  return destino;
}

// ---------------------------------------------------------------------
// Quadro no painel
// ---------------------------------------------------------------------
async function carregarAgenda() {
  const quadro = $("agenda-quadro");
  const fim = somarDias(agendaSemana, 4);
  $("agenda-periodo").textContent = `${dataBR(agendaSemana)} a ${dataBR(fim)}`;
  $("agenda-titulo").textContent = ehAdmin() ? "Agenda da semana" : "Minha agenda da semana";
  $("agenda-imagem").hidden = true;
  $("agenda-imagem").innerHTML = "";
  $("agenda-ver-imagem").hidden = true;
  quadro.innerHTML = '<p class="vazio">Carregando…</p>';

  const semana = agendaSemana;
  const { data: ag, error } = await sb.from("agendas").select("id").eq("semana_inicio", semana).maybeSingle();
  if (semana !== agendaSemana) return; // trocou de semana enquanto carregava
  if (error) { quadro.innerHTML = `<p class="vazio">${esc(textoErro(error))}</p>`; return; }
  agendaAtualId = ag?.id || null;
  if (!ag) {
    quadro.innerHTML = `<p class="vazio">Nenhuma agenda enviada para esta semana.${ehAdmin() ? " Use o botão “Enviar agenda da semana”." : ""}</p>`;
    return;
  }
  $("agenda-ver-imagem").hidden = false;

  const [itens, termos] = await Promise.all([
    sb.from("agenda_itens").select("*").eq("agenda_id", ag.id).order("id"),
    sb.from("termos").select("id, numero, servidor_id, data_atendimento").gte("data_atendimento", semana).lte("data_atendimento", fim),
  ]);
  if (semana !== agendaSemana) return;
  if (itens.error || termos.error) { quadro.innerHTML = `<p class="vazio">${esc(textoErro(itens.error || termos.error))}</p>`; return; }
  if (!itens.data.length) {
    quadro.innerHTML = `<p class="vazio">${ehAdmin() ? "A agenda desta semana está vazia." : "Você não tem atribuições na agenda desta semana."}</p>`;
    return;
  }

  // Agrupa por técnico, na ordem da imagem
  const tecnicos = [];
  for (const it of itens.data) {
    let t = tecnicos.find((x) => x.nome === it.tecnico_nome);
    if (!t) tecnicos.push((t = { nome: it.tecnico_nome, servidor_id: it.servidor_id, dias: {} }));
    t.dias[it.data] = it;
  }

  const hoje = hojeISO();
  const datas = [0, 1, 2, 3, 4].map((k) => somarDias(semana, k));
  let atrasados = 0;
  const celula = (t, data) => {
    const it = t.dias[data];
    if (!it) return '<td class="ag-cel ag-vazio">—</td>';
    const feitos = it.servidor_id ? termos.data.filter((x) => x.servidor_id === it.servidor_id && x.data_atendimento === data) : [];
    let estado = "futuro", dica = "Dia ainda não chegou";
    if (!it.servidor_id) { estado = "sem-usuario"; dica = "Técnico sem usuário no sistema: não é cobrado"; }
    else if (feitos.length) { estado = "ok"; dica = `Termo feito: ${feitos.map((x) => x.numero).join(", ")}`; }
    else if (data < hoje) { estado = "falta"; dica = "Dia passado sem termo de atendimento"; atrasados++; }
    else if (data === hoje) { estado = "hoje"; dica = "Hoje: termo ainda não feito"; }
    const meu = it.servidor_id === perfil.id;
    const clicavel = (estado === "ok") || (meu && estado !== "sem-usuario");
    const icone = { ok: "✔", falta: "!", hoje: "•" }[estado] || "";
    return `<td class="ag-cel ag-${estado}${clicavel ? " ag-clica" : ""}" title="${esc(dica)}"
      ${estado === "ok" ? `data-termo="${feitos[0].id}"` : ""}
      ${clicavel && estado !== "ok" ? `data-novo="${esc(data)}" data-destino="${esc(it.destino)}"` : ""}>
      <span class="ag-destino">${esc(it.destino)}</span>${ehEscritorio(it.destino) ? '<small>escritório</small>' : ""}
      ${icone ? `<span class="ag-icone">${icone}</span>` : ""}</td>`;
  };

  const corpo = tecnicos.map((t) => `
    <tr>
      <th class="ag-nome">${esc(t.nome)}${t.servidor_id ? "" : ' <small title="Sem usuário vinculado">(sem usuário)</small>'}</th>
      ${datas.map((d) => celula(t, d)).join("")}
    </tr>`).join("");

  quadro.innerHTML = `
    ${atrasados ? `<div class="msg erro ag-alerta">${atrasados} ${atrasados === 1 ? "dia agendado está" : "dias agendados estão"} sem termo de atendimento.</div>` : ""}
    <div class="tabela-wrap"><table class="agenda">
      <thead><tr><th>Técnico</th>${datas.map((d, k) => `<th class="${d === hoje ? "ag-dia-hoje" : ""}">${DIAS_SEMANA[k]}<small>${diaMes(d)}</small></th>`).join("")}</tr></thead>
      <tbody>${corpo}</tbody>
    </table></div>
    ${tecnicos.some((t) => t.servidor_id === perfil.id) ? '<small style="color:var(--suave)">Clique num dia seu para abrir o termo daquele dia já preenchido com a data e o local.</small>' : ""}`;

  quadro.querySelectorAll("[data-termo]").forEach((td) => td.addEventListener("click", () => ir("termo", Number(td.dataset.termo))));
  quadro.querySelectorAll("[data-novo]").forEach((td) => td.addEventListener("click", () =>
    ir("novo", { data: td.dataset.novo, local: localDoDestino(td.dataset.destino) })));
}

$("agenda-ant").addEventListener("click", () => { agendaSemana = somarDias(agendaSemana, -7); carregarAgenda(); });
$("agenda-prox").addEventListener("click", () => { agendaSemana = somarDias(agendaSemana, 7); carregarAgenda(); });
$("agenda-enviar").addEventListener("click", () => ir("agenda"));
$("agenda-ver-imagem").addEventListener("click", async () => {
  const box = $("agenda-imagem");
  if (!box.hidden) { box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = '<p class="vazio">Carregando imagem…</p>';
  const { data, error } = await sb.from("agendas").select("imagem").eq("id", agendaAtualId).single();
  if (error) { box.innerHTML = `<p class="vazio">${esc(textoErro(error))}</p>`; return; }
  box.innerHTML = data.imagem
    ? `<img class="agenda-img" src="${esc(data.imagem)}" alt="Imagem da agenda da semana">`
    : '<p class="vazio">Esta agenda não tem imagem.</p>';
});

// ---------------------------------------------------------------------
// Envio da agenda (admin): imagem -> leitura -> conferência -> salvar
// ---------------------------------------------------------------------
let envio = { imagem: null, perfis: [] };

function abrirEnvioAgenda() {
  envio = { imagem: null, perfis: [] };
  $("agenda-arquivo").value = "";
  $("agenda-progresso").hidden = true;
  $("form-agenda").hidden = true;
  mensagem("agenda-msg", "");
  mensagem("agenda-salvar-msg", "");
}

// Reduz a imagem para guardar no banco (JPEG, até 1800 px de largura)
function comprimirImagem(arquivo) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const escala = Math.min(1, 1800 / img.naturalWidth);
      const c = document.createElement("canvas");
      c.width = Math.round(img.naturalWidth * escala);
      c.height = Math.round(img.naturalHeight * escala);
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => reject(new Error("Não foi possível abrir a imagem."));
    img.src = URL.createObjectURL(arquivo);
  });
}

function opcoesPerfis(selecionado) {
  return '<option value="">— sem usuário —</option>' + envio.perfis.map((p) =>
    `<option value="${p.id}"${p.id === selecionado ? " selected" : ""}>${esc(p.nome)}</option>`).join("");
}

function linhaConferencia(t = { nome: "", servidor_id: "", dias: ["", "", "", "", ""] }) {
  return `<tr>
    <td><input class="ag-c-nome" value="${esc(t.nome)}" aria-label="Nome do técnico"></td>
    <td><select class="ag-c-perfil" aria-label="Usuário do sistema">${opcoesPerfis(t.servidor_id)}</select></td>
    ${t.dias.map((d, k) => `<td><input class="ag-c-dia" data-k="${k}" value="${esc(d)}" list="agenda-destinos" aria-label="${DIAS_SEMANA[k]}"></td>`).join("")}
    <td><button type="button" class="btn perigo pequeno ag-c-remover" title="Remover técnico">×</button></td>
  </tr>`;
}

function cabecalhoConferencia() {
  const seg = $("agenda-semana").value;
  $("agenda-conf-cab").innerHTML = `<tr><th>Técnico</th><th>Usuário no sistema</th>${DIAS_SEMANA.map((d, k) =>
    `<th>${d}${seg ? `<small>${diaMes(somarDias(seg, k))}</small>` : ""}</th>`).join("")}<th></th></tr>`;
}

function ligarRemover() {
  $("agenda-conf-lista").querySelectorAll(".ag-c-remover").forEach((b) => (b.onclick = () => b.closest("tr").remove()));
}

$("agenda-semana").addEventListener("change", cabecalhoConferencia);
$("agenda-linha").addEventListener("click", () => {
  $("agenda-conf-lista").insertAdjacentHTML("beforeend", linhaConferencia());
  ligarRemover();
});
$("agenda-cancelar").addEventListener("click", () => ir("painel"));

$("agenda-arquivo").addEventListener("change", async () => {
  const arquivo = $("agenda-arquivo").files[0];
  if (!arquivo) return;
  mensagem("agenda-msg", "");
  $("form-agenda").hidden = true;
  if (!["image/jpeg", "image/png"].includes(arquivo.type)) return mensagem("agenda-msg", "Envie uma imagem JPG ou PNG.");

  $("agenda-progresso").hidden = false;
  const progresso = (f, texto) => { $("agenda-barra").value = f; $("agenda-etapa").textContent = texto; };

  const [perfis, usados] = await Promise.all([
    sb.from("perfis").select("id, nome, ativo").order("nome"),
    sb.from("agenda_itens").select("destino").order("id", { ascending: false }).limit(1000),
  ]);
  envio.perfis = (perfis.data || []).filter((p) => p.ativo);
  const conhecidos = [...new Set([...DESTINOS_PADRAO, ...(usados.data || []).map((x) => x.destino)])];
  let lidos = null;
  try {
    envio.imagem = await comprimirImagem(arquivo);
    lidos = await lerAgendaDaImagem(arquivo, progresso);
  } catch (erro) {
    mensagem("agenda-msg", `Não foi possível ler a imagem automaticamente (${erro.message}). Preencha a agenda manualmente abaixo.`, "aviso");
  }
  $("agenda-progresso").hidden = true;
  if (!envio.imagem) return;

  let linhas;
  if (lidos?.tecnicos.length) {
    linhas = lidos.tecnicos.map((t) => {
      const p = acharPerfil(t.nome, envio.perfis);
      return { nome: p?.nome || t.nome, servidor_id: p?.id || "", dias: t.dias.map((d) => corrigirDestino(d, conhecidos)) };
    });
    mensagem("agenda-msg", `Imagem lida: ${linhas.length} técnicos. Confira os dados abaixo antes de salvar.`, "ok");
  } else {
    linhas = envio.perfis.map((p) => ({ nome: p.nome, servidor_id: p.id, dias: ["", "", "", "", ""] }));
  }

  $("agenda-semana").value = lidos?.segunda || segundaDaSemana(hojeISO());
  cabecalhoConferencia();
  $("agenda-conf-lista").innerHTML = linhas.map(linhaConferencia).join("");
  if (!$("agenda-destinos")) document.body.insertAdjacentHTML("beforeend", '<datalist id="agenda-destinos"></datalist>');
  $("agenda-destinos").innerHTML = conhecidos.map((d) => `<option value="${esc(d)}">`).join("");
  ligarRemover();
  $("form-agenda").hidden = false;
});

$("form-agenda").addEventListener("submit", async (e) => {
  e.preventDefault();
  mensagem("agenda-salvar-msg", "");
  const semana = $("agenda-semana").value;
  if (!semana || segundaDaSemana(semana) !== semana) return mensagem("agenda-salvar-msg", "Escolha a data de uma segunda-feira.");

  const itens = [];
  const nomes = new Set();
  for (const tr of $("agenda-conf-lista").querySelectorAll("tr")) {
    const nome = tr.querySelector(".ag-c-nome").value.trim();
    const servidor_id = tr.querySelector(".ag-c-perfil").value;
    const dias = [...tr.querySelectorAll(".ag-c-dia")].map((i) => i.value.trim());
    if (!nome && !dias.some(Boolean)) continue;
    if (!nome) return mensagem("agenda-salvar-msg", "Há uma linha sem o nome do técnico.");
    if (nomes.has(normalizar(nome))) return mensagem("agenda-salvar-msg", `O técnico "${nome}" aparece duas vezes.`);
    nomes.add(normalizar(nome));
    dias.forEach((destino, k) => { if (destino) itens.push({ tecnico_nome: nome, servidor_id, data: somarDias(semana, k), destino }); });
  }
  if (!itens.length) return mensagem("agenda-salvar-msg", "A agenda está vazia.");

  const { data: existe } = await sb.from("agendas").select("id").eq("semana_inicio", semana).maybeSingle();
  if (existe && !confirm(`Já existe uma agenda para a semana de ${dataBR(semana)}. Substituir pela nova?`)) return;

  $("agenda-salvar").disabled = true;
  const { error } = await sb.rpc("salvar_agenda", { p_semana: semana, p_imagem: envio.imagem, p_itens: itens });
  $("agenda-salvar").disabled = false;
  if (error) return mensagem("agenda-salvar-msg", textoErro(error));
  agendaSemana = semana;
  ir("painel");
});
