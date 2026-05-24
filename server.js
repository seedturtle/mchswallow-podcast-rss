/**
 * MCH Swallow 吞嚥 Podcast RSS Feed Server
 * 使用 Google Drive + Maton API 自動生成 Podcast RSS
 * 佈署到 Zeabur
 */

const http = require("http");
const https = require("https");

const PORT = process.env.PORT || 3000;

// ── Google Drive 設定 ──────────────────────────────────
// 請在 Zeabur 後台設定以下環境變數：
const PODCAST_FOLDER_ID =
  process.env.PODCAST_FOLDER_ID || "1Yiwx-jIqmw37TvbMl5dDbVPcgetEPzIW";
const MATON_API_KEY =
  process.env.MATON_API_KEY || "";
const MATON_CONN =
  process.env.MATON_CONN || "";
const MATON_BASE = "https://gateway.maton.ai";

const SITE_URL =
  process.env.SITE_URL || "https://mchswallowpodcast.zeabur.app";

// ── Podcast 設定（可透過環境變數覆蓋）────────────────────
const PODCAST_TITLE =
  process.env.PODCAST_TITLE || "MCH Swallow 吞嚥 Podcast";
const PODCAST_DESCRIPTION =
  process.env.PODCAST_DESCRIPTION ||
  "MCH Swallow 吞嚥 Podcast — 吞嚥復健、肌能訓練與臨床新知，陪伴吞嚥治療師與個案一起進步。";
const PODCAST_AUTHOR = process.env.PODCAST_AUTHOR || "MCH 吞嚥團隊";
const PODCAST_LANGUAGE = process.env.PODCAST_LANGUAGE || "zh-tw";
const PODCAST_COVER_URL =
  process.env.PODCAST_COVER_URL || "https://seedturtle.zo.space/images/mch-podcast-cover.png";
const PODCAST_CATEGORY = process.env.PODCAST_CATEGORY || "Health";
const PODCAST_SUBCATEGORY = process.env.PODCAST_SUBCATEGORY || "Medical";

const FALLBACK_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>${PODCAST_TITLE}</title>
    <description>Podcast 正在恢復中...</description>
    <language>${PODCAST_LANGUAGE}</language>
    <itunes:explicit>false</itunes:explicit>
  </channel>
</rss>`;

// ── Helper: HTTPS GET ─────────────────────────────────
function httpsGet(hostname, pathname, search) {
  return new Promise((resolve, reject) => {
    const fullUrl = new URL(`https://${hostname}${pathname}${search}`);
    const options = {
      hostname: fullUrl.hostname,
      path: fullUrl.pathname + fullUrl.search,
      method: "GET",
      headers: {
        Authorization: `Bearer ${MATON_API_KEY}`,
        "Maton-Connection": MATON_CONN,
        "Content-Type": "application/json",
      },
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new Error("JSON parse error: " + data.slice(0, 80)));
        }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

// ── 從 Google Drive 取得音檔清單 ─────────────────────
async function getPodcastFiles() {
  const fullUrl = new URL(MATON_BASE + "/google-drive/drive/v3/files");
  fullUrl.searchParams.set(
    "fields",
    "files(id,name,mimeType,createdTime,size,description)"
  );
  fullUrl.searchParams.set(
    "q",
    `mimeType='audio/mpeg' and '${PODCAST_FOLDER_ID}' in parents and trashed=false`
  );
  fullUrl.searchParams.set("orderBy", "createdTime asc");
  fullUrl.searchParams.set("pageSize", 50);

  const parsed = new URL(fullUrl.toString());
  const result = await httpsGet(parsed.hostname, parsed.pathname, parsed.search);
  const files = result.files || [];
  console.log(`[RSS] Fetched ${files.length} files from Google Drive`);
  // 反轉：最新集數在最上面
  return files.reverse();
}

// ── 從檔名解析 metadata ──────────────────────────────
function parseEpisodeMetadata(file, index, totalFiles) {
  const episodeNum = totalFiles - index;
  // 支援多種檔名格式：YYYYMMDD、EP編號等
  const dateMatch = file.name.match(/(\d{4})[_-]?(\d{2})[_-]?(\d{2})/);
  const epMatch = file.name.match(/[Ee][Pp]\s*(\d+)/);

  let title;
  if (dateMatch) {
    const [, y, m, d] = dateMatch;
    title = `第${episodeNum}集｜${y}/${m}/${d}`;
  } else if (epMatch) {
    title = `第${epMatch[1]}集`;
  } else {
    // 用檔名去掉副檔名當標題
    title = file.name.replace(/\.mp3$/i, "");
  }

  // 從 description 欄位或檔名讀取簡介
  const description =
    file.description || `${PODCAST_TITLE}，${title}`;

  const pubDate = file.createdTime
    ? new Date(file.createdTime).toUTCString()
    : new Date().toUTCString();
  const size = parseInt(file.size || 0);
  const audioUrl = `${SITE_URL}/audio/${file.id}.mp3`;
  const duration = Math.floor(size / 16000); // 粗略估算

  return { title, description, pubDate, size, audioUrl, duration, episodeNum };
}

