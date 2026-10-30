# =====================================================================
#  Campus AutoLogin —— Git 历史敏感凭据清洗工具
#  注意：在执行本脚本前，请务必先登录校园网自助服务网站修改一次密码！
# =====================================================================
[CmdletBinding()]
param(
    [string]$Account,
    [string]$Password,
    [switch]$UseConfigFile,
    [switch]$ForcePush
)

$ErrorActionPreference = "Stop"
try {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    [Console]::InputEncoding  = [System.Text.Encoding]::UTF8
} catch {}
$here = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
Set-Location $here

# ---------------------------------------------------------------------
# Git 原生命令执行包装函数
# 解决 PowerShell 5.1 下原生命令输出到 stderr 触发终止性异常的问题
# ---------------------------------------------------------------------
function Invoke-Git {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$GitArgs,
        [switch]$AllowFail
    )
    $prevEAP = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $out = & git @GitArgs 2>&1
        $code = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $prevEAP
    }
    if ($code -ne 0 -and -not $AllowFail) {
        $msg = if ($out) { ($out | Out-String).Trim() } else { "退出码 $code" }
        throw "git $($GitArgs -join ' ') 执行失败 (退出码 $code): $msg"
    }
    return $out
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Red
Write-Host "  Campus AutoLogin - Git 历史敏感凭据清洗脚本" -ForegroundColor Yellow
Write-Host "============================================================" -ForegroundColor Red
Write-Host ""
Write-Host "  [重要前置要求]" -ForegroundColor Cyan
Write-Host "  无论是否清理 Git 历史，请确认已在学校校园网门户修改过个人密码！" -ForegroundColor Yellow
Write-Host "  只有在网关端废弃旧密码，才能彻底消除泄露风险。"
Write-Host ""

# 0. 工作区干净性预检（放宽未跟踪文件，只检查已跟踪文件的修改/暂存）
$dirty = Invoke-Git @('status', '--porcelain', '--untracked-files=no') -AllowFail
if ($dirty) {
    Write-Host "  [错误] 检测到已跟踪文件有未提交的修改，git filter-repo 要求干净工作区。" -ForegroundColor Red
    Write-Host "         请先提交、暂存或放弃工作区修改后再运行本脚本。" -ForegroundColor Yellow
    Write-Host ""
    exit 1
}

# 1. 检查 git-filter-repo 工具
$hasTool = $false
if (Get-Command "git-filter-repo" -ErrorAction SilentlyContinue) {
    $hasTool = $true
} else {
    try {
        $pyCheck = Start-Process python -ArgumentList "-m git_filter_repo --version" -NoNewWindow -Wait -PassThru -ErrorAction Stop
        if ($pyCheck.ExitCode -eq 0) {
            $hasTool = $true
        }
    } catch {
        $hasTool = $false
    }
}
if (-not $hasTool) {
    Write-Host "  [错误] 未检测到 git-filter-repo 工具。" -ForegroundColor Red
    Write-Host "  请先在终端运行以下命令安装后重试:" -ForegroundColor Yellow
    Write-Host "      pip install git-filter-repo" -ForegroundColor White
    Write-Host ""
    exit 1
}

# 2. 运行时获取需要脱敏的凭据（不将任何明文写入脚本自身）
if ($UseConfigFile -and (-not $Account -or -not $Password)) {
    $cfg = Join-Path $here "config.json"
    if (Test-Path $cfg) {
        try {
            $o = Get-Content $cfg -Raw -Encoding UTF8 | ConvertFrom-Json
            if (-not $Account -and $o.username) { $Account = [string]$o.username }
            if (-not $Account -and $o.account)  { $Account = [string]$o.account }
            if (-not $Password -and $o.password) { $Password = [string]$o.password }
            Write-Host "  [提示] 已从本地 config.json 读取凭据作为清洗目标。" -ForegroundColor Cyan
        } catch {}
    }
}

if (-not $Account) {
    $Account = (Read-Host "请输入【历史中泄露的旧账号/手机号】（直接回车可跳过）").Trim()
}

