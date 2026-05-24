const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const PORT = parseInt(process.env.PORT || "3000", 10);
const SITE_URL = process.env.SITE_URL || "https://mchswallowpodcast.zeabur.app";
const PODCAST_FOLDER_ID = process.env.PODCAST_FOLDER_ID || "1Yiwx-jIqmw37TvbMl5dDbVPcgetEPzIW";
const MATON_API_KEY = process.env.MATON_API_KEY || "";
// 支援 MATON_CONN（README 標準）或 MATON_CONNECTION_ID（舊版）
const MATON_CONNECTION_ID = process.env.MATON_CONN || process.env.MATON_CONNECTION_ID || "aa84aef8-287a-4271-a4b7-26a67b0c6adf";
const PODCAST_TITLE = process.env.PODCAST_TITLE || "門諾醫院聽語團隊PODCAST";
const PODCAST_DESCRIPTION = process.env.PODCAST_DESCRIPTION || "吞嚥復健、肌能訓練與臨床經驗分享";
const PODCAST_AUTHOR = process.env.PODCAST_AUTHOR || "門諾醫院聽語團隊";
const PODCAST_EMAIL = process.env.PODCAST_EMAIL || "mchswallow@gmail.com";
const PODCAST_COVER_URL = process.env.PODCAST_COVER_URL || `${SITE_URL.replace(/\/$/, "")}/cover.png`;

