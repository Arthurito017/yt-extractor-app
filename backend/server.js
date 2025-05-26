require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));


// 🔹 Rotação de chaves da API do YouTube
const apiKeys = process.env.YOUTUBE_API_KEYS.split(',');
let currentKeyIndex = 0;

function getNextApiKey() {
    const key = apiKeys[currentKeyIndex];
    currentKeyIndex = (currentKeyIndex + 1) % apiKeys.length;
    return key;
}

// 🔍 **Rota para buscar vídeos no YouTube com paginação**
app.get('/search', async (req, res) => {
    try {
        let { query, minSubs, maxSubs, minDuration, maxDuration, pageToken, postedWithin } = req.query;
        query = query || ""; // 🔄 Garante que query sempre existe
        postedWithin = parseInt(postedWithin) || 0;
        const minViews = parseInt(req.query.minViews) || 0;
        const maxViews = parseInt(req.query.maxViews) || Number.MAX_SAFE_INTEGER;

        console.log("📅 Filtro de data:", postedWithin, "dias");
        console.log("🔍 Buscando vídeos para:", query, "| Page Token:", pageToken);

        const apiKey = getNextApiKey();

        // 🧠 Fallback de ordenação (relevance, viewCount, date)
        const order = query === "" ? (postedWithin > 0 ? "date" : "viewCount") : "relevance";
        console.log("📤 Critério de ordenação:", order);

        // 📆 Data para filtro de postagem
        let publishedAfter = "";
        if (postedWithin > 0) {
            const now = new Date();
            now.setDate(now.getDate() - postedWithin);
            publishedAfter = now.toISOString();
        }

        // 🔗 Monta URL da API do YouTube
        let youtubeURL = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=100&q=${query}&order=${order}&key=${apiKey}`;
        if (pageToken) youtubeURL += `&pageToken=${pageToken}`;
        if (publishedAfter) youtubeURL += `&publishedAfter=${publishedAfter}`;

        console.log("🔗 URL final da API:", youtubeURL);

        const response = await axios.get(youtubeURL);
        const videos = response.data.items || [];
        const nextPageToken = response.data.nextPageToken || null; // Token para a próxima página

        if (videos.length === 0) {
            console.log("⚠️ Nenhum vídeo encontrado.");
            return res.json({ videos: [], nextPageToken });
        }

        // 🔹 Obter detalhes dos canais (inscritos)
        const channelIds = [...new Set(videos.map(v => v.snippet.channelId))].join(',');
        const channelURL = `https://www.googleapis.com/youtube/v3/channels?part=statistics&id=${channelIds}&key=${apiKey}`;
        const channelResponse = await axios.get(channelURL);

        // Criamos um mapa com os inscritos por canal
        const channelData = {};
        channelResponse.data.items.forEach(channel => {
            channelData[channel.id] = parseInt(channel.statistics?.subscriberCount || 0);
        });

        // 🔹 Pegar IDs dos vídeos para obter duração e estatísticas
        const videoIds = videos.map(v => v.id.videoId).join(',');
        const detailsURL = `https://www.googleapis.com/youtube/v3/videos?part=contentDetails,statistics&id=${videoIds}&key=${apiKey}`;
        const detailsResponse = await axios.get(detailsURL);

        // 🔹 Processamento dos vídeos
        const filteredVideos = videos.map(video => {
            const details = detailsResponse.data.items.find(d => d.id === video.id.videoId);
            if (!details || !details.contentDetails) return null;
            const duration = parseDuration(details.contentDetails.duration);
            const viewCount = parseInt(details?.statistics?.viewCount || 0);
            const thumbnail = video.snippet?.thumbnails?.medium?.url || "https://via.placeholder.com/160x90?text=No+Thumbnail";
            const videoUrl = `https://www.youtube.com/watch?v=${video.id.videoId}`;
            const subscribers = parseInt(channelData[video.snippet?.channelId] || 0);

            if (duration < minDuration || duration > maxDuration || subscribers < minSubs || subscribers > maxSubs) return null;
            if (viewCount < minViews || viewCount > maxViews) return null;

            console.log(`🎥 Processando vídeo: ${video.snippet?.title}`);

            return {
                title: video.snippet?.title || "Título Indisponível",
                channel: video.snippet?.channelTitle || "Canal Desconhecido",
                thumbnail,
                url: videoUrl,
                duration,
                subscribers,
                viewCount,
                publishedAt: video.snippet?.publishedAt
            };
        }).filter(v => v !== null);

        res.json({ videos: filteredVideos, nextPageToken });
    } catch (error) {
        console.error("❌ Erro ao buscar vídeos:", error.message);
        res.status(500).json({ error: 'Erro ao buscar vídeos', details: error.message });
    }
});


