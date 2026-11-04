# =====================================================================
#  Campus AutoLogin —— clean_history.ps1 端到端自动化回归测试
#  注意：本脚本不包含任何硬编码真实凭据，通过环境变量安全注入测试。
# =====================================================================
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
try {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    [Console]::InputEncoding  = [System.Text.Encoding]::UTF8
} catch {}
$testsDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
$repoRoot = (Resolve-Path (Join-Path $testsDir "..")).Path
Set-Location $repoRoot

# Windows PowerShell 5.1 的 Start-Process 在构造子进程环境时，若环境变量存在
# 「仅大小写不同」的重复键（如代理工具同时注入 HTTP_PROXY 与 http_proxy），会抛
# "Item has already been added" 直接中断测试。此处仅在本测试进程内归一化：
# 读取值 -> 删除全部变体 -> 用大写规范名写回。不改系统/用户环境变量，值也不丢失。
try {
    $rawEnv = [System.Environment]::GetEnvironmentVariables()
    $dupGroups = @($rawEnv.Keys | Group-Object { $_.ToLowerInvariant() } | Where-Object { $_.Count -gt 1 })
    foreach ($g in $dupGroups) {
        $canonical = $g.Name.ToUpperInvariant()
        $val = [System.Environment]::GetEnvironmentVariable($g.Name)
        foreach ($name in $g.Group) {
            [System.Environment]::SetEnvironmentVariable($name, $null, 'Process')
        }
        if ($null -ne $val) {
            [System.Environment]::SetEnvironmentVariable($canonical, $val, 'Process')
        }
    }
    if ($dupGroups.Count -gt 0) {
        Write-Host "  [环境] 已归一化 $($dupGroups.Count) 组大小写重复环境变量（PowerShell 5.1 兼容）。" -ForegroundColor Gray
    }
} catch {
    # 归一化失败不阻断测试；若 Start-Process 仍失败，会由后续强断言明确暴露。
}

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  clean_history.ps1 端到端自动化回归测试" -ForegroundColor Yellow
Write-Host "============================================================" -ForegroundColor Cyan

# 1. 前置条件检查
$originalHead = (git rev-parse HEAD).Trim()
Write-Host "  当前真实仓库 HEAD: $originalHead" -ForegroundColor Gray

# 2. 创建临时独立克隆目录（全隔离测试，绝不污染主仓库）
$tmpClone = Join-Path $env:TEMP ("campus_e2e_" + [System.Guid]::NewGuid().ToString("N"))
Write-Host "  正在克隆仓库至隔离测试目录: $tmpClone ..." -ForegroundColor Cyan
git clone $repoRoot $tmpClone --quiet
if ($LASTEXITCODE -ne 0) {
    Write-Host "  [错误] 克隆失败！" -ForegroundColor Red
    exit 1
}

