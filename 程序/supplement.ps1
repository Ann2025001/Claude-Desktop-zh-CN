# 补充模式：Claude 已被汉化（作者汉化包或本优化版）时，在现有汉化基础上补充，不重装
# 使用汉化包安装脚本里的同一套函数（写词库、修补前端文字、写回 app.asar 并同步 Claude.exe 校验值）
param(
    [Parameter(Mandatory = $true)][string]$PackDir,     # 程序\汉化包
    [Parameter(Mandatory = $true)][string]$RuntimeFile, # 外置词典文件
    [switch]$CatalogsOnly,                              # 只更新词库文件（本优化版已注入时）
    [switch]$DryRun,                                    # 只检查，不写入
    [switch]$NoPause
)
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$Language = "zh-CN"; $LanguageCode = "zh-CN"
$SupplementStart = "/*__claudeZhSupplementStart*/"
$SupplementMarker = "/*__claudeZhSupplementMain*/"

try {
    # 1. 载入汉化包安装脚本里的函数和全局变量（不执行它的主流程）
    $ps1 = Join-Path $PackDir "scripts\install_windows.ps1"
    $scriptsDir = Split-Path $ps1
    $tokens = $null; $errs = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($ps1, [ref]$tokens, [ref]$errs)
    if ($errs.Count) { throw "汉化包安装脚本有语法错误：$($errs[0].Message)" }
    foreach ($st in $ast.EndBlock.Statements) {
        if ($st -is [System.Management.Automation.Language.FunctionDefinitionAst] -or $st -is [System.Management.Automation.Language.AssignmentStatementAst]) {
            . ([scriptblock]::Create(($st.Extent.Text -replace '\$PSScriptRoot', "'$scriptsDir'")))
        }
    }

    $loc = (Get-AppxPackage -Name Claude | Select-Object -First 1).InstallLocation
    if (-not $loc) { throw "找不到 Claude 的安装位置" }
    $res = Join-Path $loc "app\resources"
    $packRes = Join-Path $PackDir "resources"
    Write-Host "Claude 资源目录：$res"

    # 2. 词库文件：作者译文优先、自己的补译填空（合并结果已由 build.js 生成在汉化包 resources 里）
    Write-Host "[词库] 更新中文词库文件..." -ForegroundColor Cyan
    $copies = @(
        @((Join-Path $packRes "frontend-zh-CN.json"), (Join-Path $res "ion-dist\i18n\zh-CN.json"), $false),
        @((Join-Path $packRes "desktop-zh-CN.json"), (Join-Path $res "zh-CN.json"), $false),
        @((Join-Path $packRes "desktop-en-US-override-zh-CN.json"), (Join-Path $res "en-US.json"), $true)
    )
    foreach ($c in $copies) {
        if ($DryRun) { Write-Host "  （检查模式）将写入 $($c[1])"; continue }
        if ($c[2]) { Backup-ModifiedFile $res $c[1] }   # en-US.json 先进汉化包的备份，卸载时还原
        Copy-Item -LiteralPath $c[0] -Destination $c[1] -Force
        Write-Host "  已写入 $($c[1])" -ForegroundColor Green
    }
    if ($CatalogsOnly) { Write-Host "完成。" -ForegroundColor Green; return }

    # 3. 前端代码里写死的英文：用汉化包自己的替换函数，按补充后的词表再跑一遍（已替换过的不会重复替换）
    if (-not $DryRun) {
        Write-Host "[前端] 补充写死在前端代码里的文字..." -ForegroundColor Cyan
        Patch-HardcodedFrontendStrings $res $Language
    }

    # 4. 网页翻译：在作者注入的翻译代码之后，加一段独立的补充代码（读外置词典）
    Write-Host "[网页] 检查作者的网页翻译..." -ForegroundColor Cyan
    $asarPath = Join-Path $res "app.asar"
    $data = [System.IO.File]::ReadAllBytes($asarPath)
    $parsed = Read-AsarHeader $data $asarPath
    $target = Resolve-MainProcessAsarTarget $data $parsed["HeaderSize"] $parsed["Header"]
    $entry = Get-AsarFileEntry $parsed["Header"] $target
    $off = [int64](8 + $parsed["HeaderSize"] + [int64]$entry.offset)
    $text = [System.Text.Encoding]::UTF8.GetString($data, [int]$off, [int]$entry.size)

    $authorMarker = "/*$OnlineLocaleMainMarker*/"
    $mi = $text.IndexOf($authorMarker, [System.StringComparison]::Ordinal)
    if ($mi -lt 0) {
        Write-Host "  当前汉化没有网页翻译（安装时选的是 Cowork 兼容 / API 模式），按你的选择不改动 app.asar。" -ForegroundColor DarkYellow
        Write-Host "完成。请完全退出 Claude 再打开。" -ForegroundColor Green
        return
    }
    # 去掉旧的补充代码（再次运行时）
    $si = $text.IndexOf($SupplementStart, [System.StringComparison]::Ordinal)
    if ($si -ge 0) {
        $se = $text.IndexOf($SupplementMarker, $si, [System.StringComparison]::Ordinal)
        if ($se -lt 0) { throw "找到旧补充代码的开头但找不到结尾，为安全起见停止。" }
        $text = $text.Substring(0, $si) + $text.Substring($se + $SupplementMarker.Length)
        $mi = $text.IndexOf($authorMarker, [System.StringComparison]::Ordinal)
    }
    # 作者注入代码的接收对象名和语句分隔符（与汉化包写入的格式一致）
    $hooks = [regex]::Matches($text.Substring(0, $mi), '(?<recv>[A-Za-z_$][A-Za-z0-9_$]*)\.webContents\.on\((?<q>["''`])dom-ready\k<q>,')
    if ($hooks.Count -eq 0) { throw "找不到作者的网页翻译注入点，为安全起见停止。" }
    $recv = $hooks[$hooks.Count - 1].Groups["recv"].Value
    $term = $text.Substring($mi - 1, 1)
    if ($term -ne ";" -and $term -ne ",") { throw "作者注入代码的结尾格式和预期不同（'$term'），为安全起见停止。" }
    $pathLit = $RuntimeFile | ConvertTo-Json -Compress
    $code = $SupplementStart + $recv + '.webContents.on("dom-ready",()=>{' + $recv + '.webContents.executeJavaScript((()=>{try{return require("fs").readFileSync(' + $pathLit + ',"utf8")}catch(e){return ""}})()).catch(()=>{})})' + $term + $SupplementMarker
    $insertAt = $mi + $authorMarker.Length
    $patched = $text.Substring(0, $insertAt) + $code + $text.Substring($insertAt)
    Write-Host "  将在作者的翻译代码之后加入补充代码（接收对象 $recv，读取 $RuntimeFile）"

    if ($DryRun) {
        $tmp = Join-Path $env:TEMP "claude-zh-main-check.js"
        [System.IO.File]::WriteAllText($tmp, $patched, (New-Object System.Text.UTF8Encoding $false))
        Write-Host "  （检查模式）补充后的主程序代码已写到 $tmp"
        return
    }
    $changed = Replace-AsarFileContent $res $target ([System.Text.Encoding]::UTF8.GetBytes($patched))
    if ($changed) { Write-Host "  已加入补充代码，并同步了 Claude.exe 的校验值" -ForegroundColor Green }
    else { Write-Host "  补充代码已是最新" -ForegroundColor Green }
    Write-Host ""
    Write-Host "完成。请完全退出 Claude（托盘图标右键 → 退出）再打开。" -ForegroundColor Green
}
catch {
    Write-Host ""
    Write-Host "[错误] $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Claude 的文件没有被改坏：出错前的步骤都是完整写入的，可以重新运行一键汉化。" -ForegroundColor DarkYellow
    $global:LASTEXITCODE = 1
}
finally {
    if (-not $NoPause -and -not $DryRun) { [void](Read-Host "按 Enter 关闭此窗口") }
}
