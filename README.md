# Campus AutoLogin (校园网自动登录)

针对 **http://172.30.100.2/** （Dr.COM / 哆点 ePortal 认证系统）的自动登录工具。

包含两部分，任选其一或搭配使用：

| 方案 | 适用场景 | 说明 |
| --- | --- | --- |
| **① Python 脚本** | 开机自动登录、命令行、计划任务 | 零依赖，双击即用 |
| **② Chrome 插件** | 日常用浏览器上网 | 后台定时检测，掉线自动重连 |

> **首次使用请先填账号密码**：Python 脚本请复制 `config.example.json` 为 `config.json` 并填入自己的账号密码；
> Chrome 插件请在插件设置页里填写。源码与模板中都**不含任何真实凭据**，请勿把自己的密码提交进仓库。

---

## 目录结构

```
campus-autologin/
├── login.bat               ← 双击运行（命令行智能登录）
├── gui.bat                 ← 桌面控制中心 GUI（暗色科技面板）
├── campus_login.py         ← 核心脚本（纯 Python 标准库，零依赖）
├── config.example.json     ← 配置模板（复制为 config.json 后填入自己的账号密码）
├── autostart.bat           ← 静默版，供计划任务调用（写日志）
├── install_autostart.bat   ← 双击自动提权安装计划任务
├── uninstall_autostart.bat ← 双击自动提权卸载计划任务
├── install_autostart.ps1   ← PowerShell 计划任务配置脚本
├── reload_extension.bat    ← 改完插件代码后，一键打开扩展页刷新
├── chrome-extension/       ← Chrome 浏览器插件
│   ├── manifest.json
│   ├── background.js
│   ├── popup.html / popup.js / popup.css
│   ├── options.html / options.js / options.css
│   ├── icons/
│   └── README.md           ← 插件单独的安装说明
├── assets/                 ← 图标生成工具
├── logs/                   ← 计划任务运行日志
└── README.md               ← 本文件
```

---

## ① Python 脚本

### 环境要求

只需要 **Python 3**（本机已安装：`Python 3.14.6`）。没有任何第三方库依赖。

> 如果没有 Python，到 <https://www.python.org/downloads/> 下载安装，安装时**务必勾选 `Add Python to PATH`**。

### 快速开始

**方式一（最简单）**：双击 `login.bat` 或运行 `gui.bat`（桌面图形控制台）

**方式二（命令行）**：

```powershell
cd "C:\Project\campus-autologin"
python campus_login.py            # 智能登录：已在线就跳过，没在线就登录
```

### 命令一览

| 命令 | 作用 |
| --- | --- |
| `python campus_login.py` | **智能登录**：先查状态，已在线则跳过；不在线则自动登录 |
| `python campus_login.py status` | 只看当前在线状态（不登录） |
| `python campus_login.py login` | 强制登录（已在线也会重新认证） |
| `python campus_login.py logout` | 注销下线 |
| `python campus_login.py wait` | 等待校园网就绪后再登录（**开机自启推荐用这个**） |
| `python campus_login.py test` | 自检：配置 + 本机 IP + 门户连通性 |

### 常用参数

| 参数 | 说明 |
| --- | --- |
| `--json` | 以 JSON 输出，方便被其它程序调用 |
| `-q` / `--quiet` | 静默模式，只在失败时输出（计划任务用） |
| `--force` | 强制重新登录，即使已在线 |
| `--user 账号` | 临时指定账号，不改配置文件 |
| `--password 密码` | 临时指定密码 |
| `--retry N` | 失败重试次数 |
| `--timeout N` | 单次请求超时（秒） |

**退出码**：`0` = 成功在线 · `1` = 失败 · `2` = 配置错误

### 使用示例

```powershell
# 查看状态
python campus_login.py status

# 自检（网络不通时先用这个排查）
python campus_login.py test

# 供程序调用的 JSON 输出
python campus_login.py status --json
# => {"action": "status", "online": true, "ip": "10.0.0.100", "account": "13800000000", ...}
```

### 修改账号密码

将 `config.example.json` 复制为 `config.json`，然后编辑 `config.json`：

```json
{
  "portal_host": "172.30.100.2",
  "username": "你的账号",
  "password": "你的密码",
  "isp": "1"
}
```

> `config.json` 已被 `.gitignore` 忽略，不会被提交到 Git 仓库。

`isp` 为运营商代码：`1` = 校园用户（默认，无后缀） · `2` = 校园电信 `@dx` · `3` = 校园联通 `@lt` · `4` = 校园其他

---

## ② 设置开机自动登录

