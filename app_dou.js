let estadoGlobal = {
  portarias: [],
  anexos: [],
  portariasFiltradas: [],
  anexosFiltrados: [],
  urlTitleSelecionado: null,
  modoOnline: false,
};

const DEFINICAO_COLUNAS_ANEXO = [
  { campo: "proponente", titulo: "Proponente" },
  { campo: "municipio", titulo: "Município" },
  { campo: "uf", titulo: "UF" },
  { campo: "proposta", titulo: "Proposta" },
  { campo: "objeto", titulo: "Objeto da Proposta" },
  { campo: "modalidade", titulo: "Modalidade / Programa" },
  { campo: "agente_financeiro", titulo: "Agente Financeiro" },
  { campo: "valor_proposta", titulo: "Valor da Proposta" },
  { campo: "contrapartida", titulo: "Contrapartida" },
  { campo: "situacao", titulo: "Situação" },
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

function formatarBRL(valor) {
  return Number(valor || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function obterColunasAtivas(anexos) {
  return DEFINICAO_COLUNAS_ANEXO.filter(
    (def) =>
      def.campo === "valor_proposta" ||
      anexos.some((a) => String(a[def.campo] || "").trim() !== "")
  );
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

    estadoGlobal.portarias = dados.portarias || [];
    estadoGlobal.anexos = dados.anexos || [];

    const anexosPorPortaria = {};
    for (const a of estadoGlobal.anexos) {
      a.indice_busca = normalizar(
        [
          formatarDataBR(a.data_publicacao),
          a.titulo_portaria,
          a.cnpj,
          a.proponente,
          a.municipio,
          a.uf,
          a.proposta,
          a.objeto,
          a.modalidade,
          a.agente_financeiro,
          a.valor_proposta,
          a.situacao,
        ].join(" ")
      );
      if (!anexosPorPortaria[a.url_title]) anexosPorPortaria[a.url_title] = [];
      anexosPorPortaria[a.url_title].push(a);
    }

    for (const p of estadoGlobal.portarias) {
      const lista = anexosPorPortaria[p.url_title] || [];
      p.qtd_propostas_total = lista.length;
      p.qtd_propostas_filtradas = lista.length;
      p.indice_busca_portaria = normalizar(
        `${formatarDataBR(p.data_publicacao)} ${p.titulo} ${p.texto_completo}`
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

  const portariasDoAno = estadoGlobal.portarias.filter(
    (p) => ano === "TODOS" || p.data_publicacao.startsWith(ano)
  );
  const idsDoAno = new Set(portariasDoAno.map((p) => p.url_title));
  const anexosDoAno = estadoGlobal.anexos.filter((a) => idsDoAno.has(a.url_title));

  if (!termo) {
    for (const p of portariasDoAno) {
      p.qtd_propostas_filtradas = p.qtd_propostas_total;
    }
    estadoGlobal.portariasFiltradas = portariasDoAno;
    estadoGlobal.anexosFiltrados = anexosDoAno;
  } else {
    // 1. Filtra as propostas diretamente pelo termo pesquisado
    const anexosPorPortariaFiltrados = {};
    for (const a of anexosDoAno) {
      if (a.indice_busca.includes(termo)) {
        if (!anexosPorPortariaFiltrados[a.url_title]) {
          anexosPorPortariaFiltrados[a.url_title] = [];
        }
        anexosPorPortariaFiltrados[a.url_title].push(a);
      }
    }

    // 2. Mantém portarias que têm propostas compatíveis OU texto da portaria compatível
    const portariasResult = [];
    const anexosResult = [];

    for (const p of portariasDoAno) {
      const propostasMatch = anexosPorPortariaFiltrados[p.url_title] || [];
      const textoPortariaMatch = p.indice_busca_portaria.includes(termo);

      if (propostasMatch.length > 0) {
        p.qtd_propostas_filtradas = propostasMatch.length;
        portariasResult.push(p);
        anexosResult.push(...propostasMatch);
      } else if (textoPortariaMatch) {
        // Caso o termo apareça apenas no texto legal da portaria (sem tabela correspondente)
        const todasDaPortaria = anexosDoAno.filter((a) => a.url_title === p.url_title);
        p.qtd_propostas_filtradas = todasDaPortaria.length;
        portariasResult.push(p);
        anexosResult.push(...todasDaPortaria);
      }
    }

    estadoGlobal.portariasFiltradas = portariasResult;
    estadoGlobal.anexosFiltrados = anexosResult;
  }

  renderizarRelatorio(Boolean(termo));
  renderizarSeletorUnitario();
}

function renderizarRelatorio(filtroAtivo = false) {
  const portarias = estadoGlobal.portariasFiltradas;
  const anexos = estadoGlobal.anexosFiltrados;

  const somaFinanceira = anexos.reduce(
    (acc, a) => acc + (Number(a.valor_numerico) || 0),
    0
  );

  document.getElementById("kpi-portarias").textContent = portarias.length;
  document.getElementById("kpi-propostas").textContent = anexos.length;
  document.getElementById("kpi-volume").textContent = formatarBRL(somaFinanceira);

  // Tabela 1: Portarias
  const tbodyPortarias = document.querySelector("#tabela-portarias tbody");
  if (portarias.length === 0) {
    tbodyPortarias.innerHTML =
      '<tr><td colspan="5">Nenhuma portaria encontrada para os filtros atuais.</td></tr>';
  } else {
    tbodyPortarias.innerHTML = portarias
      .map((p) => {
        const textoPropostas =
          filtroAtivo && p.qtd_propostas_filtradas !== p.qtd_propostas_total
            ? `<strong>${p.qtd_propostas_filtradas}</strong> / ${p.qtd_propostas_total}`
            : `${p.qtd_propostas_total}`;

        return `
          <tr>
            <td>${formatarDataBR(p.data_publicacao)}</td>
            <td>Ed. ${escaparHtml(p.edicao || "—")} · Pág. ${escaparHtml(p.pagina || "—")}</td>
            <td><strong>${escaparHtml(p.titulo)}</strong></td>
            <td>${textoPropostas}</td>
            <td>
              <button class="btn btn-secundario btn-mini" onclick="abrirPortariaUnitaria('${escaparHtml(p.url_title)}')">
                Ler DOU
              </button>
            </td>
          </tr>
        `;
      })
      .join("");
  }

  // Tabela 2: Propostas Detalhadas
  const theadAnexos = document.querySelector("#tabela-anexos thead");
  const tbodyAnexos = document.querySelector("#tabela-anexos tbody");
  document.getElementById("contador-anexos").textContent = `${anexos.length} linha(s) exibida(s)`;

  if (anexos.length === 0) {
    theadAnexos.innerHTML = "";
    tbodyAnexos.innerHTML = "<tr><td>Nenhuma proposta encontrada no recorte atual.</td></tr>";
    return;
  }

  const colunasAtivas = obterColunasAtivas(anexos);
  const headers = ["Data", "Portaria", "CNPJ", ...colunasAtivas.map((c) => c.titulo)];
  theadAnexos.innerHTML = `<tr>${headers.map((h) => `<th>${escaparHtml(h)}</th>`).join("")}</tr>`;

  tbodyAnexos.innerHTML = anexos
    .map((a) => {
      const tdsDinamicos = colunasAtivas
        .map((c) => `<td>${escaparHtml(a[c.campo] ?? "")}</td>`)
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
    const colunasAtivas = obterColunasAtivas(anexosPortaria);
    const ths = ["CNPJ", ...colunasAtivas.map((c) => c.titulo)]
      .map((h) => `<th>${escaparHtml(h)}</th>`)
      .join("");
    const trs = anexosPortaria
      .map(
        (a) =>
          `<tr><td>${escaparHtml(a.cnpj || "")}</td>${colunasAtivas
            .map((c) => `<td>${escaparHtml(a[c.campo] ?? "")}</td>`)
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

function exportarCSVExcel() {
  const anexos = estadoGlobal.anexosFiltrados;
  if (anexos.length === 0) {
    alert("Não há propostas filtradas para exportar.");
    return;
  }

  const colunasAtivas = obterColunasAtivas(anexos);
  const cabecalho = ["Data_Publicacao", "Portaria", "CNPJ", ...colunasAtivas.map((c) => c.titulo)];

  const escaparCSV = (val) => `"${String(val ?? "").replace(/"/g, '""')}"`;
  const linhas = [cabecalho.map(escaparCSV).join(";")];

  for (const a of anexos) {
    const linha = [
      formatarDataBR(a.data_publicacao),
      a.titulo_portaria,
      a.cnpj ?? "",
      ...colunasAtivas.map((c) => a[c.campo] ?? ""),
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
  document.getElementById("btn-recarregar")?.addEventListener("click", carregarDadosBanco);
  document.getElementById("btn-exportar-csv")?.addEventListener("click", exportarCSVExcel);
  document.getElementById("btn-imprimir-dou")?.addEventListener("click", () => window.print());

  document.getElementById("seletor-portaria")?.addEventListener("change", (e) => {
    renderizarFacSimileDOU(e.target.value);
  });

inicializarModoVisao();

  carregarDadosBanco();
});
function definirModoVisao(modo) {
  localStorage.setItem("dou_modo_visao", modo);
  aplicarModoVisao(modo);
  const modal = document.getElementById("modal-modo-acesso");
  if (modal) modal.classList.add("oculto");
}

function aplicarModoVisao(modo) {
  const ehMobile = modo === "mobile";
  document.body.classList.toggle("modo-mobile", ehMobile);

  const viewport = document.querySelector('meta[name="viewport"]');
  if (viewport) {
    viewport.setAttribute(
      "content",
      ehMobile ? "width=device-width, initial-scale=1.0" : "width=1200"
    );
  }

  const btn = document.getElementById("btn-alternar-visao");
  if (btn) {
    btn.textContent = ehMobile ? "🖥️ Acesso Desktop" : "📱 Acesso Mobile";
  }
}

function alternarModoVisao() {
  const atual = localStorage.getItem("dou_modo_visao") || "desktop";
  definirModoVisao(atual === "mobile" ? "desktop" : "mobile");
}

function inicializarModoVisao() {
  const salvo = localStorage.getItem("dou_modo_visao");
  if (!salvo) {
    const modal = document.getElementById("modal-modo-acesso");
    if (modal) modal.classList.remove("oculto");
    aplicarModoVisao(window.innerWidth <= 768 ? "mobile" : "desktop");
  } else {
    aplicarModoVisao(salvo);
  }
}