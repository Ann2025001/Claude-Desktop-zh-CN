// 从本机 Claude Code 程序(只读)提取内置斜杠命令的说明, 输出待翻译清单: node slash-commands.js
const fs = require("fs"), path = require("path");
const base = path.join(process.env.APPDATA, "Claude", "claude-code");
const ver = fs.readdirSync(base).filter((d) => /^\d/.test(d)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).pop();
const dir = fs.readdirSync(path.join(base, ver)).map((d) => path.join(base, ver, d)).find((d) => fs.existsSync(path.join(d, "claude.exe")));
const s = fs.readFileSync(path.join(dir, "claude.exe")).toString("latin1");
const out = new Map();
// 内置命令定义形如 {type:"local",name:"usage",description:"...",...}
const re = /name:"([a-z][a-z0-9-]{1,30})",(?:[^{}]{0,200}?)description:"((?:[^"\\]|\\.){8,200})"/g;
let m;
while ((m = re.exec(s))) {
  let d;
  try { d = JSON.parse('"' + Buffer.from(m[2], "latin1").toString("utf8") + '"'); } catch { continue; }
  if (/^[A-Z]/.test(d) && !/[{}<>]|\$\{/.test(d) && !out.has(d)) out.set(d, m[1]);
}
console.log(ver, out.size);
fs.writeFileSync(path.join(__dirname, "slash-commands-en.json"), JSON.stringify([...out].map(([d, n]) => [n, d]), null, 1));
