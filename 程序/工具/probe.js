// 查找程序里某段文字的上下文(只读): node probe.js "文字" [前后字符数] [文件]
const fs = require("fs"), path = require("path");
const R = require("./claude-path");
const [q, span = "400", only] = process.argv.slice(2);
const files = only ? [R + only] : [R + "app.asar", ...fs.readdirSync(R + "ion-dist/assets/v1").filter((f) => f.endsWith(".js")).map((f) => R + "ion-dist/assets/v1/" + f)];
let hits = 0;
for (const f of files) {
  const s = fs.readFileSync(f).toString("utf8");
  let i = s.indexOf(q);
  while (i >= 0 && hits < 6) {
    if (!s.slice(Math.max(0, i - 40), i).includes("claudeZhDom") && !/"\s*:\s*"[^"]*$/.test(s.slice(i - 3, i))) {
      console.log("== " + path.basename(f) + " @" + i);
      console.log(s.slice(Math.max(0, i - +span), i + +span).replace(/\s+/g, " "));
      hits++;
    }
    i = s.indexOf(q, i + 1);
  }
}
if (!hits) console.log("没找到: " + q);
