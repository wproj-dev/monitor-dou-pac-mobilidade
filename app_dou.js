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
      status_triagem: estadoGlobal.modoOnline && overrides[p.url_title]
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