// 找到本机 Claude Desktop 的 resources 目录(以 / 结尾), 供检查脚本使用
const { execSync } = require("child_process");
const loc = execSync('powershell -NoProfile -Command "(Get-AppxPackage -Name Claude | Select -First 1).InstallLocation"').toString().trim();
if (!loc) throw new Error("找不到已安装的 Claude Desktop");
module.exports = loc.split("\\").join("/") + "/app/resources/";
