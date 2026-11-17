# Campus AutoLogin · 校园网自动登录（Chrome / Edge 扩展）

针对 **http://172.30.100.2/**（Dr.COM / 哆点 ePortal 认证系统）的高性能浏览器扩展：
**掉线秒级自动重连**，无需手动打开门户登录页。

基于 Chromium Manifest V3 架构开发，**原生兼容 Google Chrome、Microsoft Edge** 以及所有 Chromium 内核浏览器（如 Brave、Vivaldi、360 极速浏览器等）。

---

## 安装（30 秒搞定）

本项目支持 **Google Chrome** 与 **Microsoft Edge**，请选择您的主力浏览器操作：

### 方案 A：Google Chrome 用户
1. 打开 Chrome，地址栏输入 `chrome://extensions/` 回车；
2. 打开右上角 **「开发者模式」** 开关；
3. 点击左上角 **「加载已解压的扩展程序」**；
4. 选择本仓库下的 **`chrome-extension`** 文件夹；
5. 点击工具栏的插件图标 → **控制中心**，填入校园网账号密码 → **保存并连接**。

### 方案 B：Microsoft Edge 用户
1. 打开 Edge，地址栏输入 `edge://extensions/` 回车；
2. 开启左下角（或左侧导航）的 **「开发人员模式」** 开关；
3. 点击顶部的 **「加载解压缩的扩展」** 按钮；
4. 选择本仓库下的 **`chrome-extension`** 文件夹；
5. 点击工具栏的插件图标 → **控制中心**，填入校园网账号密码 → **保存并连接**。

> 💡 **固定到工具栏**：如果工具栏看不到图标，点击地址栏右侧的「拼图」图标，把 **Campus AutoLogin** 固定住即可。
>
> 详细说明（含功能清单、设置项、工作原理）见 **[chrome-extension/README.md](chrome-extension/README.md)**。

---

## 功能一览

| 功能 | 说明 |
| --- | --- |
| **断网秒级重连** | 网页打不开 / 被跳到门户登录页的**瞬间**就重连，不等定时器 |
| **自适应加速** | 在线时低频检查（默认 10 秒）；确认掉线自动切到 **1 秒**高频重连，连上再切回 |
| **离线自动退避** | 不在校园网内（在家 / 热点）时指数退避到 1 分钟一次，不会每秒空转 |
| **浏览器启动自动登录** | 打开 Chrome 就检查一次 |
| **登录页自动填写** | 被断网跳转到门户登录页时，自动填账号密码并点登录 |
| **手动登录 / 注销** | 点插件图标 → 「立即登录」/「注销」；注销后会暂停自动登录 |
| **图标角标状态** | 离线高亮红色 `!`，重连中显示 `...`，在线自动隐藏 |
| **全局快捷键** | `Alt+Shift+L` 在任意网页直接触发静默认证 |
| **配置备份与恢复** | 设置页「导出配置」/「导入配置」，一键生成/恢复 JSON 备份 |

### 重连有多快？

| 层级 | 触发时机 | 延迟 |
| --- | --- | --- |
| ① 断网跳转瞬间 | 导航失败 / 被跳到门户 | **≈ 0 秒** |
| ② 掉线后高频轮询 | 确认掉线（门户可达但未认证），每 1 秒重试 | **≤ 1 秒** |
| ③ 在线时低频轮询 | 常规守护，默认 10 秒 | 兜底 |

> **区分「掉线」与「不在校园网内」**：门户可达但未认证才是真·掉线，按 1 秒间隔快速抢修；
> 门户根本连不上时先快速重试约 10 次，之后指数退避（2 → 4 → 8 → … → 60 秒封顶）。
>
> 「≈ 0 秒 / ≤ 1 秒」是**尽力而为**的目标，不是硬保证：瞬时触发有 15 秒节流窗口
> （若恰逢后台忙被跳过，会缩短为 1 秒后重试），
> 单轮流程还包含 Service Worker 冷启动、运行态恢复与最多 3 次 8 秒超时的门户请求；
> 且低于 30 秒的 `chrome.alarms` 周期依赖「未打包扩展不受夹紧」这一非契约行为
> （打包发布后会被 Chrome 夹到 30 秒）。实际重连时间取决于当时浏览器与门户状态。

---

## 工作原理

插件通过 JSONP 调用门户接口（与门户网页的 `a40.js` 一致）：

```
状态：GET /drcom/chkstatus?callback=dr1001&v=<随机>&lang=zh&jsVersion=4.1.3
登录：GET /drcom/login?callback=dr1002&DDDDD=账号&upass=密码&R3=<运营商代码 1~4>&...
```

返回形如 `dr1001({"result":1,"uid":"13800000000","v4ip":"10.0.0.100",...});`（`dr1002` 为登录回调）。

- `result: 1` → 在线 / 登录成功
- `result: 0` → 失败，`msga` 说明原因（`userid error1` 账号不存在、`userid error2` 密码错误）

**插件先查状态再决定是否登录**，已在线时不会重复认证，避免把正常网络踢掉；
重试前若发现已上线也会立即中止，绝不会二次认证把刚建立的会话顶掉。

---

## 目录结构