// 🎥 **Rota para baixar trecho do vídeo (com áudio)**
const maxDownloads = 15; // Permite até 15 downloads simultâneos
let activeDownloads = 0; // Contador de downloads ativos
const downloadQueue = []; // Fila para downloads pendentes

// Função para converter tempo no formato MM:SS ou HH:MM:SS para segundos
function formatarTempo(tempo) {
    const partes = tempo.split(":").map(Number).reverse();
    let segundos = partes[0] || 0;
    let minutos = partes[1] || 0;
    let horas = partes[2] || 0;
    return horas * 3600 + minutos * 60 + segundos;
}


app.get("/download", (req, res) => {
    let { videoUrl, start, end, fullVideo } = req.query;

    if (!videoUrl) {
        return res.status(400).json({ error: 'Parâmetro "videoUrl" é obrigatório.' });
    }

    if (activeDownloads >= maxDownloads) {
        return res.status(429).json({ error: "Muitos downloads em andamento, tente novamente em alguns segundos." });
    }

    activeDownloads++;

    videoUrl = videoUrl.trim();
    const outputFileName = `video-${Date.now()}.mp4`;
    const outputFilePath = path.join(__dirname, outputFileName);
    let command;

    const formatoSeguro = `"bestvideo+bestaudio/best"`; // ✅ Mais robusto

    if (fullVideo === "true") {
        command = `yt-dlp -f ${formatoSeguro} \
            --merge-output-format mp4 \
            --postprocessor-args "-c:v libx264 -preset slow -crf 18 -c:a aac -b:a 192k" \
            -o "${outputFilePath}" "${videoUrl}"`;
    } else {
        start = formatarTempo(start || "00:00");
        end = formatarTempo(end || "00:30");

        if (isNaN(start) || isNaN(end) || start >= end || start < 0) {
            activeDownloads--;
            return res.status(400).json({ error: "Os valores de tempo são inválidos." });
        }

        command = `yt-dlp -f ${formatoSeguro} \
            --merge-output-format mp4 --download-sections "*${start}-${end}" --force-keyframes-at-cuts \
            --postprocessor-args "-c:v libx264 -preset slow -crf 18 -c:a aac -b:a 192k" \
            -o "${outputFilePath}" "${videoUrl}"`;
    }

    console.log(`📥 Iniciando download com comando: ${command}`);

    exec(command, (error, stdout, stderr) => {
        activeDownloads--;
        console.log("🖥️ Saída do comando:", stdout);
        console.error("⚠️ Erros do comando:", stderr);

        if (error) {
            console.error("❌ Erro ao baixar vídeo:", stderr);
            return res.status(500).json({ error: "Erro ao baixar vídeo", details: stderr });
        }

        fs.access(outputFilePath, fs.constants.F_OK, (err) => {
            if (err) {
                console.error("❌ Arquivo não encontrado após o download");
                return res.status(500).json({ error: "Arquivo não encontrado após o download" });
            }

            console.log(`✅ Download concluído: ${outputFilePath}`);

            res.download(outputFilePath, () => {
                fs.unlink(outputFilePath, (err) => {
                    if (err) console.error("Erro ao deletar arquivo:", err);
                });
            });
        });
    });
});





// 📏 **Função para converter a duração do vídeo (ISO 8601 → Segundos)**
function parseDuration(duration) {
    if (!duration) return 0;
    const match = duration.match(/PT(\d+H)?(\d+M)?(\d+S)?/);
    if (!match) return 0;
    return (parseInt(match[1]) || 0) * 3600 + (parseInt(match[2]) || 0) * 60 + (parseInt(match[3]) || 0);
}

const frontendPath = path.join(__dirname, 'frontend');

app.use(express.static(frontendPath));

// Rota fallback para SPA (caso o usuário acesse diretamente algum caminho)
app.get('*', (req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});



app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor rodando em http://${getLocalIP()}:${PORT}`);
});

// Função para pegar o IP local automaticamente
function getLocalIP() {
    const { networkInterfaces } = require('os');
    const nets = networkInterfaces();
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family === 'IPv4' && !net.internal) {
                return net.address;
            }
        }
    }
    return '127.0.0.1';
}
