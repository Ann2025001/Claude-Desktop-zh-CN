# 词典与构建工具（维护者用）

普通使用只需双击仓库根目录的 `一键汉化.bat`。本文件夹是生成词典用的工具和全部补充翻译，需要 Node.js。

## 命令

```bash
node build.js status     # 覆盖率
node build.js check      # 校验补译（ICU 参数、标签）
node build.js pack       # 合并词典，写入 ../汉化包/resources，并给作者安装脚本打补丁
node build.js runtime    # pack + 重新生成外置词典 <仓库>/runtime/dom-zh-CN.js（重启 Claude 生效）
node test-rules.js       # 页面规则抽样测试
node test-menus.js       # 菜单 / 托盘文字覆盖检查
node probe.js "文字"     # 在 Claude 程序里查某段文字的上下文（只读）
node slash-commands.js   # 从本机 Claude Code 提取斜杠命令说明（输出不入库）
```

## 翻译从哪里来（优先级从高到低）

1. `supplement/fixes/`：少量修正（如套餐名保留 Pro / Max）
2. 作者译文：补充模式下是从 Claude 里读出的已装译文，否则是 `../汉化包/作者原版/`
3. `supplement/frontend/`、`supplement/desktop/`：自己的补译，只填作者没翻的
4. 其他历史来源（本机有才用）

另外：
- `supplement/hardcoded.json`：写死在前端代码里的文字（按汉化包原有方式替换）
- `supplement/dom*.json`：只在页面显示层整句替换的文字（服务器下发的等）
- `supplement/patterns.json`：带数字 / 日期的短句规则
- 术语统一：Artifacts→作品、Cowork→协作、Skills→技能、Hooks→钩子（见 `build.js` 的 `TERMS`）

## 对作者安装脚本的修正（`pack` 自动应用，原文件保存在 `作者原版/`）

- 翻译表改为区分大小写（原来 "This computer" 会被 "this computer" 覆盖，数百条常用词失效）
- 原有日期规则只替换 `$1`，导致 "$2年9月25日"
- 加入变量句规则和匹配函数（`pattern-engine.js`）
- 菜单 / 托盘：主程序语言会被在线页面同步回 en-US，安装时用中文版覆盖 `en-US.json`（原版由汉化包备份，卸载时还原）
- 外置词典：安装时把翻译脚本另存到 `runtime/`，主程序每次页面加载先读它，读不到用内置的一份