if (-not $Password) {
    $secPass = Read-Host "请输入【历史中泄露的旧密码】（掩码安全输入，回车退出）" -AsSecureString
    if ($secPass) {
        $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secPass)
        try {
            $Password = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr).Trim()
        } finally {
            [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
        }
    }
}

if ([string]::IsNullOrWhiteSpace($Account) -and [string]::IsNullOrWhiteSpace($Password)) {
    Write-Host "  [错误] 未提供需要抹除的历史旧账号或旧密码，已取消操作。" -ForegroundColor Red
    Write-Host ""
    exit 1
}

# 3. 前置存在性检查：确保输入的凭据真实存在于 Git 历史中，杜绝空转与误报
Write-Host "  [1/4] 执行前置定位检查（确认凭据真实存在于历史提交中）..." -ForegroundColor Green
if (-not [string]::IsNullOrWhiteSpace($Password)) {
    $prePass = Invoke-Git @('log', '--all', '--oneline', "-S$Password") -AllowFail
    if (-not $prePass) {
        Write-Host "  [错误] 目标旧密码在 Git 全历史中未找到任何匹配记录！" -ForegroundColor Red
        Write-Host "         可能原因：您输入的是新密码，或密码拼写有误。" -ForegroundColor Yellow
        Write-Host "         脚本必须在历史中检索到泄露记录才可执行清洗。尚未改动任何历史，已安全终止。" -ForegroundColor Yellow
        Write-Host ""
        exit 1
    }
    Write-Host "  [OK] 已在 Git 历史中精确定位到旧密码记录。" -ForegroundColor Green
}
if (-not [string]::IsNullOrWhiteSpace($Account)) {
    $preAcc = Invoke-Git @('log', '--all', '--oneline', "-S$Account") -AllowFail
    if (-not $preAcc) {
        Write-Host "  [错误] 目标旧账号在 Git 全历史中未找到任何匹配记录！" -ForegroundColor Red
        Write-Host "         可能原因：账号拼写有误。尚未改动任何历史，已安全终止。" -ForegroundColor Yellow
        Write-Host ""
        exit 1
    }
    Write-Host "  [OK] 已在 Git 历史中精确定位到旧账号记录。" -ForegroundColor Green
}

# 4. 动态生成临时脱敏规则文件并执行重写
Write-Host "  [2/4] 开始重写 Git 历史对象（脱敏账号密码并移除历史 config.json）..." -ForegroundColor Green
$rules = [System.Collections.Generic.List[string]]::new()
if (-not [string]::IsNullOrWhiteSpace($Password)) {
    $rules.Add("${Password}==>REDACTED_CAMPUS_PASSWORD")
}
if (-not [string]::IsNullOrWhiteSpace($Account)) {
    $rules.Add("${Account}==>REDACTED_CAMPUS_ACCOUNT")
}

$rulesFile = Join-Path $env:TEMP ("campus_filter_rules_" + [System.Guid]::NewGuid().ToString("N") + ".txt")
$rules | Set-Content -Path $rulesFile -Encoding ASCII

try {
    Invoke-Git @('filter-repo', '--replace-text', $rulesFile, '--path', 'config.json', '--invert-paths', '--force')
    Write-Host "  [OK] 历史对象重写完成。" -ForegroundColor Green
} finally {
    if (Test-Path $rulesFile) { Remove-Item $rulesFile -Force -ErrorAction SilentlyContinue }
}

# 5. 清洗后自检：多层校验确保目标彻底归零且无遗留明文凭据
Write-Host "  [3/4] 执行清洗后多维度自检..." -ForegroundColor Green

# 5.1 目标凭据归零校验
foreach ($secret in @($Password, $Account)) {
    if ([string]::IsNullOrWhiteSpace($secret)) { continue }
    $hits = Invoke-Git @('log', '--all', '--oneline', "-S$secret") -AllowFail
    if ($hits) {
        $count = ($hits | Measure-Object).Count
        Write-Host ""
        Write-Host "  [严重错误] 清洗自检失败！历史中仍检出 $count 处凭据残留！" -ForegroundColor Red
        Write-Host "             尚未推送到远端，本次清洗已终止。请排查后重试。" -ForegroundColor Yellow
        Write-Host ""
        exit 1
    }
}

