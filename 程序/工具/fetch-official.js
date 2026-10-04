// 从 Anthropic 公开仓库读取官方技能 / 插件的介绍原文，列出还没有中文的（只读网络访问）: node fetch-official.js
// 结果写入 official-todo.json(不入库)，翻译后放进 supplement/dom-official.json
const fs = require("fs"), path = require("path");
const REPOS = [
  { repo: "anthropics/skills", match: /SKILL\.md$/ },
  { repo: "anthropics/knowledge-work-plugins", match: /(plugin\.json|SKILL\.md)$/ },
];
const get = async (url) => { const r = await fetch(url, { headers: { "User-Agent": "zh-cn-supplement" } }); return r.ok ? r.text() : null; };
function descOf(file, text) {
  if (file.endsWith(".json")) { try { const j = JSON.parse(text); return j.description; } catch { return null; } }
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return null;
  const m = fm[1].match(/^description:\s*(.*(?:\r?\n[ \t]+.*)*)/m);
  if (!m) return null;
  let v = m[1].trim();
  if (/^[>|]-?$/.test(v.split("\n")[0])) v = v.split("\n").slice(1).join(" ");
  v = v.replace(/\s*\r?\n\s*/g, " ").trim();
  if (/^".*"$/.test(v)) { try { v = JSON.parse(v); } catch {} }
  else if (/^'.*'$/.test(v)) v = v.slice(1, -1).replace(/''/g, "'");
  return v;
}
(async () => {
  const done = new Set();
  for (const f of fs.readdirSync(path.join(__dirname, "supplement")).filter((x) => /^dom.*\.json$/.test(x)))
    for (const [en] of JSON.parse(fs.readFileSync(path.join(__dirname, "supplement", f), "utf8"))) done.add(en);
  const out = [];
  for (const { repo, match } of REPOS) {
    const tree = JSON.parse((await get(`https://api.github.com/repos/${repo}/git/trees/main?recursive=1`)) || "{}").tree || [];
    for (const f of tree.filter((x) => match.test(x.path) && !/template\//.test(x.path))) {
      const d = descOf(f.path, (await get(`https://raw.githubusercontent.com/${repo}/main/${f.path}`)) || "");
      if (d && !done.has(d)) { out.push([d, "", `${repo}/${f.path}`]); done.add(d); }
    }
  }
  fs.writeFileSync(path.join(__dirname, "official-todo.json"), JSON.stringify(out, null, 1));
  console.log(`待翻译的官方介绍 ${out.length} 条`);
})();