try {
    $scriptInClone = Join-Path $tmpClone "clean_history.ps1"
    $skippedTests = 0

    # -------------------------------------------------------------
    # 测试用例 1: 错误密码拦截验证（杜绝假通过与误改动）
    # 动态生成随机 GUID 凭据，确保历史中绝对不存在该字符串，且强断言输出原因
    # -------------------------------------------------------------
    Write-Host ""
    Write-Host "  [测试 1/2] 验证【错误密码】前置拦截与强断言..." -ForegroundColor Yellow
    $headBeforeTest1 = (git -C $tmpClone rev-parse HEAD).Trim()
    $fakePassword = "NONEXISTENT_PASS_" + [System.Guid]::NewGuid().ToString("N")
    $fakeAccount  = "NONEXISTENT_ACC_"  + [System.Guid]::NewGuid().ToString("N")

    $p1 = Start-Process powershell -ArgumentList "-NoProfile", "-File", "`"$scriptInClone`"", "-Account", "`"$fakeAccount`"", "-Password", "`"$fakePassword`"" -NoNewWindow -Wait -PassThru -RedirectStandardOutput (Join-Path $tmpClone "test1_stdout.txt") -RedirectStandardError (Join-Path $tmpClone "test1_stderr.txt")
    
    $out1 = if (Test-Path (Join-Path $tmpClone "test1_stdout.txt")) { Get-Content (Join-Path $tmpClone "test1_stdout.txt") -Raw -Encoding UTF8 } else { "" }
    
    # 强断言 A: 退出码必须严格为 1
    if ($p1.ExitCode -ne 1) {
        Write-Host "  [失败] 预期退出码为 1，但实际返回 $($p1.ExitCode)" -ForegroundColor Red
        exit 1
    }

    # 强断言 B: 必须是被「前置旧密码记录定位失败」拦截，而非被工作区脏检查或其它意外拦截
    if ($out1 -notmatch "目标旧密码在 Git 全历史中未找到任何匹配记录") {
        Write-Host "  [失败] 退出码虽为 1，但并非由旧密码前置检查拦截！输出内容:" -ForegroundColor Red
        Write-Host $out1 -ForegroundColor DarkGray
        exit 1
    }

    # 强断言 C: 历史对象绝对不能有任何修改
    $headAfterTest1 = (git -C $tmpClone rev-parse HEAD).Trim()
    if ($headBeforeTest1 -ne $headAfterTest1) {
        Write-Host "  [失败] 错误密码导致了历史改动！HEAD 发生变化。" -ForegroundColor Red
        exit 1
    }
    Write-Host "  [PASS] 测试 1 通过：错误密码被前置检查拦截（退出码 1，匹配预期拦截），历史 0 改动。" -ForegroundColor Green

    # -------------------------------------------------------------
    # 测试用例 2: 真实旧凭据全流程脱敏与自检验证
    # 依赖环境变量 CAMPUS_LEAKED_PASSWORD 与 CAMPUS_LEAKED_ACCOUNT
    # -------------------------------------------------------------
    Write-Host ""
    Write-Host "  [测试 2/2] 验证【真实旧凭据】清洗全流程与多重自检..." -ForegroundColor Yellow

    $realPass = $env:CAMPUS_LEAKED_PASSWORD
    $realAcc  = $env:CAMPUS_LEAKED_ACCOUNT

    if (-not $realPass -or -not $realAcc) {
        $skippedTests++
        Write-Host "  [SKIP] 未设置环境变量 CAMPUS_LEAKED_PASSWORD / CAMPUS_LEAKED_ACCOUNT。" -ForegroundColor Yellow
        Write-Host "         跳过依赖真实泄露凭据的重写用例（在历史已清洗干净的环境中，此为预期行为）。" -ForegroundColor Yellow
    } else {
        # 先确认克隆库历史中是否存在该旧凭据
        $preCheckHits = (git -C $tmpClone log --all --oneline "-S$realPass")
        if (-not $preCheckHits) {
            $skippedTests++
            Write-Host "  [SKIP] 克隆库历史中已无该旧凭据记录（仓库已被清洗干净），跳过重写用例。" -ForegroundColor Yellow
        } else {
            $p2 = Start-Process powershell -ArgumentList "-NoProfile", "-File", "`"$scriptInClone`"", "-Account", "`"$realAcc`"", "-Password", "`"$realPass`"" -NoNewWindow -Wait -PassThru -RedirectStandardOutput (Join-Path $tmpClone "test2_stdout.txt") -RedirectStandardError (Join-Path $tmpClone "test2_stderr.txt")

            $out2 = if (Test-Path (Join-Path $tmpClone "test2_stdout.txt")) { Get-Content (Join-Path $tmpClone "test2_stdout.txt") -Raw -Encoding UTF8 } else { "" }

            if ($p2.ExitCode -ne 0) {
                Write-Host "  [失败] 凭据清洗失败，退出码 $($p2.ExitCode)。输出:" -ForegroundColor Red
                Write-Host $out2 -ForegroundColor DarkGray
                exit 1
            }

            if ($out2 -notmatch "自检全部通过") {
                Write-Host "  [失败] 清洗脚本未输出自检通过标识！" -ForegroundColor Red
                Write-Host $out2 -ForegroundColor DarkGray
                exit 1
            }

            # 深度复核克隆库中的全历史 Commit Blob
            $remainPass = (git -C $tmpClone log --all --oneline "-S$realPass")
            $remainAcc  = (git -C $tmpClone log --all --oneline "-S$realAcc")
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

            Write-Host "  [PASS] 测试 2 通过：全流程成功执行（退出码 0），全历史目标凭据/config.json 残留全部为 0。" -ForegroundColor Green
        }
    }

    # -------------------------------------------------------------
    # 测试用例 3: 确认真实主仓库未受任何影响
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
    if ($skippedTests -gt 0) {
        # 不能报 100%：依赖真实旧凭据的重写用例在本仓库永远无法执行，
        # 必须如实标注为部分通过，避免"测试全绿"掩盖未覆盖的路径。
        Write-Host "  [PARTIAL] 已通过：错误密码拦截 + 主仓库隔离核验。" -ForegroundColor Yellow
        Write-Host "  [PARTIAL] 已跳过：$skippedTests 个依赖历史旧凭据的重写用例。" -ForegroundColor Yellow
        Write-Host "            （历史已清洗干净时属预期；需全量验证请注入 CAMPUS_LEAKED_* 环境变量）" -ForegroundColor Yellow
    } else {
        Write-Host "  端到端自动化测试全部通过 (100% SUCCESS)！" -ForegroundColor Green
    }
    Write-Host "============================================================" -ForegroundColor Green
} finally {
    Set-Location $repoRoot
    if (Test-Path $tmpClone) {
        Remove-Item $tmpClone -Recurse -Force -ErrorAction SilentlyContinue
    }
}
