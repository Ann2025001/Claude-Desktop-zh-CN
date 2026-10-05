// 回归测试（带断言）：node test-golden.js，先 node build.js runtime。任何一条不符就列出并以失败退出。
// 用例来自修过的问题；undefined 表示"必须保持原文不翻"（防止误改用户内容）
const fs = require("fs"), path = require("path");
const RES = require("./claude-path");
const PK = path.resolve(__dirname, "..", "汉化包", "resources") + "/";
const V = JSON.parse(fs.readFileSync(PK + "frontend-patterns-zh-CN.json", "utf8"));
const en = JSON.parse(fs.readFileSync(RES + "ion-dist/i18n/en-US.json", "utf8")), zh = JSON.parse(fs.readFileSync(PK + "frontend-zh-CN.json", "utf8"));
const okE = (a, b) => a && b && a !== b && !/[{\n]/.test(a) && !/[{\n]/.test(b);
const M = {};
for (const k in en) if (okE(en[k], zh[k])) M[en[k]] = zh[k];
for (const [a, b] of JSON.parse(fs.readFileSync(PK + "frontend-hardcoded-zh-CN.json", "utf8"))) if (okE(a, b)) M[a] = b;
eval(fs.readFileSync(path.join(__dirname, "pattern-engine.js"), "utf8") + ";globalThis.VP=VP");
const tr = (s) => { const n = s.replace(/\s+/g, " ").trim(); return M[n] !== undefined ? M[n] : VP(n); };

const cases = [
  // 重置时间：片段不能变成 "at 重置"
  ["Resets at", "重置于 "],
  ["Resets at 2:00 PM", "14:00 重置"],
  ["Resets in 5 min", "5 分钟后重置"],
  ["64% of session limit · Resets in 1 hr 6 min", undefined, "不为 undefined"],
  // 几句拼接
  ["Turn on usage credits to keep working past your plan limit. Your weekly limit resets at 2:00 PM.", "开启用量额度，以便在超出套餐限额后继续工作。你的每周限额将于 14:00 重置。"],
  ["When safeguards flag a message, automatically switch to a different model to keep chatting. When off, your session will pause instead. Applies to local sessions on this machine.", "当安全机制标记某条消息时，自动切换到其他模型以继续对话。关闭后，会话将改为暂停。适用于本机上的本地会话。"],
  // 限额与后台任务
  ["You've hit your weekly limit · resets 2pm (Asia/Seoul)", "已达到每周限额 · 14:00 (Asia/Seoul) 重置"],
  ["Background workflow completed", "后台工作流已完成"],
  ["3 background commands completed", "3 个后台命令已完成"],
  ["3 commits to push · 2 behind its base branch", "3 个提交待推送 · 落后基础分支 2 个提交"],
  ["Oct 5 at 7:10 PM", "10月5日 19:10"],
  ["Opus draws down usage faster than Sonnet", "Opus 消耗用量的速度比 Sonnet 快"],
  // 带加粗标签的句子（如切换强度/模型的确认框），换了档位名也要能翻译
  ["Your next response will be slower and use more tokens. This task is cached for the current effort level. Switching to 中 means the full history gets re-read on your next message.", "你的下一次回复会更慢，并消耗更多令牌。此任务已为当前推理强度缓存。切换到 中 意味着你的下一条消息会重新读取完整历史。"],
  ["Your next response will be slower and use more tokens. This task is cached for the current model. Switching to Opus 5.5 means the full history gets re-read on your next message.", "你的下一次回复会更慢，并消耗更多令牌。此任务已为当前模型缓存。切换到 Opus 5.5 意味着你的下一条消息会重新读取完整历史。"],
  // 术语与错译修正
  ["Weekdays", "工作日"],
  ["Force-kill", "强制结束"],
  ["Read-only", "只读"],
  // 日期不能出现 $2年
  ["Sep 25, 2026, 12:27 AM", undefined, "不含 $2"],
  // 普通英文句子、用户可能写的话：必须保持原文
  ["Hello there. How are you?", undefined],
  ["I fixed the bug. Tests pass.", undefined],
  ["Help me with my homework", undefined],
  ["Fix the bug", undefined],
];
let fail = 0;
for (const [input, want, rule] of cases) {
  const got = tr(input);
  let ok;
  if (rule === "不为 undefined") ok = got !== undefined;
  else if (rule === "不含 $2") ok = got === undefined || !String(got).includes("$2");
  else ok = got === want;
  if (!ok) { fail++; console.log(`✗ ${JSON.stringify(input)}\n    期望 ${JSON.stringify(rule || want)}\n    实际 ${JSON.stringify(got)}`); }
}
console.log(fail ? `${fail}/${cases.length} 条失败` : `全部 ${cases.length} 条通过`);
process.exit(fail ? 1 : 0);
