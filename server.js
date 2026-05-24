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
  xmlns:content="http://purl.org/rss/1.0/modules/content/">
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

  if (pathname === "/feed.xml" || pathname === "/") {
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
      // Step 1: 先探測檔案大小（用 Range: bytes=0-0 取 Content-Range）
      const probeOpts = { binary: true, headers: { Range: "bytes=0-0" } };
      const probeRes = await matonFetch(`/google-drive/drive/v3/files/${fileId}?alt=media`, probeOpts);

      let totalSize = null;
      if (probeRes.headers["content-range"]) {
        const match = probeRes.headers["content-range"].match(/\/(\d+)$/);
        if (match) totalSize = parseInt(match[1]);
      }
      // 只用 Content-Range，不從 Content-Length（Range response 的 Content-Length 只是片段大小）

      const commonHeaders = {
        "Content-Type": probeRes.headers["content-type"] || "audio/mpeg",
        "Accept-Ranges": "bytes",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=86400",
      };
      if (totalSize) commonHeaders["Content-Length"] = totalSize;

      // HEAD：回傳 200，只給 header 即可
      if (isHead) {
        res.writeHead(totalSize ? 200 : probeRes.status, commonHeaders);
        res.end();
        return;
      }

      // GET without Range：取完整檔案
      if (!rangeHeader) {
        const fullRes = await matonFetch(`/google-drive/drive/v3/files/${fileId}?alt=media`, { binary: true });
        if (fullRes.status === 200) {
          res.writeHead(200, commonHeaders);
          res.end(fullRes.body);
        } else {
          console.error(`[AUDIO] Error ${fullRes.status}:`, fullRes.body.error || fullRes.body.message);
          res.writeHead(fullRes.status, { "Content-Type": "text/plain" });
          res.end(fullRes.body.error ? JSON.stringify(fullRes.body) : "Audio not found");
        }
        return;
      }

      // GET with Range：轉送 Range header 給 Maton，回傳 206
      const rangeOpts = { binary: true, headers: { Range: rangeHeader } };
      const rangeRes = await matonFetch(`/google-drive/drive/v3/files/${fileId}?alt=media`, rangeOpts);

      if (rangeRes.status === 206 || rangeRes.status === 200) {
        const rangeHeaders = {
          "Content-Type": rangeRes.headers["content-type"] || "audio/mpeg",
          "Accept-Ranges": "bytes",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=86400",
        };
        if (rangeRes.headers["content-range"]) rangeHeaders["Content-Range"] = rangeRes.headers["content-range"];
        if (totalSize) rangeHeaders["Content-Length"] = rangeRes.headers["content-length"] || totalSize;
        res.writeHead(rangeRes.status === 200 ? 206 : rangeRes.status, rangeHeaders);
        res.end(rangeRes.body);
      } else {
        console.error(`[AUDIO] Error ${rangeRes.status}:`, rangeRes.body.error || rangeRes.body.message);
        res.writeHead(rangeRes.status, { "Content-Type": "text/plain" });
        res.end(rangeRes.body.error ? JSON.stringify(rangeRes.body) : "Audio not found");
      }
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