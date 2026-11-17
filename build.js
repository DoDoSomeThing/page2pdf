// 用法：node build.js
//   pdf-bookmarklet.src.js（原始碼，改這個）
//     → pdf-bookmarklet.txt（javascript: + encodeURIComponent 的書籤）
//     → index.html（GitHub Pages 首頁，把裡面的按鈕拖到書籤列）
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const dir = __dirname;
const src = readFileSync(join(dir, 'pdf-bookmarklet.src.js'), 'utf8')
  .split('\n')
  .map(l => l.trim())
  .filter(l => l && !l.startsWith('//'))
  .join('\n');
const href = 'javascript:' + encodeURIComponent(src);
writeFileSync(join(dir, 'pdf-bookmarklet.txt'), href);

const attr = href.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const html = `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>網頁轉 PDF 書籤</title>
<style>
  body{font:16px/1.7 system-ui,-apple-system,"Noto Sans TC",sans-serif;max-width:640px;margin:40px auto;padding:0 16px;color:#222;background:#fff}
  a.bm{display:inline-block;padding:10px 18px;background:#1a56db;color:#fff;border-radius:8px;text-decoration:none;font-weight:600}
  code{background:#f2f2f2;padding:1px 5px;border-radius:4px}
  li{margin:4px 0}
</style>
</head>
<body>
<h1>網頁轉 PDF 書籤</h1>
<p>把這顆按鈕<b>拖到書籤列</b>：</p>
<p><a class="bm" href="${attr}">📄 轉成 PDF</a></p>
<h2>用法</h2>
<ol>
  <li>打開有一頁一頁圖片的網頁（閱讀器、簡報、掃描檔…）</li>
  <li>按書籤 → 自動從頂端捲到底，邊捲邊抓頁面（按 Esc 可提早停止）</li>
  <li>右上角顯示「找到 N 頁」→ 確認 → 下載 PDF</li>
</ol>
<h2>偵測規則</h2>
<ul>
  <li>抓頁面上顯示寬高 ≥150px、原始尺寸 ≥300px 的 <code>&lt;img&gt;</code> 和 <code>&lt;canvas&gt;</code></li>
  <li>自動找出真正會捲動的區塊（整頁或閱讀器內框）</li>
  <li>捲動時就先存下每頁，閱讀器把看過的頁面移除也沒關係</li>
  <li>canvas 等畫完才收；內容相同的頁面只收一次</li>
  <li>頁面不能捲時，會問要不要自動按 → 翻頁</li>
  <li>PDF 由書籤內建程式產生，不載入任何外部程式、不連外網</li>
  <li>圖片跨網域抓不到時，可選列印視窗「另存為 PDF」或只輸出抓得到的頁面</li>
</ul>
<h2>注意</h2>
<ul>
  <li>書籤裝好後不會自動更新，改版要回這頁重新拖一次</li>
  <li>程式全部在你的瀏覽器裡執行，不連任何外部網址、不上傳資料</li>
  <li>原始碼：<a href="https://github.com/DoDoSomeThing/page2pdf">github.com/DoDoSomeThing/page2pdf</a></li>
</ul>
<h2>抓不到的情況</h2>
<ul>
  <li>內容在跨網域 iframe 裡</li>
  <li>頁面是 CSS 背景圖或純文字</li>
</ul>
</body>
</html>
`;
writeFileSync(join(dir, 'index.html'), html);
console.log(`pdf-bookmarklet.txt、index.html 已產生；書籤長度 ${href.length} 字元`);
