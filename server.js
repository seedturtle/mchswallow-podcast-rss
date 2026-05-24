/**
 * MCH Swallow 吞嚥 Podcast RSS Feed 伺服器（生產版）
 * 特色：
 *   - 自動從 Google Drive 讀取 MP3，生成 Apple Podcast 相容 RSS
 *   - 音訊透過 Maton API 串流（繞過 Google Drive 權限限制）
 *   - 支援 HEAD 請求（Apple Podcasts 必備）
 *   - CORS 完整支援
 */

const http = require("http");
const https = require("https");
const { URL } = require("url");

// ── 必填設定（Zeabur 環境變數）────────────────────────
const PORT = process.env.PORT || 3000;
const SITE_URL = process.env.SITE_URL || "https://your-app.zeabur.app";
const PODCAST_FOLDER_ID = process.env.PODCAST_FOLDER_ID || "YOUR_FOLDER_ID";
const PODCAST_TITLE = process.env.PODCAST_TITLE || "MCH Swallow 吞嚥 Podcast";
const PODCAST_DESCRIPTION =
  process.env.PODCAST_DESCRIPTION ||
  "MCH 吞嚥復健 Podcast — 吞嚥障礙最新醫學新知、肌能訓練與臨床實務，陪伴語言治療師與個案一起進步。";
const PODCAST_AUTHOR = process.env.PODCAST_AUTHOR || "MCH Swallow 吞嚥團隊";
const PODCAST_EMAIL = process.env.PODCAST_EMAIL || "mchswallow@gmail.com";
const PODCAST_CATEGORY = process.env.PODCAST_CATEGORY || "Health & Fitness";
const PODCAST_IMAGE =
  process.env.PODCAST_IMAGE ||
  "https://seedturtle.zo.space/images/mch-podcast-cover.png";

// Maton API（Maton Connection ID）
const MATON_CONN = process.env.MATON_CONN || "";
const MATON_API_KEY = process.env.MATON_API_KEY || "";

// ── Google Drive API ────────────────────────────────
const GDRIVE_BASE = "https://www.googleapis.com/drive/v3";
const GDRIVE_FILES_API = `${GDRIVE_BASE}/files`;

// ── 取得 Podcast 檔案列表 ───────────────────────────
function getPodcastFiles() {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({
      q: `'${PODCAST_FOLDER_ID}' in parents and mimeType='audio/mpeg' and trashed=false`,
      fields:
        "files(id,name,mimeType,createdTime,modifiedTime,size)",
      orderBy: "createdTime desc",
      pageSize: "50",
    });

    const url = new URL(`${GDRIVE_FILES_API}?${params}`);
    https.get(
      {
        hostname: url.hostname,
        path: url.pathname + url.search,
        headers: { accept: "application/json" },
      },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          try {
            const data = JSON.parse(body);
            if (data.error) {
              reject(new Error(data.error.message));
              return;
            }
            resolve(data.files || []);
          } catch (e) {
            reject(new Error("Failed to parse Drive API response: " + e.message));
          }
        });
      }
    ).on("error", reject);
  });
}

