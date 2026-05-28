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
const PODCAST_TITLE = process.env.PODCAST_TITLE || "洄瀾聽雨";
const PODCAST_DESCRIPTION = process.env.PODCAST_DESCRIPTION || "吞嚥復健、肌能訓練與臨床經驗分享。歡迎聽眾寫信到 mchswallow@gmail.com 提問或表達意見，主持人會在製作新集數時參考大家的回饋一起討論！";
const PODCAST_AUTHOR = process.env.PODCAST_AUTHOR || "洄瀾聽語團隊";
const PODCAST_EMAIL = process.env.PODCAST_EMAIL || "mchswallow@gmail.com";
const PODCAST_COVER_URL = process.env.PODCAST_COVER_URL || `${SITE_URL.replace(/\/$/, "")}/cover-v4.png`;

// ── ID3 Metadata Cache ─────────────────────────────────────────────
const ID3_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const id3Cache = { data: null, ts: 0 };

function parseID3(buffer) {
  const meta = {};
  // Check for ID3v2 header
  if (buffer.length < 10 || buffer[0] !== 0x49 || buffer[1] !== 0x44 || buffer[2] !== 0x33) return meta;

  const version = buffer[3]; // 3 = ID3v2.3, 4 = ID3v2.4
  const size = ((buffer[6] & 0x7f) << 21) | ((buffer[7] & 0x7f) << 14) | ((buffer[8] & 0x7f) << 7) | (buffer[9] & 0x7f);
  const end = Math.min(size + 10, buffer.length);

  let pos = 10;
  while (pos < end - 10) {
    const frameId = buffer.toString("ascii", pos, pos + 4);
    if (frameId[0] === "\0") break; // padding

    let frameSize;
    if (version === 4) {
      frameSize = ((buffer[pos + 4] & 0x7f) << 21) | ((buffer[pos + 5] & 0x7f) << 14) | ((buffer[pos + 6] & 0x7f) << 7) | (buffer[pos + 7] & 0x7f);
    } else {
      frameSize = (buffer[pos + 4] << 24) | (buffer[pos + 5] << 16) | (buffer[pos + 6] << 8) | buffer[pos + 7];
    }

    if (frameSize <= 0 || pos + 10 + frameSize > end) break;

    const frameData = buffer.slice(pos + 10, pos + 10 + frameSize);

    // Text frames (T*** except TXXX)
    if (frameId[0] === "T" && frameId !== "TXXX" && frameId !== "TXXX") {
      const encoding = frameData[0];
      let text;
      if (encoding === 0 || encoding === 3) {
        text = frameData.slice(1).toString(encoding === 3 ? "utf8" : "latin1");
      } else if (encoding === 1) {
        // UTF-16LE with BOM
        text = frameData.slice(4).toString("utf16le");
      } else {
        text = frameData.slice(1).toString("utf8");
      }
      meta[frameId] = text.replace(/\0/g, "").trim();
    }

    // COMM frame (comment)
    if (frameId === "COMM") {
      const encoding = frameData[0];
      // language code (3 bytes) + short description (null-terminated) + comment text
      let pos2 = 4; // skip encoding(1) + lang(3)
      while (pos2 < frameData.length && frameData[pos2] !== 0) pos2++;
      pos2++; // skip null terminator

      const commentBuf = frameData.slice(pos2);
      if (encoding === 0 || encoding === 3) {
        meta.comment = commentBuf.toString(encoding === 3 ? "utf8" : "latin1").replace(/\0/g, "").trim();
      } else if (encoding === 1) {
        meta.comment = commentBuf.toString("utf16le").replace(/\0/g, "").trim();
      } else {
        meta.comment = commentBuf.toString("utf8").replace(/\0/g, "").trim();
      }
    }

    pos += 10 + frameSize;
  }

  return meta;
}

async function fetchID3FromFile(fileId) {
  try {
    // Download first 30KB — enough for ID3 tags
    const res = await matonFetch(`/google-drive/drive/v3/files/${fileId}?alt=media`, {
      binary: true,
      headers: { Range: "bytes=0-30719" },
    });
    if (res.status === 200 || res.status === 206) {
      return parseID3(Buffer.isBuffer(res.body) ? res.body : Buffer.from(res.body));
    }
  } catch (e) {
    console.error(`[ID3] Error fetching ${fileId}:`, e.message);
  }
  return {};
}

