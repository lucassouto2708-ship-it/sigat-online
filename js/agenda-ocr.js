// Leitura automática (OCR) da imagem da agenda semanal.
// Acha as linhas da tabela na imagem, recorta cada célula e lê o texto com o Tesseract
// (roda no próprio navegador, nada é enviado para fora). O resultado sempre passa pela
// conferência do administrador antes de ser gravado.
const TESS_VERSAO = "5.1.1";
const TESS_URL = `https://cdn.jsdelivr.net/npm/tesseract.js@${TESS_VERSAO}/dist/tesseract.min.js`;
const TESS_OPCOES = {
  workerPath: `https://cdn.jsdelivr.net/npm/tesseract.js@${TESS_VERSAO}/dist/worker.min.js`,
  corePath: `https://cdn.jsdelivr.net/npm/tesseract.js-core@${TESS_VERSAO}`,
  langPath: "https://cdn.jsdelivr.net/npm/@tesseract.js-data/por@1.0.0/4.0.0_best_int",
};

function carregarTesseract() {
  if (window.Tesseract) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = TESS_URL;
    s.onload = resolve;
    s.onerror = () => reject(new Error("Não foi possível carregar o leitor de imagem. Verifique a internet."));
    document.head.appendChild(s);
  });
}

function carregarImagem(arquivo) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Não foi possível abrir a imagem."));
    img.src = URL.createObjectURL(arquivo);
  });
}

// Agrupa índices consecutivos (com tolerância) em faixas [início, fim]
function faixas(indices, tolerancia = 3) {
  const out = [];
  for (const i of indices) {
    const ult = out[out.length - 1];
    if (ult && i - ult[1] <= tolerancia) ult[1] = i;
    else out.push([i, i]);
  }
  return out;
}

// Entre as faixas de linha, devolve os espaços (as células) com tamanho mínimo
function espacos(linhas, minimo) {
  const out = [];
  for (let k = 0; k < linhas.length - 1; k++) {
    const a = linhas[k][1] + 1, b = linhas[k + 1][0] - 1;
    if (b - a >= minimo) out.push([a, b]);
  }
  return out;
}

// Encontra a grade da tabela: linhas (y) e colunas (x) das células
function acharGrade(canvas) {
  const { width: W, height: H } = canvas;
  const px = canvas.getContext("2d").getImageData(0, 0, W, H).data;
  const escuro = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    escuro[i] = (px[i * 4] * 0.3 + px[i * 4 + 1] * 0.59 + px[i * 4 + 2] * 0.11) < 140 ? 1 : 0;
  }
  // Maior sequência contínua de pixels escuros em cada linha/coluna (para achar traços longos)
  const seqLinha = (y, x0 = 0, x1 = W) => { let m = 0, c = 0; for (let x = x0; x < x1; x++) { c = escuro[y * W + x] ? c + 1 : 0; if (c > m) m = c; } return m; };
  const seqColuna = (x, y0, y1) => { let m = 0, c = 0; for (let y = y0; y < y1; y++) { c = escuro[y * W + x] ? c + 1 : 0; if (c > m) m = c; } return m; };

  // Traços horizontais: pelo menos 15% da largura sem interrupção (cada célula tem a sua borda)
  const hs = [];
  for (let y = 0; y < H; y++) if (seqLinha(y) > W * 0.12) hs.push(y);
  const hFaixas = faixas(hs);

  // Traços verticais na região da tabela: cobrem a maior parte da altura de cada linha
  const linhasTabela = espacos(hFaixas, H * 0.02);
  if (linhasTabela.length < 2) throw new Error("Não encontrei a tabela na imagem.");
  // Usa a primeira linha de técnico (a segunda faixa) para achar as colunas
  const ref = linhasTabela[1];
  const vs = [];
  for (let x = 0; x < W; x++) if (seqColuna(x, ref[0], ref[1] + 1) > (ref[1] - ref[0]) * 0.8) vs.push(x);
  const colunas = espacos(faixas(vs), W * 0.03);

  // Mantém só as linhas da tabela que têm a mesma estrutura (descarta título e rodapé)
  const linhas = linhasTabela.filter(([a, b]) => {
    const meio = Math.round((colunas[0][1] + colunas[1][0]) / 2);
    return seqColuna(meio, a, b + 1) > (b - a) * 0.8;
  });
  return { linhas, colunas };
}

// Recorta uma região da imagem ampliada (melhora a leitura de letras pequenas)
function recorte(canvas, x0, y0, x1, y1, escala = 3) {
  const c = document.createElement("canvas");
  const m = 3; // margem interna para não pegar a borda da célula
  const w = x1 - x0 - 2 * m, h = y1 - y0 - 2 * m;
  c.width = w * escala; c.height = h * escala;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(canvas, x0 + m, y0 + m, w, h, 0, 0, c.width, c.height);
  return c;
}