// ── 建立 RSS XML ────────────────────────────────────
function buildRss(files) {
  const items = files
    .map((f, i) => {
      const fileId = f.id;
      const audioUrl = `${SITE_URL}/audio/${fileId}`;
      const pubDate = new Date(f.createdTime).toUTCString();
      const duration = Math.round((f.size || 300000) / 16000);
      const size = parseInt(f.size || 0, 10);

      return `
    <item>
      <title>${f.name.replace(/\.mp3$/i, "")}</title>
      <description>MCH 吞嚥 Podcast 第 ${files.length - i} 集</description>
      <pubDate>${pubDate}</pubDate>
      <enclosure url="${audioUrl}" type="audio/mpeg" length="${size}" />
      <itunes:duration>${duration}</itunes:duration>
      <guid isPermaLink="false">${fileId}</guid>
      <itunes:episodeType>full</itunes:episodeType>
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
    <link>${SITE_URL}</link>
    <language>zh-TW</language>
    <copyright>© ${new Date().getFullYear()} ${PODCAST_AUTHOR}</copyright>
    <itunes:author>${PODCAST_AUTHOR}</itunes:author>
    <itunes:summary>${PODCAST_DESCRIPTION}</itunes:summary>
    <description>${PODCAST_DESCRIPTION}</description>
    <itunes:owner>
      <itunes:name>${PODCAST_AUTHOR}</itunes:name>
      <itunes:email>${PODCAST_EMAIL}</itunes:email>
    </itunes:owner>
    <itunes:explicit>false</itunes:explicit>
    <itunes:category text="${PODCAST_CATEGORY}" />
    <itunes:image href="${PODCAST_IMAGE}" />
    <image>
      <url>${PODCAST_IMAGE}</url>
      <title>${PODCAST_TITLE}</title>
      <link>${SITE_URL}</link>
    </image>
    <atom:link href="${SITE_URL}/feed.xml" rel="self" type="application/rss+xml"/>
${items}
  </channel>
</rss>`;
}

// ── HTTP 伺服器 ─────────────────────────────────────
const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Range");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // 健康檢查
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", time: new Date().toISOString() }));
    return;
  }

  // RSS Feed（支援 GET 和 HEAD）
  if (req.url === "/feed.xml" || req.url === "/") {
    try {
      const files = await getPodcastFiles();
      const xml = buildRss(files);
      const xmlBuf = Buffer.from(xml, "utf8");
      res.writeHead(200, {
        "Content-Type": "application/rss+xml; charset=utf-8",
        "Content-Length": xmlBuf.byteLength,
        "Cache-Control": "public, max-age=300",
      });
      if (req.method === "HEAD") {
        res.end();
      } else {
        res.end(xml);
      }
    } catch (err) {
      console.error("[RSS] Error:", err.message);
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("RSS Error: " + err.message);
    }
    return;
  }

  // 音訊代理：透過 Maton API 串流
  const audioMatch = req.url.match(/^\/audio\/([a-zA-Z0-9_-]+)\.mp3$/);
  if (audioMatch) {
    const fileId = audioMatch[1];
    const isHead = req.method === "HEAD";

    if (!MATON_API_KEY || !MATON_CONN) {
      console.error("[AUDIO] Missing MATON_API_KEY or MATON_CONN");
      res.writeHead(503);
      res.end("Maton API not configured");
      return;
    }

    const matonUrl = new URL(
      `https://gateway.maton.ai/google-drive/drive/v3/files/${fileId}?alt=media&acknowledgeAbuse=true`
    );

    const proxyReq = https.get(
      {
        hostname: matonUrl.hostname,
        path: matonUrl.pathname + matonUrl.search,
        headers: {
          Authorization: `Bearer ${MATON_API_KEY}`,
          "Maton-Connection": MATON_CONN,
        },
      },
      (driveRes) => {
        if (driveRes.statusCode === 200) {
          const contentLen = driveRes.headers["content-length"] || "";
          res.writeHead(200, {
            "Content-Type": "audio/mpeg",
            "Content-Length": contentLen,
            "Accept-Ranges": "bytes",
            "Cache-Control": "public, max-age=86400",
          });
          if (isHead) {
            driveRes.destroy();
            res.end();
          } else {
            driveRes.pipe(res);
          }
        } else {
          let body = "";
          driveRes.on("data", (c) => (body += c));
          driveRes.on("end", () => {
            console.error(`[AUDIO] Maton ${driveRes.statusCode}: ${body.slice(0, 200)}`);
            res.writeHead(502);
            res.end("Audio proxy error");
          });
        }
      }
    );
    proxyReq.on("error", (err) => {
      console.error(`[AUDIO] Error: ${err.message}`);
      res.writeHead(502);
      res.end("Audio proxy error");
    });
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

server.listen(PORT, () => {
  console.log(`\n🎙  ${PODCAST_TITLE}`);
  console.log(`📡  RSS Feed: ${SITE_URL}/feed.xml`);
  console.log(`🔑  Health:   ${SITE_URL}/health`);
  console.log(`📂  Folder:   ${PODCAST_FOLDER_ID}`);
  console.log(`\n➡️  請在 Zeabur 後台設定以下環境變數：`);
  console.log(`   SITE_URL              — 你的 Zeabur 網址（例：https://mchswallowpodcast.zeabur.app）`);
  console.log(`   PODCAST_FOLDER_ID     — Google Drive 資料夾 ID`);
  console.log(`   MATON_API_KEY         — Maton API Key`);
  console.log(`   MATON_CONN            — Maton Connection ID`);
  if (!MATON_API_KEY) console.warn(`   ⚠️  缺少 MATON_API_KEY，音訊將無法串流！`);
  if (!MATON_CONN) console.warn(`   ⚠️  缺少 MATON_CONN，音訊將無法串流！`);
  if (!PODCAST_IMAGE) console.warn(`   ⚠️  缺少 PODCAST_IMAGE，Apple Podcast 封面可能無法顯示！`);
});