# =====================================================================
#  校园网自动登录 —— 一键安装"开机自动登录"计划任务
#  用法(右键 PowerShell "以管理员身份运行"):
#      powershell -ExecutionPolicy Bypass -File "install_autostart.ps1"
#  卸载:  powershell -ExecutionPolicy Bypass -File "install_autostart.ps1" -Uninstall
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

# --- 2.5 先确认已填账号密码 ---
# 计划任务开机跑的是 `campus_login.py wait`，未在线时会真的发起认证。
# 若 config.json 里账号密码为空，任务每次开机都只会失败（日志里仅一个 EXIT: 2），
# 因此这里直接拦下并退出，不创建一个注定失败的任务。
$cfgFile = Join-Path $here "config.json"
$cfgObj = $null
$cfgParseError = $null
if (Test-Path $cfgFile) {
    try {
        $cfgObj = Get-Content $cfgFile -Raw -Encoding UTF8 | ConvertFrom-Json
    } catch {
        # 不能把解析失败悄悄吞成 $null，否则会误报「账号或密码未填写」，
        # 用户去反复检查账号，而真正的问题是 JSON 语法坏了。
        $cfgObj = $null
        $cfgParseError = $_.Exception.Message
    }
}
if ($cfgParseError) {
    Write-Host ""
    Write-Host "  [错误] config.json 无法解析（JSON 语法有误）。" -ForegroundColor Red
    Write-Host "         $cfgParseError" -ForegroundColor Yellow
    Write-Host "         请检查是否缺少引号/逗号，或直接复制 config.example.json 重填。" -ForegroundColor Yellow
    Write-Host ""
    exit 1
}
$cfgUser = if ($cfgObj) { [string]$cfgObj.username } else { "" }
$cfgPass = if ($cfgObj) { [string]$cfgObj.password } else { "" }
if (-not $cfgUser.Trim() -or -not $cfgPass.Trim()) {
    Write-Host ""
    Write-Host "  [错误] 账号或密码未填写，无法安装开机自启。" -ForegroundColor Red
    if (-not (Test-Path $cfgFile)) {
        Write-Host "         尚未创建 config.json。请先复制 config.example.json 为" -ForegroundColor Yellow
        Write-Host "         config.json，填入你的校园网账号密码后再运行本安装脚本。" -ForegroundColor Yellow
    } else {
        Write-Host "         请编辑 config.json，填入 username 与 password 后重试。" -ForegroundColor Yellow
    }
    Write-Host ""
    exit 1
}
Write-Ok "已检测到账号: $cfgUser"

# --- 3. 先跑一次自检，确认配置和网络没问题 ---
Write-Host ""
Write-Step "正在自检 (config.json + 门户连通性)..."
& $py (Join-Path $here "campus_login.py") test
if ($LASTEXITCODE -ne 0) {
    Write-Warn "自检未通过（多为门户不可达）。仍会创建计划任务，开机连上校园网后即会生效。"
} else {
    Write-Ok "自检通过"
}

# --- 4. 创建计划任务 ---
Write-Host ""
Write-Step "创建计划任务..."

$action = New-ScheduledTaskAction -Execute "`"$target`"" -WorkingDirectory $here

# 双触发器：开机启动（延迟 20 秒） + 用户登录（延迟 10 秒），兼顾台式机与笔记本合盖休眠唤醒
$triggerStartup = New-ScheduledTaskTrigger -AtStartup
$triggerStartup.Delay = "PT20S"
$triggerLogon = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERNAME"
$triggerLogon.Delay = "PT10S"
$trigger = @($triggerStartup, $triggerLogon)

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
Write-Host "    卸载任务:  powershell -ExecutionPolicy Bypass -File `"$here\install_autostart.ps1`" -Uninstall"
Write-Host ""