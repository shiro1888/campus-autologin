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
try {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    [Console]::InputEncoding = [System.Text.Encoding]::UTF8
} catch {}
$here = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
$target = Join-Path $here "autostart.bat"

function Write-Step($msg) { Write-Host "  $msg" }
function Write-Ok($msg)   { Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "  [!!] $msg" -ForegroundColor Yellow }

Write-Host ""
Write-Host "===== 校园网自动登录 · 计划任务安装 =====" -ForegroundColor Cyan
Write-Host ""

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "  [错误] 注册或卸载计划任务需要管理员权限。" -ForegroundColor Red
    Write-Host "         请右键 PowerShell 选择「以管理员身份运行」后再执行本脚本。" -ForegroundColor Yellow
    Write-Host ""
    exit 1
}

$taskNameFile = Join-Path $here ".task_name"
if ($Uninstall) {
    if (-not $PSBoundParameters.ContainsKey('TaskName') -and (Test-Path $taskNameFile)) {
        try {
            $savedTask = (Get-Content $taskNameFile -Raw -Encoding UTF8).Trim()
            if ($savedTask) { $TaskName = $savedTask }
        } catch {}
    }
    $existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($existing) {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Write-Ok "已删除计划任务: $TaskName"
    } else {
        Write-Warn "计划任务不存在: $TaskName"
    }
    $pyPathFile = Join-Path $here ".python_path"
    if (Test-Path $taskNameFile) { Remove-Item $taskNameFile -Force -ErrorAction SilentlyContinue }
    if (Test-Path $pyPathFile) { Remove-Item $pyPathFile -Force -ErrorAction SilentlyContinue }
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
    $cmds = Get-Command $c -All -ErrorAction SilentlyContinue
    foreach ($m in $cmds) { if ($m.Source -and ($m.Source -notlike "*\WindowsApps\*") -and ((Get-Item $m.Source -ErrorAction SilentlyContinue).Length -gt 0)) { $py = $m.Source; break } }; if ($py) { break }
}
if (-not $py) {
    Write-Host "  [错误] 没有检测到 Python，请先安装 Python 3 并勾选 Add to PATH。" -ForegroundColor Red
    exit 1
}
Write-Ok "Python: $py"
try { $utf8NoBom = New-Object System.Text.UTF8Encoding($false); [System.IO.File]::WriteAllText((Join-Path $here ".python_path"), $py, $utf8NoBom) } catch {}

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
$portalHost = if ($cfgObj -and $cfgObj.portal_host) { [string]$cfgObj.portal_host } else { "172.30.100.2" }
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

$action = New-ScheduledTaskAction -Execute $target -WorkingDirectory $here

# 双触发器：开机启动（延迟 2 秒） + 用户登录（即时触发），兼顾开机无需登录桌面即连网与合盖休眠唤醒
# campus_login.py wait 自身内置自适应轮询，无需设置冗余的长延时死等
$triggerStartup = New-ScheduledTaskTrigger -AtStartup
$triggerStartup.Delay = "PT2S"
$triggerLogon = New-ScheduledTaskTrigger -AtLogOn
$trigger = @($triggerStartup, $triggerLogon)

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 10) `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1)

# 以当前用户身份、最高权限运行(S4U 允许开机无需登录 Windows 桌面即可在后台自动连网，免输 Windows 密码)
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
    -Description "开机自动登录校园网 http://$portalHost/ (Dr.COM ePortal)" | Out-Null

Write-Ok "计划任务已创建: $TaskName"
try { [System.IO.File]::WriteAllText((Join-Path $here ".task_name"), $TaskName, (New-Object System.Text.UTF8Encoding $false)) } catch {}

Write-Host ""
Write-Host "===== 安装完成 =====" -ForegroundColor Cyan
Write-Host ""
Write-Host "  以后每次开机 2 秒后或用户登录后均会立即自动检查并登录。" -ForegroundColor White
Write-Host ""
Write-Host "  常用命令:"
Write-Host "    立即测试:  schtasks /Run /TN $TaskName"
Write-Host "    查看日志:  notepad `"$here\logs\autologin.log`""
Write-Host "    卸载任务:  powershell -ExecutionPolicy Bypass -File `"$here\install_autostart.ps1`" -Uninstall"
Write-Host ""