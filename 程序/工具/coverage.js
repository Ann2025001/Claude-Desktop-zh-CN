// 覆盖率检查：在模拟页面里运行完整的外置词典（作者规则 + 补充规则，和真实界面同一份代码），
// 逐条检查 Claude 本地前端代码、网页缓存、动态词表、漏翻收集里的英文界面文字能否被翻译。
// 用法: node coverage.js            → 输出 coverage-todo.json（还翻不了的，不入库）
//       node coverage.js "文字" ...  → 只检查给出的文字
const fs = require("fs"), path = require("path"), zlib = require("zlib"), vm = require("vm");
const R = require("./claude-path");
const OPT = path.resolve(__dirname, "..", "..");
const RUNTIME = path.join(OPT, "runtime", "dom-zh-CN.js");

// 1. 模拟页面：把候选文字做成文字节点，运行外置词典后看节点内容是否变化
function makeTranslator() {
  let nodes = [];
  const mkEl = (txt) => ({ nodeType: 1, tagName: "DIV", textContent: txt, parentElement: null, closest: () => null, querySelector: () => null, matches: () => false, getAttribute: () => null, setAttribute() {} });
  const doc = {
    get body() { return root; }, get documentElement() { return root; },
    createTreeWalker(b, what, filter) { let i = -1; return { nextNode() { while (++i < nodes.length) { if (filter.acceptNode(nodes[i]) === 1) return nodes[i]; } return null; } }; },
    querySelectorAll: () => [], hasFocus: () => true, createElement: () => mkEl(""),
  };
  const root = mkEl("");
  const ctx = { document: doc, NodeFilter: { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2, FILTER_SKIP: 3 }, MutationObserver: class { observe() {} disconnect() {} }, setTimeout: () => 0, clearTimeout() {}, console, Intl, location: { href: "https://claude.ai/new", hostname: "claude.ai", pathname: "/new" }, navigator: { language: "zh-CN" } };
  const mem = new Map();
  ctx.localStorage = ctx.sessionStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  ctx.getComputedStyle = () => ({}); ctx.addEventListener = () => {}; ctx.requestAnimationFrame = () => 0;
  ctx.window = ctx; ctx.globalThis = ctx; ctx.self = ctx;
  vm.createContext(ctx);
  const src = fs.readFileSync(RUNTIME, "utf8");
  // 让脚本把内部的 T 暴露出来，便于多次调用（只在本工具的副本里改，不影响真实词典）
  const exposed = src.replace(/\r?\nT\(\);\r?\n/, "\nwindow.__T=T;T();\n");
  vm.runInContext(exposed.replace(/\}catch\(e\)\{\}\}\)\(\)\s*$/, "}catch(e){window.__E=e}})()"), ctx);
  if (!ctx.__T) throw new Error("没能在模拟页面里加载外置词典：" + (ctx.__E ? ctx.__E.message : "结构可能变了"));
  return (list) => {
    nodes = list.map((s) => { const el = mkEl(s); const n = { nodeType: 3, nodeValue: s, parentElement: el }; return n; });
    ctx.__T();
    return list.map((s, i) => [s, nodes[i].nodeValue]);
  };
}

// 2. 候选文字
const EOF = Buffer.from([0xd8, 0x41, 0x0d, 0x97, 0x45, 0x6f, 0xfa, 0xf4]);
const lit = /(?:children|label|title|description|placeholder|tooltip|subtitle|heading|"aria-label"|ariaLabel|text|message|header|body|cta|ctaText|buttonText|emptyText|helperText|caption|hint|subheading|tagline|summary):"((?:[^"\\]|\\.){3,300})"/g;
const looksUi = (s) => /^[A-Z][a-z]/.test(s) && !/[{}<>=;\\]|https?:|\.(js|ts|tsx|json|png|svg)\b|^[A-Z][a-z]+[A-Z]/.test(s) && (/ /.test(s) || /^[A-Z][a-z]{2,}$/.test(s));
function* walk(d) { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) yield* walk(p); else yield p; } }
function collect() {
  const out = new Map();
  const add = (s, src) => { if (!out.has(s)) out.set(s, src); };
  const fromJs = (t, src) => { for (const m of t.matchAll(lit)) { let s; try { s = JSON.parse('"' + m[1] + '"'); } catch { continue; } if (looksUi(s)) add(s, src); } };
  for (const f of walk(path.join(R, "ion-dist"))) if (/\.js$/.test(f)) fromJs(fs.readFileSync(f, "utf8"), "本地前端");
  const C = path.join(process.env.APPDATA, "Claude", "Cache", "Cache_Data");
  for (const f of fs.readdirSync(C).filter((x) => x.startsWith("f_"))) {
    let b; try { b = fs.readFileSync(path.join(C, f)); } catch { continue; }
    const kl = b.readUInt32LE(12), s0 = 20 + kl, e = b.indexOf(EOF, s0), body = b.slice(s0, e < 0 ? b.length : e);
    for (const d of [(x) => zlib.brotliDecompressSync(x), (x) => zlib.gunzipSync(x), (x) => x]) { let t; try { t = d(body).toString("utf8"); } catch { continue; } if (/function|=>/.test(t)) { fromJs(t, "网页缓存"); break; } }
  }
  for (const f of ["dynamic/en-US.json"]) { try { for (const v of Object.values(JSON.parse(fs.readFileSync(path.join(R, "ion-dist", "i18n", f), "utf8")))) if (typeof v === "string" && !/[{}<]/.test(v)) add(v, "动态词表"); } catch {} }
  try { for (const s of Object.keys(JSON.parse(fs.readFileSync(path.join(OPT, "runtime", "missing-zh-CN.json"), "utf8")))) add(s, "漏翻收集"); } catch {}
  return out;
}

const tr = makeTranslator();
const args = process.argv.slice(2);
if (args.length) { for (const [a, b] of tr(args)) console.log(JSON.stringify(a), "=>", a === b ? "（未翻译）" : b); return; }
const cand = collect();
const list = [...cand.keys()];
const res = tr(list);
const todo = res.filter(([a, b]) => a === b).map(([a]) => [a, "", cand.get(a)]);
const bySrc = {}; for (const [, , s] of todo) bySrc[s] = (bySrc[s] || 0) + 1;
fs.writeFileSync(path.join(__dirname, "coverage-todo.json"), JSON.stringify(todo, null, 1));
console.log(`候选 ${list.length} 条，已能翻译 ${list.length - todo.length} 条，还翻不了 ${todo.length} 条`, bySrc);