function matonFetch(path, opts = {}) {
  return new Promise((resolve, reject) => {
    const fullUrl = path.startsWith("http") ? path : `https://gateway.maton.ai${path}`;
    const parsed = new URL(fullUrl);
    const headers = {
      Authorization: `Bearer ${MATON_API_KEY}`,
      "x-maton-connection": MATON_CONNECTION_ID,
      ...(opts.headers || {}),
    };
    const options = {
      hostname: parsed.hostname,
      port: 443,
      path: parsed.pathname + parsed.search,
      method: opts.method || "GET",
      headers,
    };
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const body = Buffer.concat(chunks);
        if (opts.binary || parsed.searchParams.has("alt")) {
          resolve({ status: res.statusCode, headers: res.headers, body, isBinary: true });
        } else {
          try {
            resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(body) });
          } catch {
            resolve({ status: res.statusCode, headers: res.headers, body, isBinary: true });
          }
        }
      });
    });
    req.on("error", reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

async function getAudioFiles() {
  const query = encodeURIComponent(`'${PODCAST_FOLDER_ID}' in parents and mimeType='audio/mpeg' and trashed=false`);
  const res = await matonFetch(
    `/google-drive/drive/v3/files?q=${query}&fields=files(id,name,mimeType,createdTime,size)&orderBy=createdTime desc`
  );
  if (res.status !== 200 || !res.body.files) {
    console.error("[RSS] Error:", res.body.message || JSON.stringify(res.body));
    return [];
  }
  return res.body.files;
}

function parseEpisodeMeta(file, index, totalFiles) {
  const episodeNum = totalFiles - index; // 最新的是第1集
  const dateMatch = file.name.match(/(\d{4})[_-]?(\d{2})[_-]?(\d{2})/);
  const epMatch = file.name.match(/[Ee][Pp]\s*(\d+)/);

  let title;
  if (dateMatch) {
    const [, y, m, d] = dateMatch;
    title = `第${episodeNum}集｜${y}/${m}/${d}`;
  } else if (epMatch) {
    title = `第${epMatch[1]}集`;
  } else {
    title = file.name.replace(/\.mp3$/i, "");
  }

  const description = `${PODCAST_TITLE}，${title}。${PODCAST_DESCRIPTION}`;
  const pubDate = file.createdTime ? new Date(file.createdTime).toUTCString() : new Date().toUTCString();
  const size = parseInt(file.size || 0);
  const audioUrl = `${SITE_URL.replace(/\/$/, "")}/audio/${file.id}.mp3`;
  const duration = Math.floor(size / 16000); // 粗略估算秒數
  const durationFormatted = formatDuration(duration);

  return { title, description, pubDate, size, audioUrl, duration, durationFormatted, episodeNum };
}

function formatDuration(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
  return `${m}:${String(s).padStart(2,"0")}`;
}

function buildRSS(files) {
  const base = SITE_URL.replace(/\/$/, "");
  const now = new Date().toUTCString();
  const items = files
    .map((file, index) => {
      const meta = parseEpisodeMeta(file, index, files.length);
      return `    <item>
      <title><![CDATA[${meta.title}]]></title>
      <link>${base}/</link>
      <description><![CDATA[${meta.description}]]></description>
      <itunes:summary><![CDATA[${meta.description}]]></itunes:summary>
      <pubDate>${meta.pubDate}</pubDate>
      <enclosure url="${meta.audioUrl}" type="audio/mpeg" length="${meta.size}"/>
      <guid isPermaLink="false">mchswallow_ep${meta.episodeNum}_${file.id}</guid>
      <itunes:title>${meta.title}</itunes:title>
      <itunes:episode>${meta.episodeNum}</itunes:episode>
      <itunes:episodeType>full</itunes:episodeType>
      <itunes:image href="${PODCAST_COVER_URL}"/>
      <itunes:duration>${meta.durationFormatted}</itunes:duration>
      <itunes:explicit>false</itunes:explicit>
    </item>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"
  xmlns:atom="http://www.w3.org/2005/Atom"
  xmlns:content="http://purl.org/rss/1.0/modules/content/"
  xmlns:podcast="https://podcastindex.org/namespace/1.0">
  <channel>
    <title>${PODCAST_TITLE}</title>
    <link>${base}/</link>
    <description><![CDATA[${PODCAST_DESCRIPTION}]]></description>
    <language>zh-tw</language>
    <copyright>Copyright ${new Date().getFullYear()} ${PODCAST_AUTHOR}</copyright>
    <lastBuildDate>${now}</lastBuildDate>
    <image>
      <url>${PODCAST_COVER_URL}</url>
      <title>${PODCAST_TITLE}</title>
      <link>${base}/</link>
    </image>
    <itunes:author>${PODCAST_AUTHOR}</itunes:author>
    <itunes:subtitle>${PODCAST_TITLE}</itunes:subtitle>
    <itunes:summary><![CDATA[${PODCAST_DESCRIPTION}]]></itunes:summary>
    <itunes:type>episodic</itunes:type>
    <itunes:explicit>false</itunes:explicit>
    <itunes:image href="${PODCAST_COVER_URL}"/>
    <itunes:category text="Science"/>
    <itunes:category text="Health &amp; Fitness"/>
    <itunes:owner>
      <itunes:name>${PODCAST_AUTHOR}</itunes:name>
      <itunes:email>${PODCAST_EMAIL}</itunes:email>
    </itunes:owner>
    <ttl>60</ttl>
    <atom:link href="${base}/feed.xml" rel="self" type="application/rss+xml"/>
    <podcast:locked>no</podcast:locked>
    <podcast:guid>${PODCAST_AUTHOR.replace(/[^a-z0-9]/gi, "")}-podcast</podcast:guid>
    <podcast:medium>audio</podcast:medium>
    <podcast:showOwner>true</podcast:showOwner>
${items}
  </channel>
</rss>`;
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = parsedUrl.pathname;

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      Allow: "GET, HEAD, OPTIONS",
    });
    res.end();
    return;
  }

  if (pathname === "/feed.xml") {
    res.writeHead(200, { "Content-Type": "application/rss+xml; charset=utf-8", "Cache-Control": "no-cache" });
    try {
      const files = await getAudioFiles();
      res.end(buildRSS(files));
    } catch (e) {
      console.error("[RSS] Error:", e.message);
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("RSS Error: " + e.message);
    }
    return;
  }

  const audioMatch = pathname.match(/^\/audio\/(.+)/);
  if (audioMatch) {
    const fileId = audioMatch[1].replace(/\.mp3$/i, "");
    const isHead = req.method === "HEAD";
    const rangeHeader = req.headers["range"];
    console.log(`[AUDIO] ${isHead ? "HEAD" : "GET"}: ${fileId}${rangeHeader ? " (" + rangeHeader + ")" : ""}`);

    try {
      // HEAD — 只用 probe 探測大小，不下載完整檔案
      if (isHead) {
        const probeOpts = { binary: true, headers: { Range: "bytes=0-0" } };
        const probeRes = await matonFetch(`/google-drive/drive/v3/files/${fileId}?alt=media`, probeOpts);
        let totalSize = 0;
        if (probeRes.headers["content-range"]) {
          const match = probeRes.headers["content-range"].match(/\/(\d+)$/);
          if (match) totalSize = parseInt(match[1], 10);
        }

        const headBase = {
          "Content-Type": probeRes.headers["content-type"] || "audio/mpeg",
          "Accept-Ranges": "bytes",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=86400",
        };

        // HEAD + Range → 206 + Content-Range
        if (rangeHeader) {
          const parts = rangeHeader.replace(/bytes=\s*/i, "").split("-");
          const start = parseInt(parts[0], 10);
          const end = parts[1] ? parseInt(parts[1], 10) : totalSize - 1;
          const chunkSize = Math.min(end - start + 1, totalSize - start);
          if (start >= totalSize || start < 0) {
            res.writeHead(416, { "Content-Range": `bytes */${totalSize}` });
            res.end();
            return;
          }
          res.writeHead(206, {
            ...headBase,
            "Content-Range": `bytes ${start}-${start + chunkSize - 1}/${totalSize}`,
            "Content-Length": chunkSize,
          });
          res.end();
          return;
        }

        // 一般 HEAD (無 Range) → 200
        res.writeHead(200, { ...headBase, "Content-Length": totalSize });
        res.end();
        return;
      }

      // GET — 從 Maton 下載完整音檔（~4MB，記憶體可負擔）
      const fileRes = await matonFetch(`/google-drive/drive/v3/files/${fileId}?alt=media`, { binary: true });

      if (fileRes.status !== 200) {
        console.error(`[AUDIO] Error ${fileRes.status}:`, fileRes.body.error || fileRes.body.message);
        res.writeHead(fileRes.status, { "Content-Type": "text/plain" });
        res.end(fileRes.body.error ? JSON.stringify(fileRes.body) : "Audio not found");
        return;
      }

      const audioData = Buffer.isBuffer(fileRes.body) ? fileRes.body : Buffer.from(fileRes.body);
      const totalSize = audioData.length;

      const baseHeaders = {
        "Content-Type": fileRes.headers["content-type"] || "audio/mpeg",
        "Accept-Ranges": "bytes",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=86400",
      };

      // GET with Range — 本地 slice，回傳 206
      if (rangeHeader) {
        const parts = rangeHeader.replace(/bytes=\s*/i, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : totalSize - 1;
        const chunkSize = Math.min(end - start + 1, totalSize - start);

        // 驗證範圍
        if (start >= totalSize || start < 0) {
          res.writeHead(416, { "Content-Range": `bytes */${totalSize}` });
          res.end();
          return;
        }

        const chunk = audioData.slice(start, start + chunkSize);
        res.writeHead(206, {
          ...baseHeaders,
          "Content-Range": `bytes ${start}-${start + chunkSize - 1}/${totalSize}`,
          "Content-Length": chunkSize,
        });
        res.end(chunk);
        return;
      }

      // GET without Range — 完整檔案
      res.writeHead(200, { ...baseHeaders, "Content-Length": totalSize });
      res.end(audioData);

    } catch (e) {
      console.error("[AUDIO] Error:", e.message);
      res.writeHead(502, { "Content-Type": "text/plain" });
      res.end("Audio proxy error: " + e.message);
    }
    return;
  }

  if (pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", time: new Date().toISOString() }));
    return;
  }

  // 封面圖片
  if (pathname === "/cover.png") {
    const coverPath = path.join(__dirname, "public", "cover.png");
    if (fs.existsSync(coverPath)) {
      const coverData = fs.readFileSync(coverPath);
      res.writeHead(200, {
        "Content-Type": "image/png",
        "Content-Length": coverData.length,
        "Cache-Control": "public, max-age=86400",
        "Accept-Ranges": "bytes",
      });
      if (req.method === "HEAD") { res.end(); return; }
      res.end(coverData);
    } else {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Cover not found");
    }
    return;
  }

  // Debug — 直接回傳 Maton API 的原始回應
  if (pathname === "/debug") {
    try {
      const files = await getAudioFiles();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        hasApiKey: !!MATON_API_KEY,
        connId: MATON_CONNECTION_ID,
        folderId: PODCAST_FOLDER_ID,
        fileCount: files.length,
        files: files.map(f => ({ id: f.id, name: f.name, size: f.size, created: f.createdTime })),
        env: {
          MATON_CONN: !!process.env.MATON_CONN,
          MATON_CONNECTION_ID: !!process.env.MATON_CONNECTION_ID,
          MATON_API_KEY: !!process.env.MATON_API_KEY,
          PODCAST_FOLDER_ID: !!process.env.PODCAST_FOLDER_ID,
        }
      }, null, 2));
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // 首頁 — 簡單的 Podcast 資訊頁
  if (pathname === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${PODCAST_TITLE}</title>
  <link rel="alternate" type="application/rss+xml" title="${PODCAST_TITLE}" href="${SITE_URL}/feed.xml">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 640px; margin: 0 auto; padding: 2rem; text-align: center; background: #fafafa; color: #333; }
    img { max-width: 300px; border-radius: 12px; box-shadow: 0 4px 24px rgba(0,0,0,0.1); }
    h1 { font-size: 1.5rem; margin: 1rem 0 0.5rem; }
    p { color: #666; line-height: 1.6; }
    a { color: #2563eb; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .badge { display: inline-block; margin-top: 1rem; padding: 0.5rem 1rem; background: #2563eb; color: #fff; border-radius: 8px; font-size: 0.875rem; }
  </style>
</head>
<body>
  <img src="/cover.png" alt="${PODCAST_TITLE}">
  <h1>${PODCAST_TITLE}</h1>
  <p>${PODCAST_DESCRIPTION}</p>
  <p>📻 ${PODCAST_AUTHOR}</p>
  <a class="badge" href="/feed.xml">訂閱 RSS Feed</a>
</body>
</html>`);
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
});

server.listen(PORT, () => {
  console.log(`🎙  MCH Swallow RSS 啟動中...`);
  console.log(`🌐  RSS Feed: ${SITE_URL}/feed.xml`);
  console.log(`🎵  Audio Proxy: ${SITE_URL}/audio/<file_id>`);
  console.log(`❤️  Health: ${SITE_URL}/health`);
  if (!MATON_API_KEY) console.warn("⚠️  MATON_API_KEY 未設定！");
});