let estadoGlobal = {
  portarias: [],
  anexos: [],
  portariasFiltradas: [],
  anexosFiltrados: [],
  urlTitleSelecionado: null,
  modoOnline: false,
};

const ORDEM_COLUNAS_ANEXO = [
  "Proponente",
  "Município",
  "UF",
  "Proposta",
  "Objeto da Proposta",
  "Modalidade / Programa",
  "Agente Financeiro",
  "Valor (R$)",
  "Contrapartida (R$)",
];

function normalizar(texto) {
  if (!texto) return "";
  return String(texto)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[º°]/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

function escaparHtml(texto) {
  if (texto === null || texto === undefined) return "";
  return String(texto)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatarDataBR(dataIso) {
  if (!dataIso) return "—";
  const partes = String(dataIso).split("-");
  if (partes.length === 3) return `${partes[2]}/${partes[1]}/${partes[0]}`;
  return dataIso;
}

function converterValorBRL(valorStr) {
  if (valorStr === null || valorStr === undefined) return 0;
  const texto = String(valorStr).trim();
  if (!texto || ["nan", "none", "null", "-", "—"].includes(texto.toLowerCase())) return 0;

  let limpo = texto.replace(/[^\d,.-]/g, "");
  if (!limpo) return 0;

  if (limpo.includes(",")) {
    limpo = limpo.replace(/\./g, "").replace(",", ".");
  } else if ((limpo.match(/\./g) || []).length > 1) {
    limpo = limpo.replace(/\./g, "");
  } else if (/^-?\d+\.\d{3}$/.test(limpo)) {
    limpo = limpo.replace(".", "");
  }

  const numero = Number(limpo);
  return Number.isFinite(numero) ? numero : 0;
}

function formatarBRL(valor) {
  return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function identificarColunaValor(colunas) {
  if (colunas.includes("Valor (R$)")) return "Valor (R$)";
  const prioridades = ["financiamento", "emprestimo", "investimento", "recurso", "repasse", "valor"];
  for (const chave of prioridades) {
    for (const col of colunas) {
      const norm = normalizar(col);
      if (norm.includes(chave) && !norm.includes("contrapartida")) {
        return col;
      }
    }
  }
  return null;
}

function obterColunasOrdenadas(anexos) {
  const colunasSet = new Set();
  for (const a of anexos) {
    Object.keys(a.campos || {}).forEach((k) => {
      const norm = normalizar(k);
      if (norm && norm !== "cnpj" && !norm.includes("processo")) {
        colunasSet.add(k);
      }
    });
  }

  const ordenadas = [];
  for (const colPref of ORDEM_COLUNAS_ANEXO) {
    if (colunasSet.has(colPref)) {
      ordenadas.push(colPref);
      colunasSet.delete(colPref);
    }
  }
  return [...ordenadas, ...colunasSet];
}

async function carregarDadosBanco() {
  const badge = document.getElementById("badge-atualizacao");
  badge.textContent = "Sincronizando...";

  try {
    let dados = null;
    try {
      const resp = await fetch("/api/dados");
      if (!resp.ok) throw new Error("Modo estático");
      dados = await resp.json();
      estadoGlobal.modoOnline = false;
    } catch (_) {
      const respJson = await fetch("./dados_painel.json?t=" + Date.now());
      if (!respJson.ok) throw new Error("Arquivo dados_painel.json não encontrado");
      dados = await respJson.json();
      estadoGlobal.modoOnline = true;
    }

    if (dados.erro) throw new Error(dados.erro);

    const overrides = JSON.parse(localStorage.getItem("dou_status_overrides") || "{}");
    estadoGlobal.portarias = (dados.portarias || []).map((p) => ({
      ...p,
      status_triagem:
        estadoGlobal.modoOnline && overrides[p.url_title]
          ? overrides[p.url_title]
          : p.status_triagem,
    }));
    estadoGlobal.anexos = dados.anexos || [];

    const mapaTextoAnexos = {};
    const contagemPorPortaria = {};
    for (const a of estadoGlobal.anexos) {
      contagemPorPortaria[a.url_title] = (contagemPorPortaria[a.url_title] || 0) + 1;
      const valoresLinha = [a.cnpj || "", ...Object.values(a.campos || {})].join(" ");
      mapaTextoAnexos[a.url_title] = (mapaTextoAnexos[a.url_title] || "") + " " + valoresLinha;
    }

    for (const p of estadoGlobal.portarias) {
      p.qtd_propostas = contagemPorPortaria[p.url_title] || 0;
      p.indice_busca = normalizar(
        `${p.titulo} ${p.texto_completo} ${mapaTextoAnexos[p.url_title] || ""}`
      );
    }

    preencherFiltroAnos();
    aplicarFiltros();

    const sufixo = estadoGlobal.modoOnline ? " · GitHub Pages" : "";
    const agora = new Date().toLocaleTimeString("pt-BR");
    badge.textContent = `${estadoGlobal.portarias.length} portarias${sufixo} · ${agora}`;
  } catch (err) {
    badge.textContent = "Erro: " + err.message;
    console.error(err);
  }
}

function preencherFiltroAnos() {
  const selectAno = document.getElementById("filtro-ano");
  if (!selectAno) return;
  const valorAnterior = selectAno.value;
  const anos = [...new Set(estadoGlobal.portarias.map((p) => p.data_publicacao.slice(0, 4)))].sort(
    (a, b) => b.localeCompare(a)
  );

  selectAno.innerHTML = '<option value="TODOS">Todos os anos</option>';
  for (const ano of anos) {
    const opt = document.createElement("option");
    opt.value = ano;
    opt.textContent = ano;
    selectAno.appendChild(opt);
  }
  if (anos.includes(valorAnterior)) selectAno.value = valorAnterior;
}

function aplicarFiltros() {
  const termo = normalizar(document.getElementById("filtro-busca")?.value || "");
  const ano = document.getElementById("filtro-ano")?.value || "TODOS";
  const status = document.getElementById("filtro-status")?.value || "TODOS";

  estadoGlobal.portariasFiltradas = estadoGlobal.portarias.filter((p) => {
    if (ano !== "TODOS" && !p.data_publicacao.startsWith(ano)) return false;
    if (status !== "TODOS" && p.status_triagem !== status) return false;
    if (termo && !p.indice_busca.includes(termo)) return false;
    return true;
  });

  const idsAtivos = new Set(estadoGlobal.portariasFiltradas.map((p) => p.url_title));
  estadoGlobal.anexosFiltrados = estadoGlobal.anexos.filter((a) => idsAtivos.has(a.url_title));

  renderizarRelatorio();
  renderizarSeletorUnitario();
}

function renderizarRelatorio() {
  const portarias = estadoGlobal.portariasFiltradas;
  const anexos = estadoGlobal.anexosFiltrados;

  const colunasAnexo = obterColunasOrdenadas(anexos);
  const colValor = identificarColunaValor(colunasAnexo);

  let somaFinanceira = 0;
  if (colValor) {
    for (const a of anexos) {
      somaFinanceira += converterValorBRL(a.campos[colValor]);
    }
  }

  document.getElementById("kpi-portarias").textContent = portarias.length;
  document.getElementById("kpi-propostas").textContent = anexos.length;
  document.getElementById("kpi-volume").textContent = formatarBRL(somaFinanceira);

  // Tabela 1: Portarias (sem coluna Status)
  const tbodyPortarias = document.querySelector("#tabela-portarias tbody");
  if (portarias.length === 0) {
    tbodyPortarias.innerHTML =
      '<tr><td colspan="5">Nenhuma portaria encontrada para os filtros atuais.</td></tr>';
  } else {
    tbodyPortarias.innerHTML = portarias
      .map(
        (p) => `
          <tr>
            <td>${formatarDataBR(p.data_publicacao)}</td>
            <td>Ed. ${escaparHtml(p.edicao || "—")} · Pág. ${escaparHtml(p.pagina || "—")}</td>
            <td><strong>${escaparHtml(p.titulo)}</strong></td>
            <td>${p.qtd_propostas}</td>
            <td>
              <button class="btn btn-secundario btn-mini" onclick="abrirPortariaUnitaria('${escaparHtml(p.url_title)}')">
                Ler DOU
              </button>
            </td>
          </tr>
        `
      )
      .join("");
  }

  // Tabela 2: Anexos Unificados
  const theadAnexos = document.querySelector("#tabela-anexos thead");
  const tbodyAnexos = document.querySelector("#tabela-anexos tbody");
  document.getElementById("contador-anexos").textContent = `${anexos.length} linha(s) exibida(s)`;

  if (anexos.length === 0) {
    theadAnexos.innerHTML = "";
    tbodyAnexos.innerHTML = "<tr><td>Nenhuma proposta de anexo no recorte atual.</td></tr>";
    return;
  }

  const headers = ["Data", "Portaria", "CNPJ", ...colunasAnexo];
  theadAnexos.innerHTML = `<tr>${headers.map((h) => `<th>${escaparHtml(h)}</th>`).join("")}</tr>`;

  tbodyAnexos.innerHTML = anexos
    .map((a) => {
      const tdsDinamicos = colunasAnexo
        .map((c) => `<td>${escaparHtml(a.campos[c] ?? "")}</td>`)
        .join("");
      return `
        <tr>
          <td>${formatarDataBR(a.data_publicacao)}</td>
          <td>${escaparHtml(a.titulo_portaria)}</td>
          <td><strong>${escaparHtml(a.cnpj || "")}</strong></td>
          ${tdsDinamicos}
        </tr>
      `;
    })
    .join("");
}

function renderizarSeletorUnitario() {
  const select = document.getElementById("seletor-portaria");
  const portarias = estadoGlobal.portariasFiltradas;

  if (portarias.length === 0) {
    select.innerHTML = '<option value="">Nenhuma portaria disponível</option>';
    document.getElementById("folha-dou").innerHTML =
      '<p class="texto-vazio">Nenhuma portaria encontrada para os filtros selecionados.</p>';
    return;
  }

  select.innerHTML = portarias
    .map(
      (p) =>
        `<option value="${escaparHtml(p.url_title)}">${formatarDataBR(p.data_publicacao)} — ${escaparHtml(p.titulo)}</option>`
    )
    .join("");

  const aindaExiste = portarias.some((p) => p.url_title === estadoGlobal.urlTitleSelecionado);
  if (!aindaExiste) {
    estadoGlobal.urlTitleSelecionado = portarias[0].url_title;
  }
  select.value = estadoGlobal.urlTitleSelecionado;
  renderizarFacSimileDOU(estadoGlobal.urlTitleSelecionado);
}

function renderizarFacSimileDOU(urlTitle) {
  const portaria = estadoGlobal.portarias.find((p) => p.url_title === urlTitle);
  const folha = document.getElementById("folha-dou");
  if (!portaria) return;

  estadoGlobal.urlTitleSelecionado = urlTitle;
  const selStatus = document.getElementById("seletor-status-unitario");
  if (selStatus) selStatus.value = portaria.status_triagem;
  document.getElementById("link-original-dou").href = portaria.url;

  const anexosPortaria = estadoGlobal.anexos.filter((a) => a.url_title === urlTitle);

  let linhas = String(portaria.texto_completo || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  if (linhas.length > 0 && normalizar(linhas[0]).includes(normalizar(portaria.titulo))) {
    linhas = linhas.slice(1);
  }

  const ementa = [];
  const corpo = [];
  let tituloAnexo = "ANEXO";
  let emEmenta = true;

  const regexAbertura = /^(O|A)\s+(MINISTR[OA]|SECRET[ÁA]RI[OA]|DIRETOR[A]?|PRESIDENTE)\b/i;
  const regexAnexo = /^ANEXO(\s+(I|II|III|IV|V|VI|ÚNICO|UNICO|\d+))?\b/i;

  for (const linha of linhas) {
    if (emEmenta && (regexAbertura.test(linha) || /^Art\.\s*1/i.test(linha))) {
      emEmenta = false;
    }
    if (regexAnexo.test(linha)) {
      tituloAnexo = linha;
      break;
    }
    if (emEmenta) {
      ementa.push(linha);
    } else {
      corpo.push(linha);
    }
  }

  let assinatura = "";
  if (corpo.length > 0) {
    const ultima = corpo[corpo.length - 1];
    if (
      ultima === ultima.toUpperCase() &&
      ultima.split(/\s+/).length >= 2 &&
      !/^(ART|§|PORTARIA|DECRETO|LEI|RESOLU|INSTRU)\b/.test(ultima)
    ) {
      assinatura = corpo.pop();
    }
  }

  let htmlAnexo = "";
  if (anexosPortaria.length > 0) {
    const cols = obterColunasOrdenadas(anexosPortaria);
    const ths = ["CNPJ", ...cols].map((c) => `<th>${escaparHtml(c)}</th>`).join("");
    const trs = anexosPortaria
      .map(
        (a) =>
          `<tr><td>${escaparHtml(a.cnpj || "")}</td>${cols
            .map((c) => `<td>${escaparHtml(a.campos[c] ?? "")}</td>`)
            .join("")}</tr>`
      )
      .join("");

    htmlAnexo = `
      <div class="dou-anexo-titulo">${escaparHtml(tituloAnexo)}</div>
      <table class="dou-tabela-anexo">
        <thead><tr>${ths}</tr></thead>
        <tbody>${trs}</tbody>
      </table>
    `;
  }

  const secaoLimpa = String(portaria.secao || "1").replace(/Seção/i, "").trim() || "1";

  folha.innerHTML = `
    <div class="dou-topo-titulo">DIÁRIO OFICIAL DA UNIÃO</div>
    <div class="dou-metadados">
      <strong>Publicado em:</strong> ${formatarDataBR(portaria.data_publicacao)}
      <span class="sep">|</span>
      <strong>Edição:</strong> ${escaparHtml(portaria.edicao || "—")}
      <span class="sep">|</span>
      <strong>Seção:</strong> ${escaparHtml(secaoLimpa)}
      <span class="sep">|</span>
      <strong>Página:</strong> ${escaparHtml(portaria.pagina || "—")}<br>
      <strong>Órgão:</strong> ${escaparHtml(portaria.orgao)}
    </div>

    <div class="dou-ato-titulo">${escaparHtml(portaria.titulo)}</div>
    <div class="dou-ementa">${ementa.map(escaparHtml).join("<br>")}</div>
    <div class="dou-corpo">${corpo.map((p) => `<p>${escaparHtml(p)}</p>`).join("")}</div>
    <div class="dou-assinatura">${escaparHtml(assinatura)}</div>
    ${htmlAnexo}
    <div class="dou-rodape-certificacao">
      Este conteúdo não substitui o publicado na versão certificada.
    </div>
  `;
}

function alternarAba(nomeAba) {
  document.querySelectorAll(".aba-btn").forEach((btn) => {
    btn.classList.toggle("ativa", btn.dataset.aba === nomeAba);
  });
  document.getElementById("view-relatorio").classList.toggle("oculto", nomeAba !== "relatorio");
  document.getElementById("view-unitaria").classList.toggle("oculto", nomeAba !== "unitaria");
}

function abrirPortariaUnitaria(urlTitle) {
  alternarAba("unitaria");
  document.getElementById("seletor-portaria").value = urlTitle;
  renderizarFacSimileDOU(urlTitle);
}

async function salvarStatusTriagem(urlTitle, novoStatus) {
  if (estadoGlobal.modoOnline) {
    const overrides = JSON.parse(localStorage.getItem("dou_status_overrides") || "{}");
    overrides[urlTitle] = novoStatus;
    localStorage.setItem("dou_status_overrides", JSON.stringify(overrides));
    const alvo = estadoGlobal.portarias.find((p) => p.url_title === urlTitle);
    if (alvo) alvo.status_triagem = novoStatus;
    aplicarFiltros();
    return;
  }

  try {
    const resp = await fetch("/api/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url_title: urlTitle, status_triagem: novoStatus }),
    });
    const res = await resp.json();
    if (!res.ok) throw new Error(res.erro || "Falha ao atualizar status");

    const alvo = estadoGlobal.portarias.find((p) => p.url_title === urlTitle);
    if (alvo) alvo.status_triagem = novoStatus;
    aplicarFiltros();
  } catch (err) {
    alert("Erro ao salvar status: " + err.message);
  }
}

function exportarCSVExcel() {
  const anexos = estadoGlobal.anexosFiltrados;
  if (anexos.length === 0) {
    alert("Não há propostas filtradas para exportar.");
    return;
  }

  const cols = obterColunasOrdenadas(anexos);
  const cabecalho = ["Data_Publicacao", "Portaria", "CNPJ", ...cols];

  const escaparCSV = (val) => `"${String(val ?? "").replace(/"/g, '""')}"`;
  const linhas = [cabecalho.map(escaparCSV).join(";")];

  for (const a of anexos) {
    const linha = [
      formatarDataBR(a.data_publicacao),
      a.titulo_portaria,
      a.cnpj ?? "",
      ...cols.map((c) => a.campos[c] ?? ""),
    ];
    linhas.push(linha.map(escaparCSV).join(";"));
  }

  const blob = new Blob(["\uFEFF" + linhas.join("\n")], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "relatorio_pac_mobilidade_dou.csv";
  link.click();
}

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".aba-btn").forEach((btn) => {
    btn.addEventListener("click", () => alternarAba(btn.dataset.aba));
  });

  document.getElementById("filtro-busca")?.addEventListener("input", aplicarFiltros);
  document.getElementById("filtro-ano")?.addEventListener("change", aplicarFiltros);
  document.getElementById("filtro-status")?.addEventListener("change", aplicarFiltros);
  document.getElementById("btn-recarregar")?.addEventListener("click", carregarDadosBanco);
  document.getElementById("btn-exportar-csv")?.addEventListener("click", exportarCSVExcel);
  document.getElementById("btn-imprimir-dou")?.addEventListener("click", () => window.print());

  document.getElementById("seletor-portaria")?.addEventListener("change", (e) => {
    renderizarFacSimileDOU(e.target.value);
  });

  document.getElementById("seletor-status-unitario")?.addEventListener("change", (e) => {
    if (estadoGlobal.urlTitleSelecionado) {
      salvarStatusTriagem(estadoGlobal.urlTitleSelecionado, e.target.value);
    }
  });

  carregarDadosBanco();
});