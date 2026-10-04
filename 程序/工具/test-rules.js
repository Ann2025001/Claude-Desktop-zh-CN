// 测试变量句/片段规则: node test-rules.js
const fs = require("fs");
const RES = require("./claude-path");
const V = JSON.parse(fs.readFileSync(require("path").resolve(__dirname, "..", "汉化包", "resources", "frontend-patterns-zh-CN.json"), "utf8"));
// 与安装脚本一致: 前端词库(按原文, 区分大小写) + 写死文字词表
const PK = require("path").resolve(__dirname, "..", "汉化包", "resources") + "/";
const en = JSON.parse(fs.readFileSync(RES + "ion-dist/i18n/en-US.json", "utf8")), zh = JSON.parse(fs.readFileSync(PK + "frontend-zh-CN.json", "utf8"));
const okE = (a, b) => a && b && a !== b && !/[{\n]/.test(a) && !/[{\n]/.test(b);
const M = {};
for (const k in en) if (okE(en[k], zh[k])) M[en[k]] = zh[k];
for (const [a, b] of JSON.parse(fs.readFileSync(PK + "frontend-hardcoded-zh-CN.json", "utf8"))) if (okE(a, b)) M[a] = b;
eval(fs.readFileSync(__dirname + "/pattern-engine.js", "utf8") + ";globalThis.VP=VP");
console.log("片段规则", V.filter((r) => r[3] === 1500).length);
const samples = ["Read our", "security guide", "for details.", "Oct 4, 2026, 9:27 AM", "Sep 1 2026", "Sep 25, 2026, 12:27 AM", "7 PM South Korea Time", "MOST ACTIVE DAY", "YOUR TIME WITH CLAUDE",
  "Claude uses memory to build your reflection. Turn this off anytime in", "memory settings", "No trusted devices.",
  "Browsed the web, used a tool", "Searched the web, read 3 files", "3.5k in · 4.6M out", "22 in · 4.8k out", "Showing 1–5 of 9", "Page 1 of 2",
  "Opus 4.8's safeguards flagged this message. Our intentionally broad safeguards allow us to deliver more capabilities faster, but can sometimes flag legitimate cybersecurity work. Apply to the Cyber Verification Program to reduce these interruptions.",
  "Details:", "Balanced for everyday work", "Claude Code notice", "Apples, oranges", "Tom, Jerry and Spike",
  "Most Active Day", "PEAK HOUR", "Peak Hour", "Total Conversations", "2 conversations", "0 conversations", "Context 0", "64% of session limit · Resets in 1 hr 6 min",
  "Concise", "Explanatory", "Extra", "Regenerate reflection", "Sort by Last edited",
  "Bypass all permission checks and let Claude work uninterrupted. This works well for workflows like fixing lint errors or generating boilerplate code. Letting Claude run arbitrary commands is risky and can result in data loss, system corruption, or data exfiltration (e.g., via prompt injection attacks).",
  "my trip · day 2", "Help me with my homework", "Hello", "Thanks", "OK", "Fix the bug", "Done", "Seattle, WA, US", "Android (Android)", "Learn more", "Write a poem", "Summarize this", "Open settings"];
for (const s of samples) console.log(JSON.stringify(s), "=>", VP(s));
const unesc = (r) => r.slice(1, -1).replace(/\\(.)/g, "$1");
const short = V.filter((r) => r[3] === 1500).map((r) => unesc(r[0]) + " → " + r[1]).filter((s) => s.split(" → ")[0].split(" ").length <= 2);
console.log("两个词以内的片段", short.length);
console.log(short.slice(0, 80).join(" | "));
