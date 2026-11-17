# page2pdf — 網頁轉 PDF 書籤

把網頁上「一頁一張圖」的內容（線上閱讀器、掃描檔、PDF 網頁預覽）自動抓下來，合成一個 PDF。
純前端書籤：不載入外部程式、不連外網、不上傳任何資料。

**安裝：** 打開 https://dodosomething.github.io/page2pdf/ ，把「📄 轉成 PDF」按鈕拖到書籤列。

## 用法

1. 打開有一頁一頁圖片的網頁
2. 按書籤 → 自動從頂端捲到底，邊捲邊抓頁面（按 Esc 可提早停止）
3. 右上角顯示「找到 N 頁」→ 確認 → 下載 PDF

頁面不能捲動、看起來是翻頁式閱讀器時，會詢問是否自動按 → 翻頁來抓。

## 運作方式

- 抓顯示寬高 ≥150px、原始尺寸 ≥300px 的 `<img>` / `<canvas>`，自動找出真正會捲動的區塊
- 邊捲邊存，閱讀器把看過的頁面移除也不會漏
- canvas 隔 300ms 拍兩次，內容一致（畫完了）才收
- 每頁算內容雜湊：版面位移造成的重複頁只收一次；同位置不同解析度的圖只留大張
- 內建最小 PDF 產生器，每頁一張 JPEG，保留原圖尺寸
- 圖片被跨網域擋住時，可選：用列印視窗「另存為 PDF」（含全部頁），或只輸出抓得到的頁

## 抓不到的情況

- 內容在跨網域 iframe 裡
- 頁面是 CSS 背景圖或純文字（例如 Google 文件編輯畫面，請用「檔案 → 下載 → PDF」）
- 擁有者關閉下載的內容不做繞過

## 開發

| 檔案 | 用途 |
|---|---|
| `pdf-bookmarklet.src.js` | 原始碼（改這個） |
| `build.js` | `node build.js` → 產生 `pdf-bookmarklet.txt` 和 `index.html` |
| `pdf-bookmarklet.txt` | 書籤本體（`javascript:` + 編碼，產出物） |
| `index.html` | 安裝頁 / GitHub Pages 首頁（產出物，別手改） |

改完原始碼記得重跑 `node build.js` 再 commit。

### 參數

執行書籤前設定 `window.__pdfbmOpt` 可覆蓋預設值：

```js
{ minPx: 300, scrollWait: 500, imgWait: 3000, stableWait: 300, flipWait: 800, flipKey: 'ArrowRight', maxFlip: 2000 }
```

### 測試模式

設 `window.__pdfbmTest = true` 再執行 → 不跳確認、不下載，結果放在 `window.__pdfbmResult`、`window.__pdfbmBlob`、`window.__pdfbmList`。
`'print'` 強制走列印；`'pdf'` 有被擋的頁時只輸出抓得到的頁。