```
campus-autologin/
├── chrome-extension/          ← Chrome 扩展本体（唯一的功能载体）
│   ├── manifest.json          MV3 清单
│   ├── background.js          Service Worker：定时检查 + 自动重连 + webNavigation 监听
│   ├── content.js             登录页自动填写与 HUD 提示
│   ├── common.js              共享组件库：格式化工具 + 计时器/波形图/时间轴/Toast/主题/健康度等 UI 组件
│   ├── popup.html/js/css      工具栏弹出面板
│   ├── options.html/js/css    控制中心设置页
│   ├── shared.css             共享样式库：全局统一悬浮提示浮层等
│   ├── icons/                 各尺寸图标
│   └── README.md              详细功能与设置说明
├── assets/                    ← 图标生成工具与原图（make_icons.py / master.jpg）
├── tests/                     ← 自动化与端到端测试套件（test_extension.py / test_clean_history_e2e.ps1）
├── clean_history.ps1          ← Git 历史敏感凭据脱敏工具（见下方安全公告）
├── reload_extension.bat       ← 改完扩展代码后一键打开扩展页刷新
├── .gitattributes
├── .gitignore
└── README.md
```

---

## 开发

> 运行单元测试需要 **Python 3** 与 **Node.js**（测试通过 Node VM 执行扩展 JS 行为校验）；端到端历史清洗测试另需 `git-filter-repo`。

```powershell
# 扩展结构、DOM 契约与核心逻辑测试（建议加 -B 避免生成 __pycache__）
python -B -m unittest discover tests -v

# 端到端回归：在隔离临时克隆中验证「错误密码被拦截」与「凭据清洗全流程」；
# 历史已清洗时会植入临时虚构凭据构造测试历史，仅在缺少 git-filter-repo 时标记 SKIP
powershell -File tests/test_clean_history_e2e.ps1

# 重新生成扩展图标（需要 Pillow：pip install pillow）
python assets/make_icons.py

# 改完扩展代码后：双击 reload_extension.bat → 在扩展页点 🔄 刷新 → 关掉旧设置页重开
```

> Chrome 只在**加载扩展的那一刻**读取代码，之后一直用内存里的副本。
> 改了磁盘文件不点刷新不会生效 —— 这是 Chrome 的正常行为，不是插件的问题。

---

## 安全提醒

插件把校园网账号密码保存在浏览器扩展存储（`chrome.storage.local`）中，**明文**。

- 本仓库**从创建起就是私有仓库**（已通过三项独立核对：GitHub 公开仓库列表中无此仓库、
  匿名访问返回 404、Software Heritage 公网存档中无此 origin），
  校园网凭据**从未出现在公网**；该账号其余公开仓库经抽查（尤其是同为 Batchfile 的
  `Harness`）均不含该凭据。
- 早期历史提交中确曾包含真实账号与初始密码，现已用 `git filter-repo` 完整重写，
  相关对象已在本地与远端**物理回收**（`git log --all -S<账号>` 与 `-S<密码>` 均为 0 命中）。
  **即使将来把仓库转为公开，也不会带出凭据。**
- 因此凭据的实际风险面**只有你的本机**：Chrome 扩展存储（`chrome.storage.local`）为本地明文。
  这是自动登录功能的固有前提，无法规避；公用电脑使用完毕后请清空插件设置页里的账号密码。
- 本仓库当前 HEAD **不含任何真实凭据**；`.gitignore` 也已排除插件「导出配置」生成的明文备份。
- 门户通信是**明文 HTTP**，同网段可被嗅探 —— 这是校园网本身的限制，插件无法规避。

### 历史自检（随时可跑）

```powershell
git log --all --oneline -S'<旧账号>'
git log --all --oneline -S'<旧密码>'
```

两条命令输出为空，即表示全部历史提交中已无凭据残留。

### 历史脱敏工具（当前无需执行）

> 本仓库历史**已清洗完成**。`clean_history.ps1` 带有「凭据必须真实存在于历史中」的前置校验，
> 对已清洗的仓库会在改写任何内容之前安全退出，属于预期行为，无需（也无法）再次执行。

```powershell
pip install git-filter-repo
powershell -File clean_history.ps1 -ForcePush
```

脚本会在重写前校验「你输入的凭据确实存在于历史中」，重写后执行多层自检
（目标归零 / `config.json` 已抹除 / 无凭据字面量残留 / 旧对象已物理回收），
任何一项不通过都会**阻断推送**，避免"改了但没改干净"的假成功。

---

## 适配其他高校网关

本扩展默认针对 `http://172.30.100.2/`（常见于许多高校的 Dr.COM / ePortal 认证系统）。如果您的学校也是同类型系统但网关 IP 不同（例如 `10.x.x.x` 或其他内网地址），仅需两步即可完成适配：

1. **修改通信清单 [manifest.json](chrome-extension/manifest.json)**：
   将 `host_permissions` 与 `content_scripts.matches` 中的 `http://172.30.100.2/*` 改为你学校的网关地址（如 `http://10.10.10.1/*`）。
2. **修改网关常量 [background.js](chrome-extension/background.js)**：
   将第 16 行的 `const PORTAL_HOST = '172.30.100.2';` 替换为您学校的网关 IP。

---

## 免责声明

1. 本项目仅供网络技术学习交流与校园网合规个人自用，作者不对因使用本程序产生的任何网络中断、资费变动或账号异常承担连带责任。
2. 请使用者自觉遵守所在高校的《校园网络安全管理规定》与信息化服务条款，切勿将本工具用于恶意并发攻击、违规代理或商业用途。

---

## 开源协议

本项目基于 [MIT License](LICENSE) 协议开源。