// ── 建構 RSS XML ─────────────────────────────────────
function buildRss(files) {
  const now = new Date().toUTCString();
  const coverUrl = PODCAST_COVER_URL;

  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"
  xmlns:atom="http://www.w3.org/2005/Atom"
  xmlns:googleplay="http://www.google.com/schemas/play-podcasts/1.0">
  <channel>
    <title>${PODCAST_TITLE}</title>
    <link>${SITE_URL}/</link>
    <description><![CDATA[${PODCAST_DESCRIPTION}]]></description>
    <language>${PODCAST_LANGUAGE}</language>
    <copyright>Copyright ${new Date().getFullYear()} ${PODCAST_AUTHOR}</copyright>
    <lastBuildDate>${now}</lastBuildDate>
    <ttl>60</ttl>
    <atom:link href="${SITE_URL}/feed.xml" rel="self" type="application/rss+xml"/>`;

  if (coverUrl) {
    xml += `
    <image>
      <url>${coverUrl}</url>
      <title>${PODCAST_TITLE}</title>
      <link>${SITE_URL}/</link>
    </image>
    <itunes:image href="${coverUrl}"/>`;
  }

  xml += `
    <itunes:author>${PODCAST_AUTHOR}</itunes:author>
    <itunes:subtitle>${PODCAST_TITLE}</itunes:subtitle>
    <itunes:summary><![CDATA[${PODCAST_DESCRIPTION}]]></itunes:summary>
    <itunes:explicit>false</itunes:explicit>
    <itunes:category text="${PODCAST_CATEGORY}">
      <itunes:category text="${PODCAST_SUBCATEGORY}"/>
    </itunes:category>
    <itunes:owner>
      <itunes:name>${PODCAST_AUTHOR}</itunes:name>
      <itunes:email>${process.env.PODCAST_EMAIL || "mchswallow@gmail.com"}</itunes:email>
    </itunes:owner>`;

  files.forEach((file, index) => {
    const totalFiles = files.length;
    const meta = parseEpisodeMetadata(file, index, totalFiles);
    xml += `
    <item>
      <title><![CDATA[${meta.title}]]></title>
      <link>${SITE_URL}/</link>
      <description><![CDATA[${meta.description}]]></description>
      <itunes:summary><![CDATA[${meta.description}]]></itunes:summary>
      <pubDate>${meta.pubDate}</pubDate>
      <enclosure url="${meta.audioUrl}" type="audio/mpeg" length="${meta.size}"/>
      <guid isPermaLink="false">mchswallow_ep${meta.episodeNum}_${file.id}</guid>
      <itunes:title>${meta.title}</itunes:title>
      <itunes:episode>${meta.episodeNum}</itunes:episode>
      <itunes:duration>${meta.duration}</itunes:duration>
      <itunes:explicit>false</itunes:explicit>
    </item>`;
  });

  xml += `
  </channel>
</rss>`;
  return xml;
}

// ── HTTP 伺服器 ──────────────────────────────────────
const server = http.createServer(async (req, res) => {
  // CORS headers（讓任何 Podcast app 都能存取）
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");

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

  // RSS Feed
  if (req.url === "/feed.xml" || req.url === "/") {
    try {
      const files = await getPodcastFiles();
      console.log(`[RSS] Building feed with ${files.length} episodes`);
      if (files.length > 0) {
        console.log(`[RSS] Latest: ${files[0].name}`);
        console.log(`[RSS] Oldest: ${files[files.length - 1].name}`);
      }
      const xml = buildRss(files);
      res.writeHead(200, {
        "Content-Type": "application/rss+xml; charset=utf-8",
        "Cache-Control": "public, max-age=300",
      });
      res.end(xml);
    } catch (err) {
      console.error("[RSS] Error:", err.message);
      res.writeHead(200, { "Content-Type": "application/rss+xml; charset=utf-8" });
      res.end(FALLBACK_RSS);
    }
    return;
  }

  // 音頻代理：302 轉址到 Google Drive 直接下載
  const audioMatch = req.url.match(/^\/audio\/([a-zA-Z0-9_-]+)\.mp3$/);
  if (audioMatch) {
    const fileId = audioMatch[1];
    const driveUrl = `https://drive.google.com/uc?export=download&id=${fileId}&format=mp3`;
    console.log(`[AUDIO] Redirecting ${fileId} to Google Drive`);
    res.writeHead(302, {
      Location: driveUrl,
      "Cache-Control": "public, max-age=86400",
    });
    res.end();
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
  console.log(`   PODCAST_FOLDER_ID    — Google Drive 資料夾 ID`);
  console.log(`   MATON_API_KEY       — Maton Gateway API Key`);
  console.log(`   MATON_CONN          — Maton Connection ID`);
  console.log(`   SITE_URL            — 你的 Zeabur 網址（如 https://xxx.zeabur.app）`);
  console.log(`   PODCAST_TITLE       — [選填] Podcast 標題`);
  console.log(`   PODCAST_DESCRIPTION — [選填] Podcast 描述`);
  console.log(`   PODCAST_AUTHOR      — [選填] 作者名稱`);
  console.log(`   PODCAST_COVER_URL   — [選填] 封面圖片網址`);
});
