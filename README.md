# Bilibili 收藏管理 PWA

一個可安裝到手機主畫面的 Bilibili 收藏管理 App，支援標籤分類、搜尋，以及直接從 B 站匯入公開收藏夾。

## 功能

- **收藏庫**：卡片瀑布流瀏覽，封面圖自動載入
- **標籤管理**：自訂標籤、快速篩選
- **搜尋**：依標題、BV號、標籤搜尋
- **匯入 B 站收藏夾**：輸入 UID 查詢公開收藏夾，一鍵匯入全部影片
- **手動新增**：貼上連結或 BV 號新增
- **離線支援**：Service Worker 快取，無網路也可瀏覽
- **PWA 安裝**：可加到 iOS/Android 主畫面

## 快速部署到 GitHub Pages

1. 在 GitHub 建立新 repository（例如 `bilibili-fav`）
2. 上傳此資料夾所有檔案
3. 前往 Settings → Pages → Source 選 `main` 分支
4. 幾分鐘後網址會是：`https://你的帳號.github.io/bilibili-fav/`

## 部署到 Netlify（最快）

1. 把此資料夾拖曳到 [netlify.com/drop](https://app.netlify.com/drop)
2. 立即獲得 HTTPS 網址

## 部署到 Vercel

```bash
npm i -g vercel
cd bilibili-fav
vercel --prod
```

## 安裝到手機主畫面

### iOS（Safari）
1. 用 Safari 開啟網址
2. 點下方分享按鈕 → 「加入主畫面」

### Android（Chrome）
1. 用 Chrome 開啟網址
2. 點右上角選單 → 「安裝應用程式」或「加到主畫面」

## 關於 B 站收藏夾匯入

- 使用 `allorigins.win` 公開 CORS 代理轉發請求
- 僅支援**公開收藏夾**（私人需要 SESSDATA）
- 分頁讀取，每頁間隔 350ms 避免被限速

## 檔案結構

```
bilibili-fav/
├── index.html     主頁面
├── style.css      樣式（Mobile-first，支援深色模式）
├── app.js         邏輯（B站API、本地儲存、UI）
├── sw.js          Service Worker（離線快取）
├── manifest.json  PWA manifest
└── icons/
    ├── icon-192.png
    └── icon-512.png
```
