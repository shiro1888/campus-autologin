# =====================================================================
#  校园网自动登录 —— 一键安装"开机自动登录"计划任务
#  用法(右键 PowerShell "以管理员身份运行"):
#      powershell -ExecutionPolicy Bypass -File "安装开机自启.ps1"
#  卸载:  powershell -ExecutionPolicy Bypass -File "安装开机自启.ps1" -Uninstall
# =====================================================================
[CmdletBinding()]
param(
    [switch]$Uninstall,
    [string]$TaskName = "CampusNetAutoLogin"
)

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$target = Join-Path $here "autostart.bat"

function Write-Step($msg) { Write-Host "  $msg" }
function Write-Ok($msg)   { Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "  [!!] $msg" -ForegroundColor Yellow }

Write-Host ""
Write-Host "===== 校园网自动登录 · 计划任务安装 =====" -ForegroundColor Cyan
Write-Host ""

if ($Uninstall) {
    $existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($existing) {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Write-Ok "已删除计划任务: $TaskName"
    } else {
        Write-Warn "计划任务不存在: $TaskName"
    }
    Write-Host ""
    exit 0
}

# --- 1. 检查文件 ---
if (-not (Test-Path $target)) {
    Write-Host "  [错误] 找不到 autostart.bat，请把本脚本放在脚本目录里运行。" -ForegroundColor Red
    exit 1
}
Write-Ok "找到启动脚本: $target"

# --- 2. 检查 Python ---
$py = $null
foreach ($c in @("py", "python")) {
    $cmd = Get-Command $c -ErrorAction SilentlyContinue
    if ($cmd) { $py = $cmd.Source; break }
}
if (-not $py) {
    Write-Host "  [错误] 没有检测到 Python，请先安装 Python 3 并勾选 Add to PATH。" -ForegroundColor Red
    exit 1
}
Write-Ok "Python: $py"

# --- 3. 先跑一次自检，确认配置和网络没问题 ---
Write-Host ""
Write-Step "正在自检 (config.json + 门户连通性)..."
& $py (Join-Path $here "campus_login.py") test
if ($LASTEXITCODE -ne 0) {
    Write-Warn "自检未通过。仍会创建计划任务，但请先确认已连上校园网。"
} else {
    Write-Ok "自检通过"
}

# --- 4. 创建计划任务 ---
Write-Host ""
Write-Step "创建计划任务..."

$action = New-ScheduledTaskAction -Execute $target -WorkingDirectory $here

# 开机后 30 秒启动；网络就绪后脚本自己会等待门户可达
$trigger = New-ScheduledTaskTrigger -AtStartup
$trigger.Delay = "PT30S"

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 10) `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1)

# 以当前用户身份、最高权限运行(需要管理员授权创建)
$principal = New-ScheduledTaskPrincipal `
    -UserId "$env:USERDOMAIN\$env:USERNAME" `
    -LogonType S4U `
    -RunLevel Highest

$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Step "已移除旧的同名任务"
}

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Description "开机自动登录校园网 http://172.30.100.2/ (Dr.COM ePortal)" | Out-Null

Write-Ok "计划任务已创建: $TaskName"

Write-Host ""
Write-Host "===== 安装完成 =====" -ForegroundColor Cyan
Write-Host ""
Write-Host "  以后每次开机 30 秒后会自动检查并登录。" -ForegroundColor White
Write-Host ""
Write-Host "  常用命令:"
Write-Host "    立即测试:  schtasks /Run /TN $TaskName"
Write-Host "    查看日志:  notepad `"$here\logs\autologin.log`""
Write-Host "    卸载任务:  powershell -ExecutionPolicy Bypass -File `"$here\安装开机自启.ps1`" -Uninstall"
Write-Host ""