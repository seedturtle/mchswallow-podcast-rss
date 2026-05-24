const http = require("http");
const https = require("https");
const { URL } = require("url");

const PORT = parseInt(process.env.PORT || "3000", 10);
const SITE_URL = process.env.SITE_URL || "https://mchswallowpodcast.zeabur.app";
const PODCAST_FOLDER_ID = process.env.PODCAST_FOLDER_ID || "1Yiwx-jIqmw37TvbMl5dDbVPcgetEPzIW";
const MATON_API_KEY = process.env.MATON_API_KEY || "";
// 支援 MATON_CONN（README 標準）或 MATON_CONNECTION_ID（舊版）
const MATON_CONNECTION_ID = process.env.MATON_CONN || process.env.MATON_CONNECTION_ID || "aa84aef8-287a-4271-a4b7-26a67b0c6adf";
const PODCAST_TITLE = process.env.PODCAST_TITLE || "MCH Swallow 吞嚥 Podcast";
const PODCAST_DESCRIPTION = process.env.PODCAST_DESCRIPTION || "吞嚥復健、肌能訓練與臨床經驗分享";
const PODCAST_AUTHOR = process.env.PODCAST_AUTHOR || "MCH 吞嚥團隊";
const PODCAST_EMAIL = process.env.PODCAST_EMAIL || "mchswallow@gmail.com";
const PODCAST_COVER_URL = process.env.PODCAST_COVER_URL || "https://seedturtle.zo.space/images/mch-podcast-cover.png";

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

function buildRSS(files) {
  const base = SITE_URL.replace(/\/$/, "");
  const items = files
    .map((f) => {
      const audioUrl = `${base}/audio/${f.id}`;
      const pubDate = f.createdTime ? new Date(f.createdTime).toUTCString() : new Date().toUTCString();
      return `    <item>
      <title>${f.name.replace(/\.mp3$/i, "")}</title>
      <enclosure url="${audioUrl}" type="audio/mpeg" length="${f.size || 0}" />
      <guid isPermaLink="false">${f.id}</guid>
      <pubDate>${pubDate}</pubDate>
    </item>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"
  xmlns:atom="http://www.w3.org/2005/Atom"
  xmlns:content="http://purl.org/rss/1.0/modules/content/"
  xml:lang="zh-TW">
  <channel>
    <title>${PODCAST_TITLE}</title>
    <link>${SITE_URL}</link>
    <atom:link href="${base}/feed.xml" rel="self" type="application/rss+xml" />
    <description><![CDATA[${PODCAST_DESCRIPTION}]]></description>
    <language>zh-TW</language>
    <itunes:author>${PODCAST_AUTHOR}</itunes:author>
    <itunes:summary><![CDATA[${PODCAST_DESCRIPTION}]]></itunes:summary>
    <itunes:explicit>false</itunes:explicit>
    <itunes:image href="${PODCAST_COVER_URL}" />
    <itunes:category text="Education" />
    <itunes:owner>
      <itunes:name>${PODCAST_AUTHOR}</itunes:name>
      <itunes:email>${PODCAST_EMAIL}</itunes:email>
    </itunes:owner>
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
    const fileId = audioMatch[1];
    const isHead = req.method === "HEAD";
    const rangeHeader = req.headers["range"];
    console.log(`[AUDIO] ${isHead ? "HEAD" : "GET"}: ${fileId}${rangeHeader ? " (" + rangeHeader + ")" : ""}`);

    try {
      const fetchOpts = { binary: true };
      if (rangeHeader) fetchOpts.headers = { Range: rangeHeader };

      const apiRes = await matonFetch(`/google-drive/drive/v3/files/${fileId}?alt=media`, fetchOpts);

      if (apiRes.status === 200 || apiRes.status === 206) {
        const ctype = apiRes.headers["content-type"] || "audio/mpeg";
        res.setHeader("Content-Type", ctype);
        if (apiRes.headers["content-length"]) res.setHeader("Content-Length", apiRes.headers["content-length"]);
        if (apiRes.headers["content-range"]) res.setHeader("Content-Range", apiRes.headers["content-range"]);
        res.setHeader("Accept-Ranges", "bytes");
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Cache-Control", "public, max-age=86400");

        if (isHead) {
          res.writeHead(apiRes.status);
          res.end();
        } else {
          res.writeHead(apiRes.status);
          res.end(apiRes.body);
        }
      } else {
        console.error(`[AUDIO] Error ${apiRes.status}:`, apiRes.body.error || apiRes.body.message);
        res.writeHead(apiRes.status, { "Content-Type": "text/plain" });
        res.end(apiRes.body.error ? JSON.stringify(apiRes.body) : "Audio not found");
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