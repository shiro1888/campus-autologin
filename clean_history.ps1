# =====================================================================
#  Campus AutoLogin —— Git 历史敏感凭据清洗工具
#  注意：在执行本脚本前，请务必先登录校园网自助服务网站修改一次密码！
# =====================================================================
[CmdletBinding()]
param(
    [string]$Account,
    [string]$Password,
    [switch]$ForcePush
)

$ErrorActionPreference = "Stop"
$here = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
Set-Location $here

Write-Host ""
Write-Host "============================================================" -ForegroundColor Red
Write-Host "  Campus AutoLogin - Git 历史敏感凭据清洗脚本" -ForegroundColor Yellow
Write-Host "============================================================" -ForegroundColor Red
Write-Host ""
Write-Host "  [重要前置要求]" -ForegroundColor Cyan
Write-Host "  无论是否清理 Git 历史，请确认已在学校校园网门户修改过个人密码！" -ForegroundColor Yellow
Write-Host "  只有在网关端废弃旧密码，才能彻底消除泄露风险。"
Write-Host ""

# 0. 工作区干净性预检（git-filter-repo 必须要求工作区干净）
$dirty = git status --porcelain
if ($dirty) {
    Write-Host "  [错误] 检测到工作区有未提交或未保存的修改，git filter-repo 要求干净工作区。" -ForegroundColor Red
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
if (-not $Account -or -not $Password) {
    $cfg = Join-Path $here "config.json"
    if (Test-Path $cfg) {
        try {
            $o = Get-Content $cfg -Raw -Encoding UTF8 | ConvertFrom-Json
            if (-not $Account -and $o.username) { $Account = [string]$o.username }
            if (-not $Account -and $o.account)  { $Account = [string]$o.account }
            if (-not $Password -and $o.password) { $Password = [string]$o.password }
        } catch {}
    }
}

if (-not $Account) {
    $Account = (Read-Host "请输入需从历史中抹除的校园网账号/手机号（回车可跳过）").Trim()
}
if (-not $Password) {
    $Password = (Read-Host "请输入需从历史中抹除的校园网密码（回车退出）").Trim()
}

if ([string]::IsNullOrWhiteSpace($Account) -and [string]::IsNullOrWhiteSpace($Password)) {
    Write-Host "  [错误] 未提供需要抹除的账号或密码，已取消操作。" -ForegroundColor Red
    Write-Host ""
    exit 1
}

# 3. 动态生成临时脱敏规则文件
$rules = [System.Collections.Generic.List[string]]::new()
if (-not [string]::IsNullOrWhiteSpace($Password)) {
    $rules.Add("${Password}==>REDACTED_CAMPUS_PASSWORD")
}
if (-not [string]::IsNullOrWhiteSpace($Account)) {
    $rules.Add("${Account}==>REDACTED_CAMPUS_ACCOUNT")
}

$rulesFile = Join-Path $env:TEMP ("campus_filter_rules_" + [System.Guid]::NewGuid().ToString("N") + ".txt")
$rules | Set-Content -Path $rulesFile -Encoding ASCII

Write-Host "  [1/3] 开始重写 Git 历史对象（脱敏账号密码并移除历史 config.json）..." -ForegroundColor Green
try {
    git filter-repo --replace-text $rulesFile --path config.json --invert-paths --force
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  [错误] git filter-repo 重写历史失败，退出码: $LASTEXITCODE" -ForegroundColor Red
        exit $LASTEXITCODE
    }
    Write-Host "  [OK] 历史对象重写完成。" -ForegroundColor Green
} finally {
    if (Test-Path $rulesFile) { Remove-Item $rulesFile -Force -ErrorAction SilentlyContinue }
}

# 4. 幂等恢复远程 origin
Write-Host "  [2/3] 重新绑定远程仓库 origin..." -ForegroundColor Green
git remote remove origin 2>$null
git remote add origin https://github.com/shiro1888/campus-autologin.git
if ($LASTEXITCODE -ne 0) {
    Write-Host "  [错误] 重新绑定远程仓库 origin 失败，退出码: $LASTEXITCODE" -ForegroundColor Red
    exit $LASTEXITCODE
}

# 5. 远程推送
Write-Host "  [3/3] 准备强制推送到远程 GitHub 仓库..." -ForegroundColor Green
if ($ForcePush) {
    Write-Host "  正在推送分支与标签..." -ForegroundColor Yellow
    git push origin --force --all
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  [错误] 强制推送分支失败，退出码: $LASTEXITCODE" -ForegroundColor Red
        exit $LASTEXITCODE
    }
    git push origin --force --tags
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  [错误] 强制推送标签失败，退出码: $LASTEXITCODE" -ForegroundColor Red
        exit $LASTEXITCODE
    }
    Write-Host "  [完成] 远程 Git 历史已彻底更新并覆盖。" -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "  本地历史已完成清洗！请执行以下命令完成强制推送:" -ForegroundColor Cyan
    Write-Host "      git push origin --force --all" -ForegroundColor White
    Write-Host "      git push origin --force --tags" -ForegroundColor White
    Write-Host ""
    Write-Host "  （提示: 下次可直接带 -ForcePush 参数一键推送）" -ForegroundColor Gray
}
Write-Host ""
