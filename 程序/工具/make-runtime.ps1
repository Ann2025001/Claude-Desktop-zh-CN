# 生成外置词典 runtime\dom-zh-CN.js(不需要管理员权限, 不改动 Claude 程序文件)
# 直接调用汉化包安装脚本里的同一套函数, 保证和安装时生成的内容完全一致
param(
    [Parameter(Mandatory = $true)][string]$PackDir,
    [Parameter(Mandatory = $true)][string]$ResourcesPath,
    [Parameter(Mandatory = $true)][string]$RuntimeDir,
    [string]$Language = "zh-CN"
)
$ErrorActionPreference = "Stop"
$ps1 = Join-Path $PackDir "scripts\install_windows.ps1"
$tokens = $null; $errs = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($ps1, [ref]$tokens, [ref]$errs)
if ($errs.Count) { throw "汉化包安装脚本有语法错误: $($errs[0].Message)" }
$scriptsDir = Split-Path $ps1
foreach ($name in 'Get-OnlineDomTranslationScript', 'Get-OnlineTranslationMap', 'Get-FrontendHardcodedReplacements', 'Test-OnlineDomTranslationEntry', 'Require-File') {
    $fn = $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name }, $true) | Select-Object -First 1
    if (-not $fn) { throw "汉化包安装脚本里找不到函数 $name" }
    # 函数里用 $PSScriptRoot 找汉化包目录, 这里指向汉化包自己的 scripts 文件夹
    Invoke-Expression ($fn.Extent.Text -replace '\$PSScriptRoot', "'$scriptsDir'")
}
$OnlineTranslationMaxSourceLength = 1000
$pack = @{ Frontend = (Join-Path $PackDir "resources\frontend-$Language.json") }
$map = Get-OnlineTranslationMap $ResourcesPath $pack $Language
$js = Get-OnlineDomTranslationScript $Language $map
$runtimeDir = $RuntimeDir
New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
$out = Join-Path $runtimeDir "dom-$Language.js"
[System.IO.File]::WriteAllText($out, $js, (New-Object System.Text.UTF8Encoding $false))
Write-Host "已更新外置词典: $out ($($map.Count) 条整句 + 规则)。重启 Claude 即生效。" -ForegroundColor Green
