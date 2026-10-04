// 从 Claude 的网页缓存(只读)里提取 claude.ai 网页代码中的界面文字, 找出词库和补充规则都还没覆盖的: node scan-cache.js
// 输出 scan-cache-result.json(不入库)
const fs = require("fs"), path = require("path"), zlib = require("zlib");
const R = require("./claude-path");
const CACHE = path.join(process.env.APPDATA, "Claude", "Cache", "Cache_Data");
const EOF = Buffer.from([0xd8, 0x41, 0x0d, 0x97, 0x45, 0x6f, 0xfa, 0xf4]);

function body(buf) {
  const keyLen = buf.readUInt32LE(12);
  const key = buf.slice(20, 20 + keyLen).toString("utf8");
  const start = 20 + keyLen, end = buf.indexOf(EOF, start);
  return { key, data: buf.slice(start, end < 0 ? buf.length : end) };
}
function decode(d) {
  for (const f of [(x) => zlib.zstdDecompressSync(x), (x) => zlib.brotliDecompressSync(x), (x) => zlib.gunzipSync(x), (x) => zlib.inflateSync(x), (x) => x]) {
    try { const t = f(d).toString("utf8"); if (/defaultMessage|formatMessage|children:/.test(t)) return t; } catch {}
  }
  return null;
}

const en = JSON.parse(fs.readFileSync(R + "ion-dist/i18n/en-US.json", "utf8"));
const ids = new Set(Object.keys(en)), texts = new Set(Object.values(en));
const found = new Map(); // 文本 -> 来源
let files = 0, js = 0;
// Chromium 块文件缓存: 较大的响应体(网页代码)单独存成 f_xxxxxx, 内容是按 content-encoding 压缩的原文
for (const f of fs.readdirSync(CACHE).filter((x) => x.startsWith("f_"))) {
  let buf; try { buf = fs.readFileSync(path.join(CACHE, f)); } catch { continue; }
  files++;
  const t = decode(buf); if (!t) continue; js++;
  // 1) 带 id 的界面文字, 但 id 不在本机词库里(网页比桌面版新)
  for (const m of t.matchAll(/defaultMessage:"((?:[^"\\]|\\.)*)",id:"([^"]+)"/g)) {
    if (!ids.has(m[2])) { try { found.set(JSON.parse('"' + m[1] + '"'), "id:" + m[2]); } catch {} }
  }
  // 2) 直接写在页面上的英文文字
  for (const m of t.matchAll(/(?:children|label|title|description|placeholder|tooltip|subtitle|heading|"aria-label"):"((?:[^"\\]|\\.){3,200})"/g)) {
    let s; try { s = JSON.parse('"' + m[1] + '"'); } catch { continue; }
    if (/^[A-Z][a-z]/.test(s) && / /.test(s) && !/[{}<>=;\\]/.test(s) && !texts.has(s) && !found.has(s)) found.set(s, "literal");
  }
}
const out = [...found].map(([s, src]) => ({ s, src }));
fs.writeFileSync(path.join(__dirname, "scan-cache-result.json"), JSON.stringify(out, null, 1));
console.log(`缓存文件 ${files} 个，其中 claude.ai 网页代码 ${js} 个；候选文字 ${out.length} 条（带新 id 的 ${out.filter((x) => x.src.startsWith("id:")).length} 条）`);
