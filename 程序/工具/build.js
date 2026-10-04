// Claude Desktop 汉化补全工具
// 用法:
//   node build.js status          查看覆盖率
//   node build.js todo [n]        导出未翻译条目到 todo/ (每批 n 条, 默认 400)
//   node build.js build           合并并校验, 输出到 out/
//   node build.js install         build 后写入 Claude 安装目录 (先备份)
// 翻译来源优先级: supplement/ 中的人工补译 > 上游汉化包(最新) > 本地汉化包 > 已安装文件 > 官方 zh-Hans(仅外层窗口)
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const HERE = __dirname;
// 早期参考过的旧版汉化包词库(本机有就用, 没有就跳过)
const PACK = path.join(process.env.USERPROFILE || "", ".gemini/antigravity/scratch/claude-desktop-zh-cn/resources");
const UP = path.join(HERE, "upstream");
const SUPP = path.join(HERE, "supplement");
const OUT = path.join(HERE, "out");
const TODO = path.join(HERE, "todo");
// 自己维护的“优化版”汉化包(外置词典, 重启即生效); 作者原版仍在 claude-desktop-zh-cn-1.4.10
// 本工具位于 <优化版>/程序/工具, 其余路径都按它推算, 放到哪台电脑都能用
const OPT_DIR = path.resolve(HERE, "..", "..");
const DEFAULT_PACK = path.join(OPT_DIR, "程序", "汉化包", "resources");
// 外置词典固定在优化版顶层 runtime, 已安装的 Claude 从这里读取
const RUNTIME_DIR = path.resolve(OPT_DIR, "runtime");
// 作者译文来源: 补充模式下是从 Claude 里读出的已装译文(环境变量指定), 否则是汉化包里保存的作者原版
let PACK_ORIG = process.env.CLAUDE_ZH_AUTHOR_DIR || path.resolve(process.argv[3] || DEFAULT_PACK, "..", "作者原版");

function findResources() {
  const loc = execSync('powershell -NoProfile -Command "(Get-AppxPackage -Name Claude | Select -First 1).InstallLocation"').toString().trim();
  if (!loc) throw new Error("找不到 Claude 安装目录");
  return path.join(loc, "app", "resources");
}
const R = findResources();
const load = (f) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : {});
const loadDir = (d) => {
  const m = {};
  if (fs.existsSync(d)) for (const f of fs.readdirSync(d).sort()) if (f.endsWith(".json")) Object.assign(m, load(path.join(d, f)));
  return m;
};

// 用 ICU 解析器提取参数名和 <tag> 标签, 译文必须与英文一致; 语法错误直接判为无效
function parseIcu(s) {
  const args = new Set(), tags = new Set();
  let i = 0;
  const ws = () => { while (/\s/.test(s[i])) i++; };
  const word = () => { ws(); const b = i; while (i < s.length && !/[\s,{}]/.test(s[i])) i++; return s.slice(b, i); };
  function text(nested) {
    while (i < s.length) {
      const c = s[i];
      if (c === "'" && s[i + 1] === "'") { i += 2; continue; }
      if (c === "'" && (s[i + 1] === "{" || s[i + 1] === "}")) { const e = s.indexOf("'", i + 1); if (e < 0) throw 0; i = e + 1; continue; }
      if (c === "{") { i++; arg(); continue; }
      if (c === "}") { if (!nested) throw 0; return; }
      if (c === "<") { const m = /^<\/?([A-Za-z0-9_]+)\s*\/?>/.exec(s.slice(i)); if (m) { tags.add(m[0].replace(/\s/g, "")); i += m[0].length; continue; } }
      i++;
    }
    if (nested) throw 0;
  }
  function arg() {
    const name = word(); if (!name) throw 0; args.add(name); ws();
    if (s[i] === "}") { i++; return; }
    if (s[i] !== ",") throw 0; i++;
    const type = word(); ws();
    if (s[i] === "}") { i++; return; }
    if (s[i] !== ",") throw 0; i++;
    if (/^(plural|select|selectordinal)$/.test(type)) {
      for (;;) {
        ws(); if (s[i] === "}") { i++; return; }
        const sel = word(); if (!sel) throw 0;
        if (sel.startsWith("offset:")) continue;
        ws(); if (s[i] !== "{") throw 0; i++;
        text(true); i++;
      }
    } else { let d = 1; while (i < s.length && d) { if (s[i] === "{") d++; if (s[i] === "}") d--; i++; } if (d) throw 0; }
  }
  text(false);
  return [...args].sort().join("|") + "#" + [...tags].sort().join("|");
}
function sig(s) { try { return parseIcu(s); } catch { return null; } }
const valid = (en, zh) => {
  if (typeof zh !== "string" || !zh.length) return false;
  const a = sig(en), b = sig(zh);
  return a === null ? true : a === b; // 英文本身不是合法 ICU 时不做强校验
};

