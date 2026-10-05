// 发布新版本：node release.js v1.0.2 说明.md [标题]
// 依次：检查工作区干净且已推送 → 跑回归测试 → 打带说明的标签并推送 → git archive 打包 → gh release create 上传
// 需要 gh 已登录（gh auth login）。压缩包写到系统临时目录（路径短，避免 git 在 Windows 上报路径过长）
const { execSync } = require("child_process"), fs = require("fs"), path = require("path"), os = require("os");
const [ver, notes, title] = process.argv.slice(2);
if (!/^v\d+\.\d+\.\d+$/.test(ver || "") || !notes || !fs.existsSync(notes)) {
  console.log("用法：node release.js v1.0.2 说明.md [标题]"); process.exit(1);
}
const root = path.resolve(__dirname, "..", "..");
const sh = (c, o = {}) => execSync(c, { cwd: root, stdio: o.quiet ? "pipe" : "inherit", encoding: "utf8" });
if (sh("git status --porcelain", { quiet: true }).trim()) { console.log("工作区有未提交的改动，先提交再发布"); process.exit(1); }
sh("git fetch -q origin");
if (sh("git rev-parse HEAD", { quiet: true }) !== sh("git rev-parse origin/main", { quiet: true })) { console.log("本地与 GitHub 不一致，先推送"); process.exit(1); }
if (sh(`git tag -l ${ver}`, { quiet: true }).trim()) { console.log(`标签 ${ver} 已存在`); process.exit(1); }
sh(`node "${path.join(__dirname, "test-golden.js")}"`);
sh(`git tag -a ${ver} -m ${ver}`);
sh(`git push -q origin ${ver}`);
const zip = path.join(os.tmpdir(), `Claude-Desktop-zh-CN-${ver}.zip`);
sh(`git archive --format=zip --prefix=Claude-Desktop-zh-CN/ -o "${zip}" ${ver}`);
sh(`gh release create ${ver} "${zip}" --title "${title || ver}" --notes-file "${path.resolve(notes)}" --latest`);
fs.unlinkSync(zip);
console.log(`已发布 ${ver}`);
