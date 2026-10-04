// 检查主程序(菜单/托盘/对话框)文字的中文覆盖: node test-menus.js
const fs = require("fs");
const R = require("./claude-path");
const P = require("path").resolve(__dirname, "..", "汉化包", "resources") + "/";
const s = fs.readFileSync(R + "app.asar").toString("utf8");
const ov = JSON.parse(fs.readFileSync(P + "desktop-en-US-override-zh-CN.json", "utf8"));
const fe = JSON.parse(fs.readFileSync(P + "frontend-zh-CN.json", "utf8"));
const cjk = (v) => /[\u4e00-\u9fff]/.test(v || "");
// 主进程代码在 .vite/build/index*.js 里; 只看 formatMessage 调用(菜单、托盘、对话框、通知)
const re = /formatMessage\(\{defaultMessage:"((?:[^"\\]|\\.)*)",id:"([^"]+)"/g;
let m, total = 0;
const miss = new Map();
while ((m = re.exec(s))) {
  total++;
  const id = m[2];
  if (id in ov) { if (!cjk(ov[id]) && /[a-z]{3}/.test(m[1])) miss.set(id, m[1]); }
  else if (!cjk(fe[id])) miss.set(id, m[1] + "  (不在桌面目录)");
}
console.log("formatMessage 调用", total, "无中文", miss.size);
console.log([...miss].slice(0, 60).map(([i, d]) => i + " = " + d).join("\n"));
// 菜单里直接写死的英文标签
const lab = new Set();
const re2 = /\{label:"([A-Z][A-Za-z .…'&-]{2,40})"/g;
while ((m = re2.exec(s))) lab.add(m[1]);
console.log("写死的英文 label:", [...lab].join(" | "));