// 术语统一: 对所有译文(汉化包原有 + 补译)生效. 只替换占位符和标签之外的文字.
// Claude / Claude Code / GitHub / MCP / 套餐名等专有名词保留英文.
const TERMS = [
  [/\bArtifacts?\b/g, "作品"],
  [/\bCowork\b/g, "协作"],
  [/\bSkills?\b/g, "技能"],
  [/\bHooks?\b/g, "钩子"],
  [/挂钩/g, "钩子"],
];
const CJK = /[　-〿一-鿿＀-￯“”‘’]/;
function normalize(s) {
  // 按 {…} 和 <…> 切分, 只处理纯文本片段 (ICU 分支内的文本也是纯文本片段)
  return s.split(/(\{\s*[A-Za-z0-9_]+\s*[,}]|<[^<>]*>)/).map((part, idx) => {
    if (idx % 2 === 1) return part;
    for (const [re, zh] of TERMS) {
      part = part.replace(new RegExp(` ?${re.source} ?`, "g"), (m, off, str) => {
        const before = off > 0 ? str[off - 1] : "", after = str[off + m.length] || "";
        const lead = m.startsWith(" ") && before && !CJK.test(before) ? " " : "";
        const trail = m.endsWith(" ") && after && !CJK.test(after) ? " " : "";
        return lead + zh + trail;
      });
    }
    return part;
  }).join("");
}

// 保留英文的条目: 纯品牌名/代码/无字母
const KEEP_EN = /^[\s\d\W]*$|^(Claude( Code| Desktop| for Chrome)?|Cowork|Artifacts?|Skills?|MCP|API|GitHub|Google( Drive| Play| Docs)?|Slack|Gmail|Notion|Linear|Jira|Asana|Figma|Opus|Sonnet|Haiku|Fable|Anthropic|macOS|Windows|Linux|iOS|Android|OK|URL|JSON|CSV|PDF|SSO|SAML|SCIM|AWS|GCP|Azure)$/;

// 安装后 resources/en-US.json 会被中文覆盖(见 pack), 这里保留一份真正的英文快照供本工具使用;
// Claude 更新后文件变回英文, 快照随之刷新
function desktopEn() {
  const live = load(path.join(R, "en-US.json"));
  const snap = path.join(HERE, "pack-original", "desktop-en-US.json");
  const vals = Object.values(live);
  const cjk = vals.filter((v) => /[一-鿿]/.test(v)).length;
  if (vals.length && cjk < vals.length * 0.05) {
    fs.mkdirSync(path.dirname(snap), { recursive: true });
    fs.writeFileSync(snap, JSON.stringify(live, null, 2));
    return live;
  }
  return load(snap);
}

const TARGETS = {
  frontend: {
    en: () => load(path.join(R, "ion-dist/i18n/en-US.json")),
    // 优先级: 修正清单 > 作者当前版本 > 自己的补译(只填作者没翻的) > 其他历史来源
    sources: () => [
      load(path.join(SUPP, "fixes", "frontend.json")),
      load(path.join(PACK_ORIG, "frontend-zh-CN.json")),
      loadDir(path.join(SUPP, "frontend")),
      load(path.join(UP, "frontend-zh-CN.json")),
      load(path.join(PACK, "frontend-zh-CN.json")),
      load(path.join(OUT, "..", "baseline", "frontend-installed.json")),
    ],
    dest: () => path.join(R, "ion-dist/i18n/zh-CN.json"),
  },
  desktop: {
    en: () => desktopEn(),
    sources: () => [
      load(path.join(SUPP, "fixes", "desktop.json")),
      load(path.join(PACK_ORIG, "desktop-zh-CN.json")),
      loadDir(path.join(SUPP, "desktop")),
      load(path.join(UP, "desktop-zh-CN.json")),
      load(path.join(PACK, "desktop-zh-CN.json")),
      load(path.join(OUT, "..", "baseline", "desktop-installed.json")),
      load(path.join(R, "zh-Hans.json")),
    ],
    dest: () => path.join(R, "zh-CN.json"),
  },
};

function merge(name) {
  const t = TARGETS[name];
  const E = t.en();
  const srcs = t.sources();
  const out = {}, missing = {};
  let bad = 0;
  for (const k of Object.keys(E)) {
    const en = E[k];
    let v = srcs[0][k] === en ? en : undefined; // 修正清单里明确写成英文原文 = 决定保留英文(如套餐名), 优先于作者译文
    for (const s of v === undefined ? srcs : []) {
      if (k in s && s[k] !== en) {
        const n = normalize(s[k]);
        if (valid(en, n)) { v = n; break; }
        bad++;
      }
    }
    if (v === undefined && srcs[2][k] === en) v = en; // 作者没翻、自己的补译里确认保留英文(专有名词等)
    if (v === undefined && KEEP_EN.test(en.trim())) v = normalize(en);
    if (v === undefined) missing[k] = en;
    else out[k] = v;
  }
  return { E, out, missing, bad };
}

