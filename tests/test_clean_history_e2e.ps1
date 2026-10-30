# =====================================================================
#  Campus AutoLogin —— clean_history.ps1 端到端自动化回归测试
# =====================================================================
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$testsDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
$repoRoot = (Resolve-Path (Join-Path $testsDir "..")).Path
Set-Location $repoRoot

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  clean_history.ps1 端到端自动化回归测试" -ForegroundColor Yellow
Write-Host "============================================================" -ForegroundColor Cyan

# 1. 前置条件检查
$originalHead = (git rev-parse HEAD).Trim()
Write-Host "  当前真实仓库 HEAD: $originalHead" -ForegroundColor Gray

# 2. 创建临时独立克隆目录
$tmpClone = Join-Path $env:TEMP ("campus_e2e_" + [System.Guid]::NewGuid().ToString("N"))
Write-Host "  正在克隆仓库至隔离测试目录: $tmpClone ..." -ForegroundColor Cyan
git clone $repoRoot $tmpClone --quiet
if ($LASTEXITCODE -ne 0) {
    Write-Host "  [错误] 克隆失败！" -ForegroundColor Red
    exit 1
}

# 复制当前工作区最新的 clean_history.ps1 进入克隆目录并提交，使测试工作区保持 clean
Copy-Item (Join-Path $repoRoot "clean_history.ps1") $tmpClone -Force
git -C $tmpClone commit -am "test: apply latest clean_history.ps1" --quiet

try {
    $scriptInClone = Join-Path $tmpClone "clean_history.ps1"

    # -------------------------------------------------------------
    # 测试用例 1: 错误密码拦截验证（杜绝假通过与误改动）
    # -------------------------------------------------------------
    Write-Host ""
    Write-Host "  [测试 1/2] 验证【错误密码】前置拦截..." -ForegroundColor Yellow
    $headBeforeTest1 = (git -C $tmpClone rev-parse HEAD).Trim()

    $p1 = Start-Process powershell -ArgumentList "-NoProfile", "-File", "`"$scriptInClone`"", "-Account", "REDACTED_CAMPUS_ACCOUNT", "-Password", "WRONG_NEW_PASSWORD_2026" -NoNewWindow -Wait -PassThru
    
    if ($p1.ExitCode -ne 1) {
        Write-Host "  [失败] 预期退出码为 1，但实际返回 $($p1.ExitCode)" -ForegroundColor Red
        exit 1
    }

    $headAfterTest1 = (git -C $tmpClone rev-parse HEAD).Trim()
    if ($headBeforeTest1 -ne $headAfterTest1) {
        Write-Host "  [失败] 错误密码导致了历史改动！HEAD 发生变化。" -ForegroundColor Red
        exit 1
    }
    Write-Host "  [PASS] 测试 1 通过：错误密码被前置检查拦截（退出码 1），历史 0 改动。" -ForegroundColor Green

    # -------------------------------------------------------------
    # 测试用例 2: 真实旧凭据全流程脱敏与自检验证
    # -------------------------------------------------------------
    Write-Host ""
    Write-Host "  [测试 2/2] 验证【真实旧凭据】清洗全流程与自检..." -ForegroundColor Yellow

    $p2 = Start-Process powershell -ArgumentList "-NoProfile", "-File", "`"$scriptInClone`"", "-Account", "REDACTED_CAMPUS_ACCOUNT", "-Password", "REDACTED_CAMPUS_PASSWORD" -NoNewWindow -Wait -PassThru

    if ($p2.ExitCode -ne 0) {
        Write-Host "  [失败] 正确凭据清洗失败，退出码 $($p2.ExitCode)" -ForegroundColor Red
        exit 1
    }

    # 深度复核克隆库中的全历史 Commit Blob
    $remainPass = (git -C $tmpClone log --all --oneline -SREDACTED_CAMPUS_PASSWORD)
    $remainAcc  = (git -C $tmpClone log --all --oneline -SREDACTED_CAMPUS_ACCOUNT)
    $remainCfg  = (git -C $tmpClone log --all --oneline -- config.json)

    if ($remainPass) {
        Write-Host "  [失败] 历史中仍残留密码记录！" -ForegroundColor Red
        exit 1
    }
    if ($remainAcc) {
        Write-Host "  [失败] 历史中仍残留账号记录！" -ForegroundColor Red
        exit 1
    }
    if ($remainCfg) {
        Write-Host "  [失败] 历史中仍残留 config.json！" -ForegroundColor Red
        exit 1
    }

    Write-Host "  [PASS] 测试 2 通过：全流程成功执行（退出码 0），全历史密码/账号/config.json 残留全部为 0。" -ForegroundColor Green

    # -------------------------------------------------------------
    # 测试用例 3: 确认真实仓库未受任何影响
    # -------------------------------------------------------------
    $realHeadAfter = (git -C $repoRoot rev-parse HEAD).Trim()
    if ($realHeadAfter -ne $originalHead) {
        Write-Host "  [失败] 真实主仓库 HEAD 发生意外变动！" -ForegroundColor Red
        exit 1
    }
    Write-Host ""
    Write-Host "  [PASS] 真实主仓库核验通过：HEAD 保持 $originalHead，未受测试影响。" -ForegroundColor Green

    Write-Host ""
    Write-Host "============================================================" -ForegroundColor Green
    Write-Host "  端到端自动化测试全部通过 (100% SUCCESS)！" -ForegroundColor Green
    Write-Host "============================================================" -ForegroundColor Green
} finally {
    Set-Location $repoRoot
    if (Test-Path $tmpClone) {
        Remove-Item $tmpClone -Recurse -Force -ErrorAction SilentlyContinue
    }
}
