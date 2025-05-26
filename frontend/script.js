const API_URL = "http://localhost:3000";
let videoSelecionado = null;
let pesquisaAtual = ""; // Guarda a última pesquisa feita
let pageToken = null; // Armazena o token da próxima página de resultados
let videosAtuais = []; // 🧠 Armazena os vídeos carregados para permitir ordenação


// 🔍 Função para buscar vídeos com paginação
async function buscarVideos(novaBusca = true) {
    if (novaBusca) {
        pesquisaAtual = document.getElementById("search-input").value.trim();
        pageToken = null; // Reseta a paginação para novas pesquisas
    }

    const minSubs = Math.max(0, parseInt(document.getElementById("min-subs").value) || 0);
    const maxSubs = Math.max(minSubs, parseInt(document.getElementById("max-subs").value) || 999999999);
    const minDuration = converterTempoParaSegundos(document.getElementById("min-duration").value) || 0;
    const maxDuration = converterTempoParaSegundos(document.getElementById("max-duration").value) || 999999999;
    const minViews = Math.max(0, parseInt(document.getElementById("min-views").value) || 0);
    const maxViews = Math.max(minViews, parseInt(document.getElementById("max-views").value) || 999999999);
    const postedWithin = parseInt(document.getElementById("posted-within").value) || 0;
    console.log("🧪 postedWithin capturado do select:", document.getElementById("posted-within").value);
    console.log("🧪 postedWithin final (int):", postedWithin);


    const algumFiltroAtivo =
        minSubs > 0 ||
        maxSubs < 999999999 ||
        minDuration > 0 ||
        maxDuration < 999999999 ||
        minViews > 0 ||
        maxViews < 999999999 ||
        postedWithin > 0;

    if (!pesquisaAtual && !algumFiltroAtivo) {
        alert("Digite um termo ou selecione pelo menos um filtro.");
        return;
    }


    console.log(`🔍 Buscando vídeos: ${pesquisaAtual} | Página: ${pageToken || "Início"}`);

    document.getElementById("loading-modal").style.display = "flex";

    try {
        const response = await fetch(`${API_URL}/search?query=${pesquisaAtual}&minSubs=${minSubs}&maxSubs=${maxSubs}&minViews=${minViews}&maxViews=${maxViews}&minDuration=${minDuration}&maxDuration=${maxDuration}&postedWithin=${postedWithin}&pageToken=${pageToken || ""}`);

        const data = await response.json(); // ✅ agora sim data existe

        console.log("🔄 Resposta do backend:", data); // 👈 log para depurar

        if (!data || !Array.isArray(data.videos)) {
            console.error("❌ ERRO: Resposta inesperada do backend:", data);
            return;
        }

        videosAtuais = novaBusca ? data.videos : [...videosAtuais, ...data.videos];

        document.getElementById("order-container").style.display = "block"; // Exibe o seletor
        ordenarVideos(); // Ordena os vídeos antes de renderizar

        mostrarResultados(data.videos, novaBusca);
        pageToken = data.nextPageToken; // Armazena o token para carregar mais vídeos

        // Exibir botão "Carregar mais" se houver mais vídeos
        const loadMoreBtn = document.getElementById("load-more-btn");
        if (pageToken) {
            loadMoreBtn.style.display = "block";
        } else {
            loadMoreBtn.style.display = "none";
        }
    } catch (error) {
        console.error("❌ Erro ao buscar vídeos:", error.message);
    } finally {
        document.getElementById("loading-modal").style.display = "none";
    }
}

function formatarData(dataISO) {
    const data = new Date(dataISO);
    return data.toLocaleDateString("pt-BR", {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    });
}


// 📺 Atualiza a interface sem sobrescrever os vídeos anteriores
function mostrarResultados(videos, novaBusca) {
    const resultsDiv = document.getElementById("video-results");
    if (novaBusca) resultsDiv.innerHTML = ""; // Limpa apenas em novas buscas

    videos.forEach(video => {
        const videoElement = document.createElement("div");
        videoElement.classList.add("video-card");

        videoElement.innerHTML = `
            <img class="video-thumbnail" src="${video.thumbnail}" alt="Thumbnail">
            <div class="video-info">
                <h3>${video.title}</h3>
                <p>${video.channel} - ${video.subscribers.toLocaleString()} inscritos</p>
                <p>${video.viewCount.toLocaleString()} visualizações</p>
                <p>Duração: ${formatarDuracao(video.duration)}</p>
                <p>Postado em: ${video.publishedAt ? formatarData(video.publishedAt) : "Data desconhecida"}</p>
                <div class="video-buttons">
                    <button class="view-button" onclick="window.open('${video.url}', '_blank')">🎥 Ver no YouTube</button>
                    <button class="watch-button" onclick="abrirWatchModal('${video.url}')">▶️ Assistir</button>
                    <button class="download-button" onclick="abrirModal('${video.url}')">📥 Baixar</button>
                </div>
            </div>
        `;
        resultsDiv.appendChild(videoElement);
    });
}

// 📥 Função para converter tempo antes de baixar o vídeo
function confirmarDownload() {
    if (!videoSelecionado) {
        alert("Selecione um vídeo primeiro!");
        return;
    }

    const start = converterTempoParaSegundos(document.getElementById("start-time").value);
    const end = converterTempoParaSegundos(document.getElementById("end-time").value);

    if (isNaN(start) || isNaN(end) || start >= end || start < 0 || end < 0) {
        alert("Informe valores válidos para início e fim.");
        return;
    }

    console.log(`📥 Iniciando download do trecho: ${start}s - ${end}s`);

    const downloadUrl = `${API_URL}/download?videoUrl=${encodeURIComponent(videoSelecionado)}&start=${start}&end=${end}`;
    window.open(downloadUrl, "_blank");

    fecharModal();
}