async function getCachedID3Meta() {
  if (id3Cache.data && Date.now() - id3Cache.ts < ID3_CACHE_TTL_MS) {
    return id3Cache.data;
  }
  console.log("[ID3] Refreshing metadata cache...");
  const files = await getAudioFiles();
  const result = {};
  // Fetch in parallel, max 6 at a time
  for (let i = 0; i < files.length; i += 6) {
    const batch = files.slice(i, i + 6);
    const metas = await Promise.all(batch.map((f) => fetchID3FromFile(f.id)));
    batch.forEach((f, j) => {
      result[f.id] = metas[j];
    });
  }
  id3Cache.data = result;
  id3Cache.ts = Date.now();
  console.log(`[ID3] Cached metadata for ${Object.keys(result).length} files`);
  return result;
}

// ── Maton / Google Drive ────────────────────────────────────────────

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

// ── RSS Helpers ─────────────────────────────────────────────────────

function rfc2822(date) {
  return (date || new Date()).toUTCString().replace("GMT", "+0000");
}

function parseEpisodeMeta(file, index, totalFiles, id3meta) {
  const episodeNum = totalFiles - index;
  const dateMatch = file.name.match(/(\d{4})[_-]?(\d{2})[_-]?(\d{2})/);
  const epMatch = file.name.match(/[Ee][Pp]\s*(\d+)/);

  let title;
  if (id3meta && id3meta.TIT2) {
    title = id3meta.TIT2;
  } else if (dateMatch) {
    const [, y, m, d] = dateMatch;
    title = `第${episodeNum}集｜${y}/${m}/${d}`;
  } else if (epMatch) {
    title = `第${epMatch[1]}集`;
  } else {
    title = file.name.replace(/\.mp3$/i, "");
  }

  // Prefer ID3 comment as description, fallback to default
  const description =
    id3meta && id3meta.comment
      ? id3meta.comment
      : `${PODCAST_TITLE}，${title}。${PODCAST_DESCRIPTION}`;

  const pubDate = rfc2822(file.createdTime ? new Date(file.createdTime) : null);
  const size = parseInt(file.size || 0);
  const audioUrl = `${SITE_URL.replace(/\/$/, "")}/audio/ep${episodeNum}.mp3`;
  const duration = Math.floor(size / 16000);

  return { title, description, pubDate, size, audioUrl, duration, episodeNum };
}

