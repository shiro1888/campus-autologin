# =====================================================================
#  Campus AutoLogin —— Git 历史敏感凭据清洗工具
#  注意：在执行本脚本前，请务必先登录校园网自助服务网站修改一次密码！
# =====================================================================
[CmdletBinding()]
param(
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

# 1. 检查 git-filter-repo 工具
$filterRepoCheck = Get-Command "git-filter-repo" -ErrorAction SilentlyContinue
if (-not $filterRepoCheck) {
    # 尝试 python 模块方式
    $pyCheck = Start-Process python -ArgumentList "-m git_filter_repo --version" -NoNewWindow -Wait -PassThru -ErrorAction SilentlyContinue
    if ($pyCheck.ExitCode -ne 0) {
        Write-Host "  [错误] 未检测到 git-filter-repo 工具。" -ForegroundColor Red
        Write-Host "  请先在终端运行以下命令安装后重试:" -ForegroundColor Yellow
        Write-Host "      pip install git-filter-repo" -ForegroundColor White
        Write-Host ""
        exit 1
    }
}

# 2. 生成临时脱敏替换规则
$rulesFile = Join-Path $env:TEMP "campus_filter_rules.txt"
@(
    "REDACTED_CAMPUS_PASSWORD==>REDACTED_CAMPUS_PASSWORD",
    "REDACTED_CAMPUS_ACCOUNT==>REDACTED_CAMPUS_ACCOUNT"
) | Set-Content -Path $rulesFile -Encoding ASCII

Write-Host "  [1/3] 开始重写 Git 历史对象（脱敏账号密码并移除历史 config.json）..." -ForegroundColor Green
try {
    git filter-repo --replace-text $rulesFile --path config.json --invert-paths --force
    Write-Host "  [OK] 历史对象重写完成。" -ForegroundColor Green
} finally {
    if (Test-Path $rulesFile) { Remove-Item $rulesFile -Force -ErrorAction SilentlyContinue }
}

# 3. 幂等恢复远程 origin
Write-Host "  [2/3] 重新绑定远程仓库 origin..." -ForegroundColor Green
git remote remove origin 2>$null
git remote add origin https://github.com/shiro1888/campus-autologin.git

# 4. 远程推送
Write-Host "  [3/3] 准备强制推送到远程 GitHub 仓库..." -ForegroundColor Green
if ($ForcePush) {
    Write-Host "  正在推送分支与标签..." -ForegroundColor Yellow
    git push origin --force --all
    git push origin --force --tags
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
