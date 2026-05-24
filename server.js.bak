/**
 * MCH Swallow Podcast RSS Feed Server
 * 使用 Maton API 串流 Google Drive 音訊，Apple Podcast 相容
 * 佈署到 Zeabur
 */

const http = require("http");
const https = require("https");
const url = require("url");

const PORT = process.env.PORT || 3000;

// Google Drive 設定
const PODCAST_FOLDER_ID =
  process.env.PODCAST_FOLDER_ID || "1Yiwx-jIqmw37TvbMl5dDbVPcgetEPzIW";
const MATON_API_KEY = process.env.MATON_API_KEY || "";
const MATON_BASE = process.env.MATON_BASE || "https://gateway.maton.ai";

// Podcast 基本資訊
const PODCAST_TITLE =
  process.env.PODCAST_TITLE || "MCH Swallow 吞嚥 Podcast";
const PODCAST_DESCRIPTION =
  process.env.PODCAST_DESCRIPTION ||
  "吞嚥復健、肌能訓練與臨床新知，陪伴吞嚥治療師與照護者";
const PODCAST_AUTHOR =
  process.env.PODCAST_AUTHOR || "MCH Swallow 吞嚥團隊";
const PODCAST_EMAIL =
  process.env.PODCAST_EMAIL || "mchswallow@gmail.com";
const SITE_URL =
  process.env.SITE_URL || "https://mchswallowpodcast.zeabur.app";
const PODCAST_COVER_URL =
  process.env.PODCAST_COVER_URL ||
  "https://seedturtle.zo.space/images/mch-podcast-cover-v2.png";

// ── Maton API 工具 ─────────────────────────────────────
function matonRequest(path, options = {}) {
  return new Promise((resolve, reject) => {
    const targetUrl = new URL(path, MATON_BASE);
    const isHttps = targetUrl.protocol === "https:";
    const mod = isHttps ? https : http;
    const req = mod.request(
      {
        hostname: targetUrl.hostname,
        port: targetUrl.port || (isHttps ? 443 : 80),
        path: targetUrl.pathname + targetUrl.search,
        method: options.method || "GET",
        headers: {
          Authorization: `Bearer ${MATON_API_KEY}`,
          "Content-Type": "application/json",
          ...(options.headers || {}),
        },
      },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, data: JSON.parse(body) });
          } catch {
            resolve({ status: res.statusCode, data: body });
          }
        });
      }
    );
    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

// ── 從 Maton API 取得 Podcast 資料夾中的 MP3 檔案 ─────
async function fetchPodcastFiles() {
  try {
    const res = await matonRequest(
      `/google-drive/drive/v3/files?fields=files(id,name,mimeType,createdTime,size)&q=${encodeURIComponent(
        `'"${PODCAST_FOLDER_ID}" in parents and mimeType contains "audio" and trashed=false`
      )}&pageSize=50&orderBy=createdTime desc`
    );
    if (res.status !== 200 || !res.data.files) return [];
    return res.data.files.filter((f) => f.name.endsWith(".mp3"));
  } catch (err) {
    console.error("[RSS] Maton API error:", err.message);
    return [];
  }
}

// ── 建構 RSS XML ───────────────────────────────────────
function buildRSS(files) {
  const items = files
    .map((file) => {
      const nameWithoutExt = file.name.replace(/\.mp3$/, "");
      const audioUrl = `${SITE_URL}/audio/${file.id}.mp3`;
      return `
    <item>
      <title><![CDATA[${nameWithoutExt}]]></title>
      <description><![CDATA[${PODCAST_DESCRIPTION}]]></description>
      <enclosure url="${audioUrl}" type="audio/mpeg" length="${file.size || 0}" />
      <guid isPermaLink="false">${file.id}</guid>
      <pubDate>${new Date(file.createdTime).toUTCString()}</pubDate>
      <itunes:duration>0</itunes:duration>
    </item>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"
  xmlns:atom="http://www.w3.org/2005/Atom"
  xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>${PODCAST_TITLE}</title>
    <link>${SITE_URL}</link>
    <description><![CDATA[${PODCAST_DESCRIPTION}]]></description>
    <language>zh-tw</language>
    <copyright>${new Date().getFullYear()} ${PODCAST_AUTHOR}</copyright>
    <itunes:author>${PODCAST_AUTHOR}</itunes:author>
    <itunes:email>${PODCAST_EMAIL}</itunes:email>
    <itunes:explicit>false</itunes:explicit>
    <itunes:category text="Health &amp; Fitness">
      <itunes:category text="Medicine" />
    </itunes:category>
    <itunes:image href="${PODCAST_COVER_URL}" />
    <atom:link href="${SITE_URL}/feed.xml" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>`;
}

const FALLBACK_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>${PODCAST_TITLE}</title>
    <description>${PODCAST_DESCRIPTION}</description>
    <itunes:email>${PODCAST_EMAIL}</itunes:email>
    <itunes:image href="${PODCAST_COVER_URL}" />
  </channel>
</rss>`;

// ── HTTP 伺服器 ────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const pathname = url.parse(req.url).pathname;
  const isHead = req.method === "HEAD";

  try {
    // Health check
    if (pathname === "/health" || pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("OK");
      return;
    }

    // RSS Feed
    if (pathname === "/feed.xml" || pathname === "/rss.xml") {
      const files = await fetchPodcastFiles();
      const xml = files.length > 0 ? buildRSS(files) : FALLBACK_RSS;
      res.writeHead(200, {
        "Content-Type": "application/rss+xml; charset=utf-8",
        "Cache-Control": "no-cache",
      });
      if (isHead) {
        res.end();
      } else {
        res.end(xml);
      }
      return;
    }

    // Audio proxy via Maton API
    const audioMatch = pathname.match(/^\/audio\/([a-zA-Z0-9_-]+)\.mp3$/);
    if (audioMatch) {
      const fileId = audioMatch[1];
      const matonOpts = {
        hostname: "gateway.maton.ai",
        path: `/google-drive/drive/v3/files/${fileId}?alt=media`,
        headers: {
          Authorization: `Bearer ${MATON_API_KEY}`,
          Accept: "audio/mpeg",
          "User-Agent": "MCH-Swallow-Podcast/1.0",
        },
      };
      https.get(matonOpts, (driveRes) => {
        if (driveRes.statusCode === 404) {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("File not found");
          return;
        }
        if (driveRes.statusCode !== 200) {
          res.writeHead(502, { "Content-Type": "text/plain" });
          res.end(`Drive error: ${driveRes.statusCode}`);
          return;
        }
        res.writeHead(200, {
          "Content-Type": "audio/mpeg",
          "Content-Length": driveRes.headers["content-length"],
          "Accept-Ranges": "bytes",
          "Cache-Control": "public, max-age=86400",
        });
        driveRes.pipe(res);
      }).on("error", (err) => {
        console.error(`[AUDIO] Error: ${err.message}`);
        res.writeHead(502);
        res.end("Stream error");
      });
      return;
    }

    // 404
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  } catch (err) {
    console.error("[RSS] Error:", err.message);
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("Server error");
  }
});

server.listen(PORT, () => {
  console.log(`\n  MCH Swallow Podcast`);
  console.log(`  RSS: ${SITE_URL}/feed.xml`);
  console.log(`  MATON: ${MATON_BASE}`);
  if (!MATON_API_KEY) {
    console.log(`  NOTE: MATON_API_KEY not set — audio streaming disabled`);
  }
});