function buildRSS(files, id3meta) {
  const base = SITE_URL.replace(/\/$/, "");
  const now = rfc2822();
  const items = files
    .map((file, index) => {
      const meta = parseEpisodeMeta(file, index, files.length, id3meta ? id3meta[file.id] : null);
      return `    <item>
      <title><![CDATA[${meta.title}]]></title>
      <link>${base}/</link>
      <description><![CDATA[${meta.description}]]></description>
      <itunes:summary><![CDATA[${meta.description}]]></itunes:summary>
      <pubDate>${meta.pubDate}</pubDate>
      <enclosure url="${meta.audioUrl}" type="audio/mpeg" length="${meta.size}"/>
      <guid isPermaLink="false">huilan_tingyu_ep${meta.episodeNum}</guid>
      <itunes:title>${meta.title}</itunes:title>
      <itunes:episode>${meta.episodeNum}</itunes:episode>
      <itunes:episodeType>full</itunes:episodeType>
      <itunes:image href="${PODCAST_COVER_URL}"/>
      <itunes:duration>${meta.duration}</itunes:duration>
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
    <language>zh</language>
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
    <podcast:guid>huilan-tingyu-podcast</podcast:guid>
    <podcast:medium>audio</podcast:medium>
    <podcast:showOwner>true</podcast:showOwner>
${items}
  </channel>
</rss>`;
}

// ── HTTP Server ─────────────────────────────────────────────────────

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

  // ── RSS Feed ──
  if (pathname === "/feed.xml") {
    res.writeHead(200, { "Content-Type": "application/rss+xml; charset=utf-8", "Cache-Control": "no-cache" });
    try {
      const [files, id3meta] = await Promise.all([getAudioFiles(), getCachedID3Meta()]);
      res.end(buildRSS(files, id3meta));
    } catch (e) {
      console.error("[RSS] Error:", e.message);
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("RSS Error: " + e.message);
    }
    return;
  }

  // ── Audio Proxy ──
  const audioMatch = pathname.match(/^\/audio\/(.+)/);
  if (audioMatch) {
    let fileId = audioMatch[1].replace(/\.mp3$/i, "");
    const isHead = req.method === "HEAD";
    const rangeHeader = req.headers["range"];

    // /audio/ep<N>.mp3 → 自動查 Google Drive 對應的檔案 ID
    const epMatch = fileId.match(/^ep(\d+)$/i);
    if (epMatch) {
      try {
        const files = await getAudioFiles();
        const targetEpNum = parseInt(epMatch[1], 10);
        const file = files.find((f, idx) => (files.length - idx) === targetEpNum);
        if (file) fileId = file.id;
      } catch {
        // 查不到就保留原值，後續會 404
      }
    }

    // 舊 ID 轉址表
    const fileRedirects = {
      "1lNP32OOREUnRHeo0AZ9-DOjZvc5V3-89": "12GAt6fvOUw_IHmIrEJlTVPukn6Dus9m1",
    };
    const resolvedId = fileRedirects[fileId] || fileId;

    console.log(`[AUDIO] ${isHead ? "HEAD" : "GET"}: ${fileId} → ${resolvedId}${rangeHeader ? " (" + rangeHeader + ")" : ""}`);

    try {
      if (isHead) {
        const probeOpts = { binary: true, headers: { Range: "bytes=0-0" } };
        const probeRes = await matonFetch(`/google-drive/drive/v3/files/${resolvedId}?alt=media`, probeOpts);
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

        res.writeHead(200, { ...headBase, "Content-Length": totalSize });
        res.end();
        return;
      }

      // GET
      const fileRes = await matonFetch(`/google-drive/drive/v3/files/${resolvedId}?alt=media`, { binary: true });

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

        const chunk = audioData.slice(start, start + chunkSize);
        res.writeHead(206, {
          ...baseHeaders,
          "Content-Range": `bytes ${start}-${start + chunkSize - 1}/${totalSize}`,
          "Content-Length": chunkSize,
        });
        res.end(chunk);
        return;
      }

      res.writeHead(200, { ...baseHeaders, "Content-Length": totalSize });
      res.end(audioData);

    } catch (e) {
      console.error("[AUDIO] Error:", e.message);
      res.writeHead(502, { "Content-Type": "text/plain" });
      res.end("Audio proxy error: " + e.message);
    }
    return;
  }

  // ── Health ──
  if (pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", time: new Date().toISOString() }));
    return;
  }

  // ── Cover images ──
  if (pathname === "/cover.png" || pathname === "/cover-v2.png" || pathname === "/cover-v4.png") {
    let coverFile;
    if (pathname === "/cover-v4.png") coverFile = "cover-v4.png";
    else if (pathname === "/cover-v2.png") coverFile = "cover-v2.png";
    else coverFile = "cover.png";
    const coverPath = path.join(__dirname, "public", coverFile);
    if (fs.existsSync(coverPath)) {
      const coverData = fs.readFileSync(coverPath);
      const totalSize = coverData.length;
      const isHead = req.method === "HEAD";
      const rangeHeader = req.headers["range"];

      const baseHeaders = {
        "Content-Type": "image/png",
        "Accept-Ranges": "bytes",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=86400",
      };

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
        const chunk = coverData.slice(start, start + chunkSize);
        res.writeHead(206, {
          ...baseHeaders,
          "Content-Range": `bytes ${start}-${start + chunkSize - 1}/${totalSize}`,
          "Content-Length": chunkSize,
        });
        if (isHead) { res.end(); return; }
        res.end(chunk);
        return;
      }

      res.writeHead(200, { ...baseHeaders, "Content-Length": totalSize });
      if (isHead) { res.end(); return; }
      res.end(coverData);
    } else {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Cover not found");
    }
    return;
  }

  // ── Debug ──
  if (pathname === "/debug") {
    try {
      const [files, id3meta] = await Promise.all([getAudioFiles(), getCachedID3Meta()]);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        hasApiKey: !!MATON_API_KEY,
        connId: MATON_CONNECTION_ID,
        folderId: PODCAST_FOLDER_ID,
        fileCount: files.length,
        files: files.map((f, i) => ({
          id: f.id,
          name: f.name,
          size: f.size,
          created: f.createdTime,
          episodeNum: files.length - i,
          id3: id3meta[f.id] || {},
        })),
        cacheAge: Date.now() - id3Cache.ts,
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

  // ── Homepage ──
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
  <img src="/cover-v4.png" alt="${PODCAST_TITLE}">
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
  console.log(`📝  ID3 metadata: 讀取 MP3 檔案內嵌的 comment 作為單集說明`);
  if (!MATON_API_KEY) console.warn("⚠️  MATON_API_KEY 未設定！");
});
