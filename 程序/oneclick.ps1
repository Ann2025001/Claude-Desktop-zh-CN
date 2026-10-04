# 一键汉化：检测 Claude 当前状态，自动选择 全盘汉化 / 在已有汉化上补充 / 只更新外置词典
param([switch]$NoInstall)   # 测试用：只检测和生成，不写入 Claude
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()

$Prog = $PSScriptRoot                                   # 优化版\程序
$Opt = Split-Path -Parent $Prog                         # 优化版
$Pack = Join-Path $Prog "汉化包"                        # 自带的完整汉化包（作者版 + 自己的补充）
$Harvest = Join-Path $Prog "已装译文"                   # 补充模式下从 Claude 里读出的作者译文
$Tool = Join-Path $Prog "工具"                         # 自己的词典和工具
$RuntimeFile = Join-Path $Opt "runtime\dom-zh-CN.js"

function Get-PackVersion([string]$dir) {
    $f = Join-Path $dir "resources\release.json"
    if (-not (Test-Path -LiteralPath $f)) { return $null }
    try { $j = Get-Content -LiteralPath $f -Raw -Encoding UTF8 | ConvertFrom-Json } catch { return $null }
    if ($j.repo -ne "javaht/claude-desktop-zh-cn") { return $null }
    try { return [version]([string]$j.release -replace '[^0-9.]', '') } catch { return $null }
}
function Invoke-Build([string]$authorDir) {
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "没有找到 Node.js，无法生成词典。" }
    $env:CLAUDE_ZH_AUTHOR_DIR = $authorDir
    try { & node (Join-Path $Tool "build.js") runtime (Join-Path $Pack "resources") | Out-Host }
    finally { Remove-Item Env:\CLAUDE_ZH_AUTHOR_DIR -ErrorAction SilentlyContinue }
    if ($LASTEXITCODE -ne 0) { throw "生成词典失败，Claude 没有被改动。" }
}
function Start-Elevated([string]$file, [string[]]$extra) {
    function q($v) { '"' + ([string]$v).Replace('"', '\"') + '"' }
    $argList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (q $file)) + $extra
    $p = Start-Process -FilePath "powershell.exe" -ArgumentList ($argList -join ' ') -WorkingDirectory $Prog -Verb RunAs -Wait -PassThru
    return $p.ExitCode
}

Write-Host "=== 一键汉化（优化版） ===" -ForegroundColor Cyan

# 可选：优化版所在文件夹的上一级里放了更新的作者汉化包，就先同步进自带的汉化包（找不到也没关系）
$root = Split-Path -Parent $Opt
$orig = Join-Path $Pack "作者原版"
$have = if (Test-Path -LiteralPath (Join-Path $orig "release.json")) { [version](((Get-Content -LiteralPath (Join-Path $orig "release.json") -Raw -Encoding UTF8 | ConvertFrom-Json).release) -replace '[^0-9.]', '') } else { $null }
$newer = Get-ChildItem -LiteralPath $root -Recurse -Depth 3 -Filter "release.json" -ErrorAction SilentlyContinue |
    Where-Object { $_.Directory.Name -eq "resources" -and -not $_.FullName.StartsWith($Opt, [System.StringComparison]::OrdinalIgnoreCase) } |
    ForEach-Object { $d = $_.Directory.Parent.FullName; [pscustomobject]@{ Dir = $d; Ver = (Get-PackVersion $d) } } |
    Where-Object { $_.Ver -and (Test-Path -LiteralPath (Join-Path $_.Dir "scripts\install_windows.ps1")) -and (-not $have -or $_.Ver -gt $have) } |
    Sort-Object Ver -Descending | Select-Object -First 1
if ($newer) {
    Write-Host "发现更新的作者汉化包 $($newer.Ver)，同步进自带的汉化包..." -ForegroundColor Cyan
    Get-ChildItem -LiteralPath $newer.Dir -Force | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $Pack -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $orig | Out-Null
    foreach ($f in "resources\frontend-zh-CN.json", "resources\desktop-zh-CN.json", "resources\frontend-hardcoded-zh-CN.json", "resources\release.json", "scripts\install_windows.ps1") {
        Copy-Item -LiteralPath (Join-Path $newer.Dir $f) -Destination (Join-Path $orig (Split-Path -Leaf $f)) -Force
    }
}