# 5.2 config.json 历史移除校验
$cfgHits = Invoke-Git @('log', '--all', '--oneline', '--', 'config.json') -AllowFail
if ($cfgHits) {
    Write-Host ""
    Write-Host "  [严重错误] 清洗自检失败！历史中仍残留 config.json！已终止推送。" -ForegroundColor Red
    Write-Host ""
    exit 1
}

# 5.3 全历史代码凭据模式扫描（动态收集合法占位符，强制要求 PCRE 环视引擎）
$pcreCheck = Invoke-Git @('grep', '-P', '-q', '^$', 'HEAD') -AllowFail
if ($LASTEXITCODE -ne 0 -and ($pcreCheck -match "cannot use Perl-compatible regexes" -or $pcreCheck -match "PCRE")) {
    Write-Host "  [错误] 当前 Git 环境不支持 PCRE (-P)，无法执行精确的历史凭据扫描。" -ForegroundColor Red
    Write-Host "         请安装或升级官方 Git for Windows 后重试（自检宁可失败也不放过疑似泄露）。" -ForegroundColor Yellow
    Write-Host ""
    exit 1
}

$benignTokens = [System.Collections.Generic.List[string]]::new()
foreach ($item in @('123', '你的密码', '校园网密码', 'REDACTED', 'example')) {
    $benignTokens.Add($item)
}
$exampleCfg = Join-Path $here "config.example.json"
if (Test-Path $exampleCfg) {
    try {
        $exJson = Get-Content $exampleCfg -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($exJson._password) { $benignTokens.Add([string]$exJson._password) }
        if ($exJson.password)  { $benignTokens.Add([string]$exJson.password) }
    } catch {}
}
$tokenPattern = ($benignTokens | Sort-Object -Unique | Where-Object { $_ } | ForEach-Object { [regex]::Escape($_) }) -join '|'
$credPat = "(?<![a-zA-Z0-9_])password[`"']?[[:space:]]*[:=][[:space:]]*[`"'](?!$tokenPattern)[^`"']{3,}[`"']"

$leak = @()
foreach ($rev in (Invoke-Git @('rev-list', '--all'))) {
    $hit = Invoke-Git @('grep', '-i', '-l', '-P', $credPat, $rev) -AllowFail
    if ($hit) { $leak += $hit }
}
$leak = $leak | Sort-Object -Unique
if ($leak.Count -gt 0) {
    Write-Host ""
    Write-Host "  [严重错误] 历史中仍检出 $($leak.Count) 处疑似凭据残留，尚未推送，已终止：" -ForegroundColor Red
    $leak | Select-Object -First 5 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
    Write-Host ""
    exit 1
}
Write-Host "  [OK] 自检全部通过：全历史目标归零、config.json 已抹除、无凭据字面量残留。" -ForegroundColor Green

# 6. 幂等恢复远程 origin（避免 git remote remove origin 在不存在时报错）
Write-Host "  [4/4] 重新绑定远程仓库 origin 并准备推送..." -ForegroundColor Green
$originUrl = "https://github.com/shiro1888/campus-autologin.git"
$remotes = Invoke-Git @('remote') -AllowFail
if ($remotes -contains 'origin') {
    Invoke-Git @('remote', 'set-url', 'origin', $originUrl)
} else {
    Invoke-Git @('remote', 'add', 'origin', $originUrl)
}

# 7. 远程推送
if ($ForcePush) {
    Write-Host "  正在推送分支与标签..." -ForegroundColor Yellow
    Invoke-Git @('push', 'origin', '--force', '--all')
    Invoke-Git @('push', 'origin', '--force', '--tags')
    Write-Host "  [完成] 远程 Git 历史已彻底更新并覆盖。" -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "  本地历史已完成清洗并通过全量自检！请执行以下命令完成强制推送:" -ForegroundColor Cyan
    Write-Host "      git push origin --force --all" -ForegroundColor White
    Write-Host "      git push origin --force --tags" -ForegroundColor White
    Write-Host ""
    Write-Host "  （提示: 下次可直接带 -ForcePush 参数一键推送）" -ForegroundColor Gray
}
Write-Host ""