function somarDias(iso, n) {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const limparTexto = (s) => String(s || "").replace(/[|_—–]/g, " ").replace(/\s+/g, " ").trim();

// Lê a agenda. aoProgredir(fração 0..1, texto) é opcional.
async function lerAgendaDaImagem(arquivo, aoProgredir = () => {}) {
  aoProgredir(0, "Carregando o leitor de imagem…");
  await carregarTesseract();
  const img = await carregarImagem(arquivo);
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0);

  const { linhas, colunas } = acharGrade(canvas);
  if (linhas.length < 2 || colunas.length < 6) {
    throw new Error("Não consegui identificar as colunas da agenda (Técnicos + 5 dias) na imagem.");
  }
  const cols = colunas.slice(0, 6);

  const worker = await Tesseract.createWorker("por", 1, TESS_OPCOES);
  try {
    const ler = async (c, psm = "6") => {
      await worker.setParameters({ tessedit_pageseg_mode: psm });
      return (await worker.recognize(c)).data.text;
    };

    // Período: título acima da tabela
    const tituloAlt = linhas[0][0];
    const titulo = tituloAlt > 20 ? await ler(recorte(canvas, 0, 0, canvas.width, tituloAlt, 2)) : "";
    const datas = [];
    for (let k = 1; k < 6; k++) {
      const t = await ler(recorte(canvas, cols[k][0], linhas[0][0], cols[k][1], linhas[0][1]));
      const m = t.match(/(\d{1,2})\s*[/.\-]\s*(\d{1,2})\s*[/.\-]\s*(\d{4})/);
      datas.push(m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : null);
    }
    const mt = titulo.match(/(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{4})/);
    // Segunda-feira da semana: pela primeira data lida no cabeçalho ou, se não der, pelo título
    let segunda = null;
    const k = datas.findIndex(Boolean);
    if (k >= 0) segunda = somarDias(datas[k], -k);
    else if (mt) segunda = `${mt[3]}-${mt[2].padStart(2, "0")}-${mt[1].padStart(2, "0")}`;

    const corpo = linhas.slice(1);
    const tecnicos = [];
    let feitas = 0;
    const total = corpo.length * 6;
    for (const [y0, y1] of corpo) {
      const nomeBruto = limparTexto(await ler(recorte(canvas, cols[0][0], y0, cols[0][1], y1), "7"));
      const nome = nomeBruto.replace(/^[\d\s.\-)]+/, "").trim();
      aoProgredir(++feitas / total, `Lendo: ${nome || "…"}`);
      const dias = [];
      for (let k = 1; k < 6; k++) {
        // Só a linha de cima da célula (o destino); a de baixo é a sigla da empresa
        const meio = Math.round(y0 + (y1 - y0) * 0.64);
        const texto = limparTexto(await ler(recorte(canvas, cols[k][0], y0, cols[k][1], meio), "7"));
        dias.push(texto);
        aoProgredir(++feitas / total, `Lendo: ${nome || "…"}`);
      }
      if (nome || dias.some(Boolean)) tecnicos.push({ nome, dias });
    }
    return { segunda, tecnicos };
  } finally {
    await worker.terminate();
  }
}

// ---------- Correção do texto lido ----------
const normalizar = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();

function distancia(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[a.length][b.length];
}

// Troca o texto lido pelo destino conhecido mais parecido (ex.: "M athias obato" -> "Mathias Lobato")
function corrigirDestino(texto, conhecidos) {
  const alvo = normalizar(texto).replace(/ /g, "");
  if (!alvo) return "";
  let melhor = null, menor = Infinity;
  for (const c of conhecidos) {
    const d = distancia(alvo, normalizar(c).replace(/ /g, ""));
    if (d < menor) { menor = d; melhor = c; }
  }
  return melhor && menor <= Math.max(1, Math.floor(alvo.length * 0.25)) ? melhor : texto;
}

// Acha o usuário do sistema que corresponde ao nome do técnico na imagem
function acharPerfil(nome, perfis) {
  const n = normalizar(nome);
  if (!n) return null;
  const primeiro = n.split(" ")[0];
  let melhor = null, nota = 0;
  for (const p of perfis) {
    const pn = normalizar(p.nome);
    const pp = pn.split(" ")[0];
    let s = 0;
    if (pn === n) s = 100;
    else if (pn.startsWith(n) || n.startsWith(pn)) s = 90;
    else if (pp === primeiro) s = n.split(" ").length > 1 && !pn.includes(n.split(" ")[1]) ? 50 : 80;
    else if (distancia(pp, primeiro) <= 1 && primeiro.length >= 4) s = 60;
    if (s > nota) { nota = s; melhor = p; }
  }
  return melhor;
}