> **前提：`config.json` 里必须已填好账号密码。** 计划任务开机跑的是 `wait` 模式，
> 未在线时会真的发起认证；若凭据为空，任务每次开机都只会失败。
> 安装脚本会提前检查并在未填写时直接拒绝安装（避免建出一个注定失败的任务）。

**推荐方式（一键双击）**：
* **安装**：直接双击运行项目根目录下的 **`install_autostart.bat`**。系统会自动弹出管理员授权窗口，点击「是」即自动完成自检并注册双触发器计划任务（开机 20 秒后启动 + 用户登录 10 秒后启动，完美兼容台式机常开与笔记本合盖休眠唤醒）。
* **卸载**：直接双击运行 **`uninstall_autostart.bat`** 即可安全清理。

**高级方式（手动 PowerShell）**：
以管理员身份打开 PowerShell，执行：

```powershell
cd "C:\Project\campus-autologin"
powershell -ExecutionPolicy Bypass -File "install_autostart.ps1"
# 卸载请加 -Uninstall 参数
```

**相关操作**：

```powershell
schtasks /Run /TN CampusNetAutoLogin          # 立即手动触发一次
notepad "C:\Project\campus-autologin\logs\autologin.log"   # 查看运行日志
```

> 开机自启用的是 `wait` 模式：网卡还没拿到 IP 时会自动等待（最多 90 秒），等校园网就绪后再登录。
> 也可在桌面控制台 `gui.bat` 中通过「Windows 计划任务开机自启」卡片一键配置或卸载。

---

## ③ Chrome 插件

详见 [`chrome-extension/README.md`](chrome-extension/README.md)。

简要步骤：

1. 打开 Chrome，地址栏输入 `chrome://extensions/`
2. 右上角开启 **开发者模式**
3. 点击 **加载已解压的扩展程序**
4. 选择 `C:\Project\campus-autologin\chrome-extension` 文件夹
5. 点击插件图标 → 打开 **设置**，确认账号密码后保存

插件重连很快，掉线基本无感（三层保障）：

| 层级 | 触发时机 | 延迟 |
| --- | --- | --- |
| ① 断网跳转瞬间 | 网页打不开 / 被跳到门户 | **≈ 0 秒** |
| ② 掉线后高频轮询 | 已确认掉线，每 **1 秒**重试 | **≤ 1 秒** |
| ③ 在线时轮询 | 常规守护 | 兜底 |

> **关于 1 秒间隔**：Chrome 官方文档说 `chrome.alarms` 最快 30 秒，但该限制**只对已打包/商店安装的扩展生效**。
> 开发者模式加载的扩展不受限制 —— 本插件在 Chrome 154 实测：闹钟 `period=0.0167 分 = 1.0 秒`，
> 16 秒内精确触发 16 次。若将来打包发布到商店，会被自动夹到 30 秒。

> **⚠️ 改完插件代码没生效？这是 Chrome 的正常行为，不是 bug。**
>
> Chrome 只在**加载扩展的那一刻**读取代码，之后一直用内存里的副本。
> 改了磁盘文件，不点刷新是不会生效的。两种解决办法，任选其一：
>
> **方法 A（推荐）**：双击 `reload_extension.bat`，在扩展页点「Campus AutoLogin」卡片上的 **🔄 刷新**，
> 然后**把旧设置页标签关掉重新打开**。
>
> **方法 B（最省事）**：**完全退出 Chrome 再打开**（关掉所有窗口；或右下角托盘退出）。
> 重启后所有扩展都会重新从磁盘加载，等于自动刷新。
>
> 确认成功的标志：设置页标题右边出现版本号 **v1.0.0**。

### 更多便捷特性

* **图标角标状态**：工具栏插件图标动态反映网络状态（离线高亮红色 `!`，重连中显示 `...`，在线自动隐藏）。
* **全局快捷键**：按下 **`Alt+Shift+L`** 即可在任意网页直接触发静默认证，无需呼出弹窗。
* **配置备份与恢复**：设置页底部提供「导出配置」与「导入配置」，一键生成/恢复 JSON 备份。
* **账号快速清空**：设置页上网账号输入框内置 `×` 清空按钮，编辑更高效。

---

## 工作原理（技术细节）

门户是 Dr.COM / 哆点 ePortal，认证接口通过 JSONP 调用：