// 带变量的句子(如 "Resets at {time}")在线页面上无法按整句匹配, 这里把它们转成正则规则:
// [正则, 中文模板($1..$9), 索引词, 字面字母数]. plural/select 展开成各分支, 最多 16 种组合.
function renderIcu(s, plan, seen, outer) {
  let i = 0;
  const word = () => { while (/\s/.test(s[i])) i++; const b = i; while (i < s.length && !/[\s,{}]/.test(s[i])) i++; return s.slice(b, i); };
  const skipWs = () => { while (/\s/.test(s[i])) i++; };
  function text(plural, nested) {
    let o = "";
    while (i < s.length) {
      const c = s[i];
      if (c === "'" && (s[i + 1] === "{" || s[i + 1] === "}" || s[i + 1] === "'")) throw 0;
      if (c === "}") { if (!nested) throw 0; return o; }
      if (c === "#" && plural) { o += "{#" + plural + "}"; i++; continue; }
      if (c === "{") { i++; o += arg(plural); continue; }
      o += c; i++;
    }
    if (nested) throw 0;
    return o;
  }
  function arg(plural) {
    const name = word(); skipWs();
    if (s[i] === "}") { i++; return "{" + name + "}"; }
    if (s[i] !== ",") throw 0; i++;
    const type = word(); skipWs();
    if (!/^(plural|select|selectordinal)$/.test(type)) {
      let d = 1; while (i < s.length && d) { if (s[i] === "{") d++; if (s[i] === "}") d--; i++; }
      if (d) throw 0;
      return type === "number" ? "{#" + name + "}" : "{" + name + "}";
    }
    if (s[i] !== ",") throw 0; i++;
    const br = {};
    for (;;) {
      skipWs(); if (s[i] === "}") { i++; break; }
      const key = word(); if (!key) throw 0;
      if (key.startsWith("offset:")) continue;
      skipWs(); if (s[i] !== "{") throw 0; i++;
      const b = i; let d = 1; while (i < s.length && d) { if (s[i] === "{") d++; if (s[i] === "}") d--; i++; }
      if (d) throw 0;
      br[key] = s.slice(b, i - 1);
    }
    const keys = Object.keys(br);
    if (!seen[name]) seen[name] = keys;
    const pick = plan[name] in br ? plan[name] : "other" in br ? "other" : keys[0];
    return renderIcu(br[pick], plan, seen, type === "select" ? plural : name);
  }
  return text(outer || null, false);
}
const NUMVAR = /^(count|total|page|pages|start|end|number|num|n|shown|input|output|inTokens|outTokens|percent|pct|amount|current|max|min|limit|remaining|used|size|seconds|minutes|hours|days|weeks|months|years|index|tokens|cost|price|step|attempt|maxRetries|completed|left|over|times|multiplier|fps|sizeMb|availableGb|requiredGb)$|(Count|Total|Tokens|Percent|Number|Amount)$/;
function patterns(E, out) {
  const rules = new Map();
  const esc = (t) => t.replace(/[.*+?^$()|[\]\\\/]/g, "\\$&");
  for (const k of Object.keys(E)) {
    const en = E[k], zh = out[k];
    if (!zh || zh === en || !en.includes("{") || /[\n<]/.test(en) || /[\n<]/.test(zh)) continue;
    let combos = [{}];
    try {
      const seen = {}; renderIcu(en, {}, seen);
      for (const [a, keys] of Object.entries(seen)) combos = combos.flatMap((p) => keys.map((x) => ({ ...p, [a]: x })));
    } catch { continue; }
    if (combos.length > 16) continue;
    for (const plan of combos) {
      let te, tz;
      try { te = renderIcu(en, plan, {}); tz = renderIcu(zh, plan, {}); } catch { continue; }
      te = te.replace(/\s+/g, " ").trim(); tz = tz.trim();
      const parts = te.split(/(\{#?\w+\})/);
      const lit = parts.filter((_, j) => j % 2 === 0).join(" ");
      const words = lit.toLowerCase().split(/[^a-z']+/).filter((w) => w.length >= 2);
      const letters = (lit.match(/[A-Za-z]/g) || []).length;
      // 变量名明显是数字的(count/total/page/...)只匹配数字, 这类短句(如 "Page {page} of {total}")误伤风险很低, 可以放宽
      const isNum = (p) => p.startsWith("{#") || NUMVAR.test(p.replace(/[{}#]/g, ""));
      const vars = parts.filter((_, j) => j % 2 === 1);
      const allNum = vars.length > 0 && vars.every(isNum);
      if (allNum ? letters < 2 : letters < 3 || !words.some((w) => w.length >= 3)) continue;
      // 固定文字很短、或变量在句首句尾的短句，容易套到用户自己写的标题上：生成为"宽松规则"，
      // 页面使用时要求变量部分像名字/数字/产品名或本身能翻译，否则放弃这条规则（见 pattern-engine 的 LC）
      const edgeVar = (parts[0] === "" && !isNum(parts[1])) || (parts[parts.length - 1] === "" && !isNum(parts[parts.length - 2]));
      const loose = !allNum && (letters < 10 || words.length < 2 || (edgeVar && letters < 25));
      const names = [];
      let src = "^", bad = false;
      parts.forEach((p, j) => {
        if (j % 2 === 0) { src += esc(p); return; }
        if (parts[j - 1] === "" && j > 1) bad = true; // 两个变量紧挨着, 无法可靠切分
        names.push(p.replace(/[{}#]/g, ""));
        src += isNum(p) ? "([$€£¥]?[\\d.,]+\\s?[kKMBT]?%?)" : "(.{1,80}?)";
      });
      src += "$";
      // 展开后不含变量的分支（如 plural 的 one/other 各是一整句）：按整句精确匹配
      if (names.length === 0) {
        const k0 = words.filter((w) => /^[a-z]{3,}$/.test(w)).sort((a, b) => b.length - a.length)[0];
        if (k0 && te !== tz && !/[{}]/.test(tz) && !rules.has(src)) rules.set(src, [src, tz, k0, 1000 + letters]);
        continue;
      }
      if (bad || names.length > 9) continue;
      // 句首/句尾是任意文字的变量时, 很容易吃掉用户自己的标题(如 "xxx with Claude"), 要求固定文字足够长
      let ok = true;
      const target = tz.replace(/\{#?(\w+)\}/g, (_, n) => { const x = names.indexOf(n); if (x < 0) ok = false; return "$" + (x + 1); });
      if (!ok || /[{}]/.test(target)) continue;
      const key = words.filter((w) => /^[a-z]{3,}$/.test(w)).sort((a, b) => b.length - a.length)[0];
      if (!key || rules.has(src)) continue;
      // 宽松规则优先级压到所有正常规则之下（< 1），只在没有更具体的规则时才用
      rules.set(src, loose ? [src, target, key, letters / 1000, "", 1] : [src, target, key, letters]);
    }
  }
  // 句中带链接/加粗的文字在页面上被切成几段(如 "Read our" + "security guide" + "for details."), 整句对不上.
  // 按标签把英文和中文切段, 段数一致时按位置配对; 同一英文片段有多种译法时取最常见的.
  const frag = new Map();
  for (const k of Object.keys(E)) {
    const en = E[k], zh = out[k];
    if (!zh || zh === en || !/<\/?\w+\s*\/?>/.test(en) || /[{}\n]/.test(en) || /[{}\n]/.test(zh)) continue;
    const tagRe = /<\/?[A-Za-z0-9_]+\s*\/?>/g;
    if ((en.match(tagRe) || []).join() !== (zh.match(tagRe) || []).join()) continue; // 中文调换了标签顺序, 位置配对不可靠
    const se = en.split(tagRe).map((x) => x.replace(/\s+/g, " ").trim());
    const sz = zh.split(tagRe).map((x) => x.trim());
    if (se.length !== sz.length) continue;
    let depth = 0;
    const tags = en.match(tagRe) || [];
    se.forEach((a, j) => {
      const inner = depth > 0; // 标签内的文字(链接、加粗)通常是能独立成立的名词短语
      if (j < tags.length) depth += /^<\//.test(tags[j]) ? -1 : /\/>$/.test(tags[j]) ? 0 : 1;
      const b = sz[j];
      if ((a.match(/[A-Za-z]/g) || []).length < 4 || !b || a === b || KEEP_EN.test(a) || !/[一-鿿]/.test(b)) return;
      if (!inner && a.split(" ").length < 3) return; // 标签外的短片段(如 "on the")拿到别处容易错译
      const m = frag.get(a) || new Map(); m.set(b, (m.get(b) || 0) + 1); frag.set(a, m);
    });
  }
  for (const [a, m] of frag) {
    const ranked = [...m].sort((x, y) => y[1] - x[1]);
    // 短片段译法不统一时宁缺毋滥; 长句(6 个词以上)不会被拿到别处误用, 取任一译法都行
    if (ranked.length > 1 && ranked[0][1] < ranked[1][1] * 2 && a.split(" ").length < 6) continue;
    const b = ranked[0][0];
    const src = "^" + a.replace(/[.*+?^$()|[\]\\\/{}]/g, "\\$&") + "$";
    const key = a.toLowerCase().split(/[^a-z']+/).filter((w) => /^[a-z]{3,}$/.test(w)).sort((x, y) => y.length - x.length)[0] || "*";
    if (!rules.has(src)) rules.set(src, [src, b, key, 1500]);
  }
  // supplement/patterns.json: 手写的短句规则(自动生成会因过短被过滤), 优先级最高
  const manual = load(path.join(SUPP, "patterns.json"));
  return (Array.isArray(manual) ? manual : []).concat([...rules.values()].filter(([s]) => !manual.some((m) => m[0] === s)));
}

function baseline() {
  // 首次运行时把当前已安装的汉化文件存为基线, 之后不覆盖
  const b = path.join(HERE, "baseline");
  fs.mkdirSync(b, { recursive: true });
  for (const [n, f] of [["frontend-installed.json", "ion-dist/i18n/zh-CN.json"], ["desktop-installed.json", "zh-CN.json"]]) {
    const p = path.join(b, n);
    if (!fs.existsSync(p) && fs.existsSync(path.join(R, f))) fs.writeFileSync(p, fs.readFileSync(path.join(R, f)));
  }
}

const cmd = process.argv[2] || "status";
baseline();
if (cmd === "status") {
  for (const n of Object.keys(TARGETS)) {
    const { E, out, missing, bad } = merge(n);
    const total = Object.keys(E).length, done = Object.keys(out).length;
    console.log(`${n}: ${done}/${total} (${((100 * done) / total).toFixed(1)}%), 待翻译 ${Object.keys(missing).length}, 校验未通过的旧译文 ${bad}`);
  }
} else if (cmd === "check") {
  // 校验 supplement/ 中的补译: 占位符/标签与英文一致, 且 key 存在
  for (const n of Object.keys(TARGETS)) {
    const E = TARGETS[n].en();
    const dir = path.join(SUPP, n);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).sort()) {
      const S = load(path.join(dir, f));
      const errs = Object.keys(S).filter((k) => !(k in E) || !valid(E[k], S[k]));
      const todo = load(path.join(TODO, n, f));
      const left = Object.keys(todo).filter((k) => !(k in S));
      if (errs.length || left.length) console.log(`${n}/${f}: ${errs.length} 条校验失败, ${left.length} 条遗漏`);
      for (const k of errs.slice(0, 10)) console.log(`  ${k}\n    en: ${E[k]}\n    zh: ${S[k]}`);
    }
  }
  console.log("检查完成");
} else if (cmd === "todo") {
  const size = +process.argv[3] || 400;
  fs.rmSync(TODO, { recursive: true, force: true });
  for (const n of Object.keys(TARGETS)) {
    const { missing } = merge(n);
    const keys = Object.keys(missing);
    fs.mkdirSync(path.join(TODO, n), { recursive: true });
    for (let i = 0; i * size < keys.length; i++) {
      const part = {};
      for (const k of keys.slice(i * size, (i + 1) * size)) part[k] = missing[k];
      fs.writeFileSync(path.join(TODO, n, `${String(i).padStart(3, "0")}.json`), JSON.stringify(part, null, 1));
    }
    console.log(`${n}: ${keys.length} 条, ${Math.ceil(keys.length / size)} 批`);
  }
} else if (cmd === "build" || cmd === "install") {
  fs.mkdirSync(OUT, { recursive: true });
  for (const n of Object.keys(TARGETS)) {
    const { E, out, missing } = merge(n);
    // 缺失条目不写入, 由应用回退到英文
    fs.writeFileSync(path.join(OUT, n + "-zh-CN.json"), JSON.stringify(out, null, 2) + "\n");
    console.log(`${n}: 写出 ${Object.keys(out).length}/${Object.keys(E).length}, 缺失 ${Object.keys(missing).length}`);
  }
  if (cmd === "install") {
    const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
    const bk = path.join(HERE, "backups", stamp);
    for (const n of Object.keys(TARGETS)) {
      const dest = TARGETS[n].dest();
      fs.mkdirSync(path.join(bk, n), { recursive: true });
      if (fs.existsSync(dest)) fs.writeFileSync(path.join(bk, n, "zh-CN.json"), fs.readFileSync(dest));
      fs.writeFileSync(dest, fs.readFileSync(path.join(OUT, n + "-zh-CN.json")));
      console.log(`已写入 ${dest}`);
    }
    console.log(`原文件备份在 ${bk}`);
  }
} else if (cmd === "patterns") {
  // 预览变量句规则: node build.js patterns "Resets at 2:10 PM"
  const { E, out } = merge("frontend");
  const rules = patterns(E, out);
  console.log(`${rules.length} 条规则`);
  for (const t of process.argv.slice(3)) {
    const hits = rules.filter(([s]) => new RegExp(s).test(t)).sort((a, b) => b[3] - a[3]);
    console.log(t, "=>", hits.slice(0, 3).map(([s, z]) => `${z}   [${s}]`));
  }
} else if (cmd === "pack") {
  // 把合并结果写进 GitHub 汉化包的 resources 目录, 再由汉化包自己的 install-windows.bat 安装
  // (它会据此重新生成在线页面用的翻译表), 不引入新的修改手段
  const dir = path.resolve(process.argv[3] || DEFAULT_PACK);
  // 每个汉化包文件夹里各存一份作者原版(第一次 pack 时保存), 之后总是在原版基础上重新生成;
  // 换成作者的新版本时, 用的就是新版本自己的原版
  const bk = path.join(dir, "..", "作者原版");
  fs.mkdirSync(bk, { recursive: true });
  for (const n of Object.keys(TARGETS)) {
    const { E, out } = merge(n);
    const dest = path.join(dir, n + "-zh-CN.json");
    const keep = path.join(bk, n + "-zh-CN.json");
    if (!fs.existsSync(keep) && fs.existsSync(dest)) fs.writeFileSync(keep, fs.readFileSync(dest)); // 只备份一次原版
    fs.writeFileSync(dest, JSON.stringify(out, null, 2) + "\n");
    console.log(`已写入 ${dest}: ${Object.keys(out).length}/${Object.keys(E).length}`);
  }
  // 词库里没有的界面文字(服务器下发或写死在代码里), 追加到汉化包自己的 frontend-hardcoded 词表.
  // 只收纯显示文字: 汉化包会按"引号包住的完全相同字符串"替换前端代码, 含 " \ = ; { 换行的会退化成全局替换, 一律拒绝.
  const hcDest = path.join(dir, "frontend-hardcoded-zh-CN.json");
  const hcKeep = path.join(bk, "frontend-hardcoded-zh-CN.json");
  if (!fs.existsSync(hcKeep) && fs.existsSync(hcDest)) fs.writeFileSync(hcKeep, fs.readFileSync(hcDest));
  // 汉化包自带词表里也统一术语(如 "你的 Artifacts…" → "你的作品…"), 只动纯文字条目
  const base = load(hcKeep).map(([a, b]) => [a, /["\\=;\n]/.test(a) ? b : normalize(b)]);
  const have = new Set(base.map((x) => x[0]));
  const extra = [];
  for (const [en, zh] of load(path.join(SUPP, "hardcoded.json"))) {
    if (/["\\=;{}\n]/.test(en) || /["\\{}\n]/.test(zh) || en === zh) { console.log(`  跳过不安全条目: ${en}`); continue; }
    if (!have.has(en)) { extra.push([en, zh]); have.add(en); }
  }
  fs.writeFileSync(hcDest, JSON.stringify(base.concat(extra), null, 2) + "\n");
  console.log(`已写入 ${hcDest}: 原有 ${base.length} 条 + 补充 ${extra.length} 条`);
  // 主程序的语言会被在线页面同步回 en-US, 菜单/托盘随之读 en-US.json. 生成一份"键不变、值为中文"的版本,
  // 由安装脚本覆盖 en-US.json(先用汉化包自己的备份机制备份原版, 卸载时还原)
  {
    const { E: DE, out: DO } = merge("desktop");
    const ov = {};
    for (const k of Object.keys(DE)) ov[k] = DO[k] || DE[k];
    const ovDest = path.join(dir, "desktop-en-US-override-zh-CN.json");
    fs.writeFileSync(ovDest, JSON.stringify(ov, null, 2) + "\n");
    console.log(`已写入 ${ovDest}: ${Object.keys(ov).length} 条`);
  }
  // 带变量句子的匹配规则, 由汉化包安装脚本读入在线页面的翻译脚本(只改显示文字)
  const { E: FE, out: FO } = merge("frontend");
  // supplement/dom.json: 只在页面显示层整句替换的文字(服务器下发、或容易与代码里同名字符串冲突的), 不碰前端代码
  const esc = (t) => t.replace(/[.*+?^$()|[\]\\\/{}]/g, "\\$&");
  const domSrc = fs.readdirSync(SUPP).filter((f) => /^dom[\w-]*\.json$/.test(f)).sort().flatMap((f) => load(path.join(SUPP, f)));
  // dynamic 词表(模型选择器说明等)汉化包只装了英文原文; 用 statsig 词表(同 ID)或前端词库(同原文)里的中文补上
  {
    const dyn = load(path.join(R, "ion-dist", "i18n", "dynamic", "en-US.json"));
    const sz = load(path.join(dir, "statsig-zh-CN.json"));
    const byText = new Map(Object.keys(FE).filter((k) => FO[k] && FO[k] !== FE[k]).map((k) => [FE[k], FO[k]]));
    let n = 0;
    for (const [k, en] of Object.entries(dyn)) {
      const zh = sz[k] || byText.get(en);
      if (zh && zh !== en && !/[{}\n]/.test(en)) { domSrc.push([en, normalize(zh)]); n++; }
    }
    console.log(`dynamic 词表: ${n}/${Object.keys(dyn).length} 条有中文`);
  }
  // 小标题常用 CSS 全大写显示, 页面里的文字可能就是大写形式, 一并加上
  // 服务器下发的文字大小写常和词库不一致(如 "Peak Hour"), 页面层规则一律不区分大小写
  const dom = domSrc.map(([en, zh]) => {
    const key = en.toLowerCase().split(/[^a-z']+/).filter((w) => /^[a-z]{3,}$/.test(w)).sort((a, b) => b.length - a.length)[0] || "*";
    return ["^" + esc(en.replace(/\s+/g, " ").trim()) + "$", zh, key, 2000, "i"];
  });
  const rules = dom.concat(patterns(FE, FO));
  const pDest = path.join(dir, "frontend-patterns-zh-CN.json");
  fs.writeFileSync(pDest, JSON.stringify(rules).split(String.fromCharCode(0x2028)).join("\\u2028").split(String.fromCharCode(0x2029)).join("\\u2029"));
  console.log(`已写入 ${pDest}: ${rules.length} 条变量句规则`);
  // 让汉化包安装脚本把这些规则并入它原有的在线翻译脚本: 只加读取文件的几行和匹配函数, 注入方式不变
  const ps1 = path.join(dir, "..", "scripts", "install_windows.ps1");
  const ps1Keep = path.join(bk, "install_windows.ps1");
  if (!fs.existsSync(ps1Keep)) fs.writeFileSync(ps1Keep, fs.readFileSync(ps1));
  const raw = fs.readFileSync(ps1Keep);
  const bom = raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf;
  let ps = raw.toString("utf8").replace(/^﻿/, "");
  const swap = (a, b) => { if (!ps.includes(a)) throw new Error("汉化包脚本结构已变化, 找不到: " + a.slice(0, 60)); ps = ps.replace(a, () => b); };
  const engine = fs.readFileSync(path.join(HERE, "pattern-engine.js"), "utf8").trim();
  const rDef = 'const R=s=>{const n=N(s);if(M[n])return M[n];for(const [r,t] of G){const m=n.match(r);if(m)return t.replace("$1",m[1])}};';
  // 同时修正汉化包原有规则只替换 $1 的问题(否则日期显示成 "$2年9月25日")
  const rFixed = rDef.replace('return t.replace("$1",m[1])', 'return t.replace(/\\$(\\d)/g,(_,i)=>{const c=m[i]||"";return /\\s/.test(c)&&(M[c]||ML(c)||VP(c))||c})').replace(/\}\};$/, "}const v=VP(n);if(v===void 0)MS(n);return v};");
  // 作者 1.4.10 之后已自行修正 $1 问题（写法与这里相同），新旧两种写法都接入匹配引擎
  const rDefNew = rDef.replace('return t.replace("$1",m[1])', 'return t.replace(/\\$(\\d)/g,(_,i)=>m[i]||"")');
  swap(ps.includes(rDef) ? rDef : rDefNew, "const V=__PATTERNS__;\n" + engine + "\n" + rFixed);
  // 保护范围补上代码页的对话正文（Claude 回复、文件预览正文、排队中的消息），这些区域的文字不经过翻译规则，也不会被漏翻收集
  swap(`[data-testid="conway-output-cell"]';`, `[data-testid="conway-output-cell"],.epitaxy-markdown,.epitaxy-file-prose,[data-testid="coach-queued-message"],[data-testid="user-message-edit"],[data-testid="thread-step-text"],[data-testid="result-list"],[data-testid="result-list-box"]';`);
  // 汉化包用的 [ordered]@{} 不区分大小写, "This computer" 会被 "this computer" 覆盖, 而页面匹配区分大小写, 导致数百条常用词失效
  if (ps.includes("    $mapping = [ordered]@{}")) swap("    $mapping = [ordered]@{}", "    $mapping = New-Object System.Collections.Specialized.OrderedDictionary ([System.StringComparer]::Ordinal)");   // 作者新版已修正则跳过
  const instLine = 'Write-Host "  installed resources/$Lang.json" -ForegroundColor Green';
  swap(instLine, instLine + "\r\n" +
    "    # 补全工具: 主程序语言会被在线页面同步回 en-US, 菜单/托盘随之读 en-US.json; 用中文版覆盖(原版由汉化包备份, 卸载时还原)\r\n" +
    '    $desktopEnOverride = Join-Path (Split-Path -Parent $Pack["Desktop"]) "desktop-en-US-override-$Lang.json"\r\n' +
    "    if (Test-Path -LiteralPath $desktopEnOverride) {\r\n" +
    '        $desktopEnPath = Join-Path $ResourcesPath "en-US.json"\r\n' +
    "        Backup-ModifiedFile $ResourcesPath $desktopEnPath\r\n" +
    "        Copy-Item $desktopEnOverride $desktopEnPath -Force\r\n" +
    '        Write-Host "  installed resources/en-US.json (中文菜单)" -ForegroundColor Green\r\n' +
    "    }");
  const tail = '.Replace("__ORG_INFERENCE_TEXT__", $orgInferenceTextJson)';
  swap(tail, tail + '.Replace("__PATTERNS__", $patternsJson)');
  swap("    return $template.Replace(",
    "    $patternsDir = Split-Path -Parent $(if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path })\r\n" +
    '    $patternsPath = Join-Path $patternsDir "resources\\frontend-patterns-$Language.json"\r\n' +
    '    $patternsJson = if (Test-Path -LiteralPath $patternsPath) { [System.IO.File]::ReadAllText($patternsPath, [System.Text.Encoding]::UTF8).Trim() } else { "[]" }\r\n' +
    "    return $template.Replace(");
  // 外置词典: 安装时把整份翻译脚本另存到 runtime\, 主程序每次页面加载时读它; 读不到就用安装时内置的那份.
  // 之后更新词典只需 `node build.js runtime` 重新生成 runtime\ 里的文件, 重启 Claude 即生效
  const runtimeDir = RUNTIME_DIR;
  swap("    $scriptLiteral = $script | ConvertTo-Json -Compress",
    "    $scriptLiteral = $script | ConvertTo-Json -Compress\r\n" +
    "    # 优化版: 外置词典。主程序每次页面加载时读取它，读不到则使用这里内置的一份\r\n" +
    "    $runtimeDir = '" + runtimeDir.replace(/'/g, "''") + "'\r\n" +
    '    $runtimeFile = Join-Path $runtimeDir "dom-$Language.js"\r\n' +
    "    try {\r\n" +
    "        New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null\r\n" +
    "        [System.IO.File]::WriteAllText($runtimeFile, $script, (New-Object System.Text.UTF8Encoding $false))\r\n" +
    '        Write-Host "  wrote external dictionary: $runtimeFile" -ForegroundColor Green\r\n' +
    "    } catch {\r\n" +
    '        Write-Host "  [警告] 无法写入外置词典，将只使用内置翻译：$runtimeFile" -ForegroundColor DarkYellow\r\n' +
    "    }\r\n" +
    "    $runtimePathLiteral = $runtimeFile | ConvertTo-Json -Compress\r\n" +
    "    $scriptLiteral = '(()=>{try{return require(\"fs\").readFileSync(' + $runtimePathLiteral + ',\"utf8\")}catch(e){return ' + $scriptLiteral + '}})()'");
  fs.writeFileSync(ps1, Buffer.concat([bom ? Buffer.from([0xef, 0xbb, 0xbf]) : Buffer.alloc(0), Buffer.from(ps, "utf8")]));
  console.log(`已更新 ${ps1} (原版备份在 ${ps1Keep})`);
  console.log(`汉化包原文件备份在 ${bk}`);
} else if (cmd === "runtime") {
  // 只更新外置词典(不用重装): 先 pack, 再用汉化包安装脚本里的同一套函数生成翻译脚本, 写到 runtime\
  const dir = path.resolve(process.argv[3] || DEFAULT_PACK);
  execSync(`node "${__filename}" pack "${dir}"`, { stdio: "inherit" });
  // 保险：新生成的外置词典语法不通过就恢复上一份可用的，避免重启 Claude 后整个汉化失效
  const rtFile = path.join(RUNTIME_DIR, "dom-zh-CN.js"), rtBak = rtFile + ".last-good";
  if (fs.existsSync(rtFile)) { try { new (require("vm").Script)(fs.readFileSync(rtFile, "utf8")); fs.copyFileSync(rtFile, rtBak); } catch {} }
  execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${path.join(HERE, "make-runtime.ps1")}" -PackDir "${path.resolve(dir, "..")}" -RuntimeDir "${RUNTIME_DIR}" -ResourcesPath "${R}"`, { stdio: "inherit" });
  try { new (require("vm").Script)(fs.readFileSync(rtFile, "utf8")); }
  catch (e) {
    if (fs.existsSync(rtBak)) fs.copyFileSync(rtBak, rtFile);
    console.error(`[错误] 新生成的外置词典有语法错误（${e.message}），已恢复上一份可用的词典。`);
    process.exit(1);
  }
  // 系统通知的正文由网页交给主进程弹出, 不经过页面翻译; 主进程补丁按这张"英文 → 中文"表替换(只含不带变量的整句)
  const nmap = {};
  for (const [en, zhFile] of [[path.join(R, "ion-dist", "i18n", "en-US.json"), "frontend-zh-CN.json"], [path.join(HERE, "pack-original", "desktop-en-US.json"), "desktop-zh-CN.json"]]) {
    const E = load(en), Z = load(path.join(dir, zhFile));
    for (const k of Object.keys(E)) {
      const a = E[k], b = Z[k];
      if (b && b !== a && a.length <= 300 && !/[{}<]/.test(a) && !/[{}<]/.test(b) && !(a in nmap)) nmap[a] = b;
    }
  }
  fs.writeFileSync(path.join(RUNTIME_DIR, "notify-zh-CN.json"), JSON.stringify(nmap));
  console.log(`已写入通知译文表: ${Object.keys(nmap).length} 条`);
}
