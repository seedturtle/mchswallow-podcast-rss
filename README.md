# 🎙 MCH Swallow 吞嚥 Podcast RSS Server

自動從 Google Drive 生成 Podcast RSS Feed，部署到 Zeabur。

## 目錄結構

```
├── server.js       # RSS 伺服器主程式
├── package.json    # Node.js 專案設定
├── zeabur.json     # Zeabur 部署設定
└── README.md       # 本文件
```

## 運作原理

1. 音檔上傳到 Google Drive 指定資料夾
2. 透過 **Maton Gateway** 串接 Google Drive API，讀取檔案清單
3. 自動生成標準 Podcast RSS XML
4. 音檔播放時 302 轉址到 Google Drive 直接下載（無需 CDN）

## 前置準備

### 1. Maton Gateway 設定

> Maton Gateway 是用來存取 Google Drive API 的橋樑服務。

在 [Maton](https://maton.ai) 註冊並建立 connection 連到你的 Google Drive，取得：

- `MATON_API_KEY` — API 金鑰
- `MATON_CONN` — Connection ID

### 2. Google Drive 資料夾

建立一個 Google Drive 資料夾，裡面放你的 MP3 音檔，取得資料夾 ID（網址列中的那串亂碼）。

> 音檔檔名建議格式：`標題_YYYYMMDD.mp3`，伺服器會自動解析日期作為集數標題。

### 3. 封面圖片（選填）

將 Podcast 封面圖片上傳到公開可存取的位置，並記下網址。

## Zeabur 部署

### 一鍵部署

[![Deploy on Zeabur](https://zeabur.com/button.svg)](https://zeabur.com/templates/...)

### 手動部署

1. Fork 或 clone 此專案到你的 GitHub
2. 登入 [Zeabur](https://zeabur.com)
3. 點擊 **New Project** → **Deploy from GitHub**
4. 選擇此倉儲
5. 在 Zeabur 後台設定以下 **Environment Variables**：

| 變數 | 必填 | 說明 |
|------|------|------|
| `PODCAST_FOLDER_ID` | ✅ | Google Drive 資料夾 ID |
| `MATON_API_KEY` | ✅ | Maton Gateway API Key |
| `MATON_CONN` | ✅ | Maton Connection ID |
| `SITE_URL` | ✅ | 你的 Zeabur 網址（如 `https://xxx.zeabur.app`） |
| `PODCAST_TITLE` | | Podcast 標題（預設：MCH Swallow 吞嚥 Podcast） |
| `PODCAST_DESCRIPTION` | | Podcast 描述 |
| `PODCAST_AUTHOR` | | 作者名稱（預設：MCH 吞嚥團隊） |
| `PODCAST_COVER_URL` | | 封面圖片公開網址 |
| `PODCAST_EMAIL` | | 聯絡 Email（預設：podcast@example.com） |
| `PODCAST_LANGUAGE` | | 語言代碼（預設：zh-tw） |
| `PODCAST_CATEGORY` | | iTunes 分類（預設：Health） |
| `PODCAST_SUBCATEGORY` | | iTunes 子分類（預設：Medical） |

6. 部署完成後，你的 RSS Feed 網址為：`https://你的專案.zeabur.app/feed.xml`

## 本地測試

```bash
# 設定環境變數
export PODCAST_FOLDER_ID=your_folder_id
export MATON_API_KEY=your_api_key
export MATON_CONN=your_conn_id
export SITE_URL=http://localhost:3000

# 啟動伺服器
npm start
```

開啟瀏覽器前往 `http://localhost:3000/feed.xml` 即可看到 RSS。

## 在 Apple Podcasts / Spotify 上架

1. 取得 RSS Feed 網址：`https://你的專案.zeabur.app/feed.xml`
2. 用 [Podcast Connect](https://podcastsconnect.apple.com) 或 [Spotify for Podcasters](https://podcasters.spotify.com/) 提交此 RSS
3. 審核通過後即可在各大平台收聽

## 授權

MIT