| 用途 | 请求 |
| --- | --- |
| 查询状态 | `GET http://172.30.100.2/drcom/chkstatus?callback=dr1001&lang=zh&jsVersion=4.1.3` |
| 登录认证 | `GET http://172.30.100.2/drcom/login?callback=dr1002&DDDDD=账号&upass=密码&0MKKey=123456&R1=0&R2=&R3=1&R6=0&para=00&v6ip=&terminal_type=1&lang=zh-cn&jsVersion=4.1.3` |
| 注销 | `GET http://172.30.100.2/drcom/logout?...` |

返回格式（JSONP 包了一层）：

```javascript
dr1002({"result":1,"uid":"13800000000","v4ip":"10.0.0.100",...});
```

- `result: 1` → 在线 / 登录成功
- `result: 0` → 失败，`msga` 字段给出原因（`userid error1` 账号不存在、`userid error2` 密码错误）

脚本会**先查状态再决定是否登录**，避免把已经正常的网络踢下线。

---

## 常见问题

**Q：提示「门户不可达」？**
说明当前不在校园网内。先连上校园网 Wi-Fi 或网线，再运行 `python campus_login.py test` 自检。

**Q：提示「密码错误」但密码明明是对的？**
检查 `config.json` 里的 `isp` 是否选对了运营商（部分学校需要在账号后加 `@dx` / `@lt` 后缀）。

**Q：`logout` 显示「注销未生效」或注销后断网了？**
注销接口 `http://172.30.100.2/drcom/logout` 在本校 AC 上是**真实生效**的（实测注销后 `chkstatus` 立即返回 `result: 0`，需要重新认证才能上网）。
所以：**除非你真的想断网，否则不要运行 `logout`**。日常使用只用默认的智能登录即可。

**Q：为什么不能用错误密码测试？**
同一 IP 用错误密码发起认证，**会把当前在线的会话踢掉**（实测确认）。这也反过来证明认证是真实生效的。本脚本因此默认先查状态、已在线就直接返回，不会误触发认证。

**Q：脚本会把我的网络踢下线吗？**
不会。默认智能模式先查询状态，已在线就直接返回，不会重复认证。

---

## 安全提醒

`config.json`（本地配置）和 Chrome 插件里保存了你的校园网密码（明文）。请注意：

- `config.json` 已被 `.gitignore` 忽略，请**切勿使用 `git add -f` 强制提交**到 Git 仓库。
- **密码泄露应急处理**：若曾不慎将含密码的文件推送到 Git 远程仓库，最快、最彻底的消除隐患方式是**立即登录学校校园网自助服务网站修改一次密码**。新密码生效后旧密码立刻在网关端作废。
- **请勿使用错误密码高频测试**：真实校园网 Dr.COM AC 网关普遍内置防暴力破解策略，短时间内若连续收到错误密码可能会触发 IP 或账号封禁（15~30 分钟），导致暂时断网。
- 不要把本工程目录直接打包上传公共网盘或发给他人（Chrome 插件设置及本地配置均包含个人凭据）。
- 公用电脑（如机房、实验室）使用完毕后，建议立即删除 `config.json` 并清空插件内保存的凭据。

---

## 已验证信息

在 `10.0.0.100`（Ethernet 网卡）上对本门户实测通过：

| 项目 | 结果 |
| --- | --- |
| 门户可达 | ✅ `http://172.30.100.2/` HTTP 200，`Server: DrCOMServer1.0` |
| 状态查询 | ✅ 返回 `result: 1`，账号 `13800000000`，IP `10.0.0.100` |
| **正确账号密码** | ✅ 返回**认证成功页** `Dr.COMWebLoginID_3.htm` |
| **错误密码** | ✅ 返回**认证失败页** `Dr.COMWebLoginID_2.htm`（`userid error2`） |
| **不存在的账号** | ✅ 返回**认证失败页** `Dr.COMWebLoginID_2.htm`（`userid error1`） |
| Python 脚本登录 | ✅ `login --force` → 登录成功，复核已在线 |
| Python 脚本自检 | ✅ `test` → 全部接口 HTTP 200 |
| 批处理启动器 | ✅ `login.bat` / `gui.bat` / `autostart.bat` 运行正常，日志正常写入 |
| Chrome 插件网络层 | ✅ 11 项自动化检查全部通过（含真实门户请求） |
| Chrome 插件间隔逻辑 | ✅ 17 项边界检查全部通过（含 30 秒闹钟） |
| Chrome 插件图标 | ✅ 16/32/48/128 PNG 签名与尺寸校验通过 |
| JS 语法 | ✅ `node --check` 全部通过 |

> ⚠️ 注意：测试过程中确认「错误密码认证」和「注销」都会导致当前会话下线、需要重新登录。
> 正常使用脚本不会触发这两种情况（默认先查状态，已在线直接返回）。
