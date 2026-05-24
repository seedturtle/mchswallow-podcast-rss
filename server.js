/**
 * MCH Swallow 吞嚥 Podcast RSS Feed 伺服器（Google API 直接版）
 * 使用 Google Drive API v3 直接串流音訊，繞過下載限制
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');

// ── 環境變數 ───────────────────────────────
const PORT = parseInt(process.env.PORT || '3000');
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || 'YOUR_GOOGLE_API_KEY';
const PODCAST_FOLDER_ID = process.env.PODCAST_FOLDER_ID || 'YOUR_FOLDER_ID';

// ── Google API 端點 ───────────────────────────
const GDRIVE_BASE = 'www.googleapis.com';
const GDRIVE_LIST_URL = `/drive/v3/files?q='${PODCAST_FOLDER_ID}'+in+parents+and+mimeType='audio/mpeg'+and+trashed=false&fields=files(id,name,mimeType,size,createdTime,modifiedTime)&orderBy=createdTime desc`;
const GDRIVE_DOWNLOAD_BASE = 'drive/v3/files';

// ── Podcast 基本資訊 ─────────────────────────
const PODCAST_TITLE = process.env.PODCAST_TITLE || 'MCH Swallow 吞嚥 Podcast';
const PODCAST_DESCRIPTION = process.env.PODCAST_DESCRIPTION || '由 MCH 吞嚥團隊分享吞嚥復健與肌能訓練的最新知識與臨床經驗，陪伴每一位在偏鄉努力守護病人吞嚥功能的醫療人員。';
const SITE_URL = process.env.SITE_URL || 'https://mchswallowpodcast.zeabur.app';
const PODCAST_COVER_URL = process.env.PODCAST_COVER_URL || `${SITE_URL}/cover.png`;
const PODCAST_EMAIL = process.env.PODCAST_EMAIL || 'mchswallow@gmail.com';

// ── 輔助函數：建立 Google API 請求 ────────────
function gdriveRequest(path, method = 'GET', postData = null) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(`https://${GDRIVE_BASE}${path}`);
    const options = {
      hostname: GDRIVE_BASE,
      path: urlObj.pathname + urlObj.search,
      method,
      headers: {
        'Authorization': `Bearer ${GOOGLE_API_KEY}`,
        'Accept': 'application/json',
      },
    };
    if (postData) {
      options.headers['Content-Type'] = 'application/json';
    }
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, data: data }); }
      });
    });
    req.on('error', reject);
    if (postData) req.write(JSON.stringify(postData));
    req.end();
  });
}

// ── 輔助函數：串流 Google Drive 檔案 ──────────
function streamGdriveFile(fileId, res) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: GDRIVE_BASE,
      path: `/${GDRIVE_DOWNLOAD_BASE}/${fileId}?alt=media`,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${GOOGLE_API_KEY}` },
    };
    const req = https.request(options, (driveRes) => {
      if (driveRes.statusCode >= 300 && driveRes.statusCode < 400 && driveRes.headers.location) {
        const redirectUrl = new URL(driveRes.headers.location);
        const redirectReq = http.request({
          hostname: redirectUrl.hostname,
          path: redirectUrl.pathname + redirectUrl.search,
          method: 'GET',
        }, (r) => {
          res.writeHead(r.statusCode, r.headers);
          r.pipe(res, { end: true });
          r.on('end', resolve);
        });
        redirectReq.on('error', reject);
        redirectReq.end();
        return;
      }
      res.writeHead(driveRes.statusCode, {
        'Content-Type': driveRes.headers['content-type'] || 'audio/mpeg',
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=3600',
      });
      driveRes.pipe(res, { end: true });
      driveRes.on('end', resolve);
    });
    req.on('error', (e) => {
      if (!res.headersSent) { res.writeHead(502); res.end('Proxy error'); }
      resolve();
    });
    req.end();
  });
}

// ── 抓取 Google Drive 檔案列表 ────────────────
async function fetchFiles() {
  const result = await gdriveRequest(GDRIVE_LIST_URL);
  if (result.status !== 200 || !result.data.files) {
    console.error('[RSS] Failed to fetch files:', result.status, JSON.stringify(result.data).slice(0, 200));
    return [];
  }
  return result.data.files;
}

// ── 建構 RSS XML ─────────────────────────────
function buildRSS(files) {
  const items = files.map((f) => {
    const pubDate = new Date(f.createdTime).toUTCString();
    return `
    <item>
      <title>${f.name.replace('.mp3','').replace(/[<>]/g,'')}</title>
      <description>${PODCAST_DESCRIPTION}</description>
      <pubDate>${pubDate}</pubDate>
      <enclosure url="${SITE_URL}/audio/${f.id}" type="audio/mpeg" length="${f.size || 0}" />
      <guid isPermaLink="false">${f.id}</guid>
      <itunes:duration>${Math.round((f.size || 5000000) / 16000)}</itunes:duration>
      <itunes:explicit>false</itunes:explicit>
    </item>`;
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"
  xmlns:atom="http://www.w3.org/2005/Atom"
  xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>${PODCAST_TITLE}</title>
    <description>${PODCAST_DESCRIPTION}</description>
    <itunes:image href="${PODCAST_COVER_URL}" />
    <itunes:author>MCH Swallow 吞嚥團隊</itunes:author>
    <itunes:owner>
      <itunes:name>MCH Swallow 吞嚥團隊</itunes:name>
      <itunes:email>${PODCAST_EMAIL}</itunes:email>
    </itunes:owner>
    <language>zh-TW</language>
    <link>${SITE_URL}</link>
    <atom:link href="${SITE_URL}/feed.xml" rel="self" type="application/rss+xml" />
    <itunes:category text="Health &amp; Fitness" />
    <itunes:explicit>false</itunes:explicit>
    ${items}
  </channel>
</rss>`;
}

// ── HTTP 伺服器 ──────────────────────────────
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Range',
      'Access-Control-Max-Age': '86400',
    });
    res.end();
    return;
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');

  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', time: new Date().toISOString() }));
    return;
  }

  if (url.pathname === '/feed.xml' || url.pathname === '/') {
    try {
      console.log('[RSS] Fetching files from Google Drive...');
      const files = await fetchFiles();
      console.log(`[RSS] Found ${files.length} files`);
      if (files.length > 0) console.log(`[RSS] Latest: ${files[0].name}`);
      const xml = buildRSS(files);
      res.writeHead(200, { 'Content-Type': 'application/rss+xml; charset=utf-8', 'Cache-Control': 'public, max-age=300' });
      res.end(xml);
    } catch (err) {
      console.error('[RSS] Error:', err.message);
      res.writeHead(500);
      res.end('RSS Error');
    }
    return;
  }

  const audioMatch = req.url.match(/\/audio\/([a-zA-Z0-9_-]+)/);
  if (audioMatch) {
    try {
      await streamGdriveFile(audioMatch[1], res);
    } catch (err) {
      console.error(`[AUDIO] Error: ${err.message}`);
      if (!res.headersSent) { res.writeHead(502); res.end('Audio proxy error'); }
    }
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`🎙  MCH Swallow RSS Server started`);
  console.log(`   PORT: ${PORT} | GOOGLE_API_KEY: ${GOOGLE_API_KEY.slice(0,10)}...`);
  console.log(`   SITE_URL: ${SITE_URL}`);
  if (GOOGLE_API_KEY === 'YOUR_GOOGLE_API_KEY') console.log('\n⚠️  請在 Zeabur 設定 GOOGLE_API_KEY！\n');
});
