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
    # 测试用例 2: 凭据清洗全流程脱敏与多重自检
    #
    # 旧版只在「注入了真实历史旧凭据」时才跑重写主路径，而本仓库历史已清洗
    # 完成，该条件永远不成立 —— clean_history.ps1 的 filter-repo 重写、替换
    # 规则、5 层自检、origin 恢复、reflog/gc 清理从未被真正执行验证过。
    #
    # 现在改为：优先用环境变量注入的真实凭据（若历史中确实存在）；否则在
    # **隔离克隆**里植入一组随机虚构凭据 + config.json 并提交，构造出含泄露
    # 记录的历史，再完整跑一遍清洗流程。这样主路径在任何环境都能被执行，
    # 且全程只在临时克隆里操作，绝不污染真实仓库。
    # -------------------------------------------------------------
    Write-Host ""
    Write-Host "  [测试 2/2] 验证【凭据清洗】全流程与多重自检..." -ForegroundColor Yellow

    # 工具可用性守卫：缺 git-filter-repo 时如实 SKIP，避免误报失败
    $hasFilterRepo = $false
    if (Get-Command "git-filter-repo" -ErrorAction SilentlyContinue) {
        $hasFilterRepo = $true
    } elseif (Get-Command "python" -ErrorAction SilentlyContinue) {
        # Python 本身也可能是缺失的（此时 Start-Process 会直接抛异常，
        # 不能只靠 -ErrorAction SilentlyContinue），必须显式 try/catch。
        try {
            $pyCheck = Start-Process python -ArgumentList "-m git_filter_repo --version" -NoNewWindow -Wait -PassThru -ErrorAction Stop
            if ($pyCheck -and $pyCheck.ExitCode -eq 0) { $hasFilterRepo = $true }
        } catch {
            $hasFilterRepo = $false
        }
    }
    if (-not $hasFilterRepo) {
        $skippedTests++
        Write-Host "  [SKIP] 未检测到 git-filter-repo，跳过清洗主路径（pip install git-filter-repo 后可全量验证）。" -ForegroundColor Yellow
    } else {
        $realPass = $env:CAMPUS_LEAKED_PASSWORD
        $realAcc  = $env:CAMPUS_LEAKED_ACCOUNT
        $useReal  = $false
        if ($realPass -and $realAcc) {
            $preCheckHits = (git -C $tmpClone log --all --oneline "-S$realPass")
            if ($preCheckHits) { $useReal = $true }
        }

        if ($useReal) {
            Write-Host "  [模式] 使用环境变量注入的历史真实旧凭据。" -ForegroundColor Gray
            $targetPass = $realPass
            $targetAcc  = $realAcc
        } else {
            # 在隔离克隆里植入虚构泄露记录：随机 GUID 保证与任何真实凭据无关，
            # 且绝不会写回主仓库。config.json 同时构造，用于验证 --invert-paths。
            Write-Host "  [模式] 在隔离克隆中植入随机虚构凭据，构造可清洗的历史。" -ForegroundColor Gray
            $targetPass = "E2E_LEAKED_PASS_" + [System.Guid]::NewGuid().ToString("N")
            $targetAcc  = "E2E_LEAKED_ACC_"  + [System.Guid]::NewGuid().ToString("N")
            $cfgPath = Join-Path $tmpClone "config.json"
            [System.IO.File]::WriteAllText(
                $cfgPath,
                "{`"account`": `"$targetAcc`", `"password`": `"$targetPass`"}`n",
                (New-Object System.Text.UTF8Encoding($false)))
            # .gitignore 明确忽略 config.json（防御性规则），必须用 -f 才能在
            # 隔离克隆里把它作为「历史遗留配置文件」植入提交。
            git -C $tmpClone add -f config.json | Out-Null
            git -C $tmpClone -c user.name="e2e-test" -c user.email="e2e@local.invalid" commit -m "e2e: plant synthetic leaked credentials" --quiet
            if ($LASTEXITCODE -ne 0) {
                Write-Host "  [失败] 无法在隔离克隆中植入测试提交。" -ForegroundColor Red
                exit 1
            }
            # 前置断言：凭据确实存在于历史中（否则下面的清洗流程会走「安全终止」分支，形成假绿）
            $plantedPass = (git -C $tmpClone log --all --oneline "-S$targetPass")
            $plantedAcc  = (git -C $tmpClone log --all --oneline "-S$targetAcc")
            if (-not $plantedPass -or -not $plantedAcc) {
                Write-Host "  [失败] 植入的虚构凭据未出现在历史中，测试前提不成立。" -ForegroundColor Red
                exit 1
            }
        }

        $p2 = Start-Process powershell -ArgumentList "-NoProfile", "-File", "`"$scriptInClone`"", "-Account", "`"$targetAcc`"", "-Password", "`"$targetPass`"" -NoNewWindow -Wait -PassThru -RedirectStandardOutput (Join-Path $tmpClone "test2_stdout.txt") -RedirectStandardError (Join-Path $tmpClone "test2_stderr.txt")

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
        $remainPass = (git -C $tmpClone log --all --oneline "-S$targetPass")
        $remainAcc  = (git -C $tmpClone log --all --oneline "-S$targetAcc")
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
        # 不能报 100%：如实标注被跳过的用例，避免「测试全绿」掩盖未覆盖的路径。
        Write-Host "  [PARTIAL] 已通过：错误密码拦截 + 主仓库隔离核验。" -ForegroundColor Yellow
        Write-Host "  [PARTIAL] 已跳过：$skippedTests 个用例（通常为缺少 git-filter-repo 工具）。" -ForegroundColor Yellow
        Write-Host "            （清洗主路径现通过隔离克隆内植入虚构凭据验证，不再依赖真实历史泄露记录）" -ForegroundColor Yellow
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