# 检测 Claude 当前状态
$loc = (Get-AppxPackage -Name Claude | Select-Object -First 1).InstallLocation
if (-not $loc) { throw "没有找到已安装的 Claude Desktop。" }
$res = Join-Path $loc "app\resources"
$asarText = [System.Text.Encoding]::UTF8.GetString([System.IO.File]::ReadAllBytes((Join-Path $res "app.asar")))
$runtimeLit = $RuntimeFile | ConvertTo-Json -Compress
$hasAuthorDom = $asarText.Contains("/*__claudeZhOnlineLocaleMain*/")
$hasSupplement = $asarText.Contains("/*__claudeZhSupplementMain*/")
$oursFull = $hasAuthorDom -and -not $hasSupplement -and $asarText.Contains("readFileSync($runtimeLit")
$zhInstalled = Test-Path -LiteralPath (Join-Path $res "ion-dist\i18n\zh-CN.json")
$asarText = $null

if (-not $zhInstalled) {
    Write-Host "状态：Claude 还没有汉化 → 全盘汉化" -ForegroundColor Cyan
    Invoke-Build (Join-Path $Pack "作者原版")
    if ($NoInstall) { Write-Host "（测试模式：跳过安装）"; return }
    $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    function q2($v) { '"' + ([string]$v).Replace('"', '\"') + '"' }
    $argList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-NoExit', '-File', (q2 (Join-Path $Pack "scripts\install_windows.ps1")),
        'install', 'zh-CN', '-PatchMode', 'official', '-OriginalUserSid', (q2 $sid), '-OriginalUserProfile', (q2 $env:USERPROFILE),
        '-OriginalAppData', (q2 $env:APPDATA), '-OriginalLocalAppData', (q2 $env:LOCALAPPDATA))
    Start-Process -FilePath "powershell.exe" -ArgumentList ($argList -join ' ') -WorkingDirectory $Pack -Verb RunAs
    Write-Host "已在新窗口开始安装（官方账号模式 + 简体中文），完成后 Claude 会自动重启。" -ForegroundColor Green
}
elseif ($oursFull) {
    Write-Host "状态：已经是优化版 → 更新外置词典" -ForegroundColor Cyan
    Invoke-Build (Join-Path $Pack "作者原版")
    if ($NoInstall) { Write-Host "（测试模式：跳过写入）"; return }
    $same = (Get-FileHash (Join-Path $Pack "resources\frontend-zh-CN.json")).Hash -eq (Get-FileHash (Join-Path $res "ion-dist\i18n\zh-CN.json")).Hash -and
            (Get-FileHash (Join-Path $Pack "resources\desktop-zh-CN.json")).Hash -eq (Get-FileHash (Join-Path $res "zh-CN.json")).Hash
    if (-not $same) {
        Write-Host "词库文件也有更新，需要管理员授权写入..." -ForegroundColor Cyan
        [void](Start-Elevated (Join-Path $Prog "supplement.ps1") @('-PackDir', "`"$Pack`"", '-RuntimeFile', "`"$RuntimeFile`"", '-CatalogsOnly'))
    }
    Write-Host "完成。请完全退出 Claude（托盘图标右键 → 退出）再打开。" -ForegroundColor Green
}
else {
    Write-Host "状态：Claude 已用其他汉化包汉化 → 在它的基础上补充（不重装）" -ForegroundColor Cyan
    # 读出 Claude 里已装的作者译文作为优先来源（已补充过时沿用第一次读出的那份）
    if (-not $hasSupplement -or -not (Test-Path -LiteralPath (Join-Path $Harvest "frontend-zh-CN.json"))) {
        New-Item -ItemType Directory -Force -Path $Harvest | Out-Null
        Copy-Item -LiteralPath (Join-Path $res "ion-dist\i18n\zh-CN.json") -Destination (Join-Path $Harvest "frontend-zh-CN.json") -Force
        if (Test-Path -LiteralPath (Join-Path $res "zh-CN.json")) { Copy-Item -LiteralPath (Join-Path $res "zh-CN.json") -Destination (Join-Path $Harvest "desktop-zh-CN.json") -Force }
    }
    Invoke-Build $Harvest
    if ($NoInstall) { Write-Host "（测试模式：跳过写入）"; return }
    Write-Host "需要管理员授权写入 Claude..." -ForegroundColor Cyan
    [void](Start-Elevated (Join-Path $Prog "supplement.ps1") @('-PackDir', "`"$Pack`"", '-RuntimeFile', "`"$RuntimeFile`""))
}