// 🕒 Conversão de tempo (MM:SS → segundos)
function converterTempoParaSegundos(tempo) {
    if (!tempo || typeof tempo !== "string") return 0;

    const partes = tempo.split(":").map(num => parseInt(num, 10));

    if (partes.length !== 2 || isNaN(partes[0]) || isNaN(partes[1])) {
        return 0; // Se o formato estiver errado, retorna 0 para evitar erros
    }

    return (partes[0] * 60) + partes[1];
}

// 🕒 Formata automaticamente a entrada de tempo no formato MM:SS enquanto o usuário digita
function formatarTempoInput(input) {
    let valor = input.value.replace(/[^0-9]/g, ""); // Remove caracteres não numéricos

    if (valor.length > 4) valor = valor.substring(0, 4); // Limita a 4 caracteres

    // Divide os minutos e segundos corretamente
    let minutos = valor.substring(0, valor.length - 2) || "00";
    let segundos = valor.substring(valor.length - 2) || "00";

    minutos = minutos.padStart(2, "0");
    segundos = segundos.padStart(2, "0");

    // Limita segundos a um valor máximo de 59
    if (parseInt(segundos) > 59) {
        minutos = (parseInt(minutos) + 1).toString().padStart(2, "0");
        segundos = "00";
    }

    input.value = `${minutos}:${segundos}`;
}


// ⏳ Abrir modal de download
function abrirModal(videoUrl) {
    videoSelecionado = videoUrl;
    document.getElementById("download-modal").style.display = "flex";
}

// ❌ Fechar modal de download
function fecharModal() {
    document.getElementById("download-modal").style.display = "none";
}

// ⏳ Abrir modal de assistir vídeo
function abrirWatchModal(videoUrl) {
    const modal = document.getElementById("watch-modal");
    const iframe = document.getElementById("video-iframe");

    iframe.src = videoUrl.replace("watch?v=", "embed/");
    modal.style.display = "flex";
}

// ❌ Fechar modal de assistir vídeo
function fecharWatchModal() {
    const modal = document.getElementById("watch-modal");
    const iframe = document.getElementById("video-iframe");

    iframe.src = ""; // Remove o vídeo ao fechar para parar a reprodução
    modal.style.display = "none";
}

// 📏 Formatar a duração do vídeo corretamente (ISO 8601 → HH:MM:SS)
function formatarDuracao(segundos) {
    const horas = Math.floor(segundos / 3600);
    const minutos = Math.floor((segundos % 3600) / 60);
    const segs = segundos % 60;

    return [
        horas > 0 ? horas.toString().padStart(2, "0") : null,
        minutos.toString().padStart(2, "0"),
        segs.toString().padStart(2, "0"),
    ].filter(Boolean).join(":");
}

function limparFiltros() {
    document.getElementById("search-input").value = "";
    document.getElementById("min-subs").value = "";
    document.getElementById("max-subs").value = "";
    document.getElementById("min-duration").value = "00:00";
    document.getElementById("max-duration").value = "00:00";
    document.getElementById("min-views").value = "";
    document.getElementById("max-views").value = "";
    document.getElementById("posted-within").value = "0";
    document.getElementById("video-results").innerHTML = "";
    videoSelecionado = null;
    pageToken = null;
}

function ordenarVideos() {
    const criterio = document.getElementById("ordenar-por").value;
    let listaOrdenada = [...videosAtuais];

    if (criterio === "recentes") {
        listaOrdenada.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
    } else if (criterio === "antigos") {
        listaOrdenada.sort((a, b) => new Date(a.publishedAt) - new Date(b.publishedAt));
    } else if (criterio === "views") {
        listaOrdenada.sort((a, b) => b.viewCount - a.viewCount);
    }

    renderizarVideos(listaOrdenada);
}

function renderizarVideos(lista) {
    const resultsDiv = document.getElementById("video-results");
    resultsDiv.innerHTML = "";

    lista.forEach(video => {
        const videoElement = document.createElement("div");
        videoElement.classList.add("video-card");

        videoElement.innerHTML = `
            <img class="video-thumbnail" src="${video.thumbnail}" alt="Thumbnail">
            <div class="video-info">
                <h3>${video.title}</h3>
                <p>${video.channel} - ${video.subscribers.toLocaleString()} inscritos</p>
                <p>${video.viewCount.toLocaleString()} visualizações</p>
                <p>Duração: ${formatarDuracao(video.duration)}</p>
                <p>Postado em: ${formatarData(video.publishedAt)}</p>
                <div class="video-buttons">
                    <button class="view-button" onclick="window.open('${video.url}', '_blank')">🎥 Ver no YouTube</button>
                    <button class="watch-button" onclick="abrirWatchModal('${video.url}')">▶️ Assistir</button>
                    <button class="download-button" onclick="abrirModal('${video.url}')">📥 Baixar</button>
                </div>
            </div>
        `;
        resultsDiv.appendChild(videoElement);
    });
}



// 🗑 Resetar os filtros corretamente
document.getElementById("search-input").addEventListener("focus", () => {
    document.getElementById("video-results").innerHTML = "";
    videoSelecionado = null;
});
