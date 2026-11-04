# codexsw

Windows、macOS、Linux 通用的 Codex 多账号切换工具。

```sh
codexsw 1       # 原账号
codexsw 2       # 第二个账号；第一次使用时打开官方登录
codexsw 3       # 继续添加第三个账号
codexsw 10      # 编号可以跳号
codexsw status  # 查看当前选择
```

每个账号各登录一次，以后用同一条命令切换。编号最小为 `1`，账号数量和编号均不设最大值；实际容量取决于本机资源和凭据存储服务。需要 **Node.js 20+、npm**，添加账号时还需要 **Codex CLI**。没有第三方运行依赖。

[English](README.en.md) · [凭据处理](SECURITY.md) · [开发与测试](CONTRIBUTING.md)

## 安装

三个系统均可直接安装，不需要先安装 Git：

```sh
npm install --global https://github.com/Light-yzc/codex-switch/archive/refs/tags/v0.2.0.tar.gz
```

或者下载、克隆本仓库，进入目录后安装：

```sh
npm install --global .
```

若全局 npm 目录需要管理员权限，使用下面的用户目录安装方式：

| 平台 | 在仓库目录中执行 | 默认命令位置 |
| --- | --- | --- |
| Windows PowerShell | `.\install.ps1` | `%USERPROFILE%\.local\bin` |
| macOS / Linux | `sh ./install.sh` | `~/.local/bin` |

安装脚本先打包再安装，删除下载的源码也不会影响命令。无需管理员权限。Unix 如提示找不到命令，将 `~/.local/bin` 加入 PATH：

```sh
export PATH="$HOME/.local/bin:$PATH"
```

将这一行加入对应 shell 的配置文件即可长期生效。Windows 安装脚本自动加入用户 PATH；旧终端需要重开。安装脚本不改变 PowerShell 执行策略。已有 Windows v1 脚本会备份，其 DPAPI 账号库可以继续使用。

## 第一次使用

如果已经登录了原账号：

```sh
codexsw 1
codexsw 2
codexsw 3
```

空账号库会先把已有的当前登录登记为 `1`。执行任何未登记的编号（例如 `2`、`3`、`10`），都会在独立的临时登录目录中启动官方 `codex login`。在浏览器选择该编号对应的账号。登录成功并检查账号身份后才切换，取消登录或选成同一个账号均保留原登录。

尚未登录时先执行 `codexsw setup`，再执行 `codexsw 1`；也可以直接从其他正整数编号开始。每次首次使用新编号都可继续添加账号。

编号只接受不带前导零的十进制正整数：`1`、`3`、`42`、`1000` 都有效，`0`、负数、小数、`01` 和 `1e3` 无效。编号无需连续，超出 JavaScript 安全整数范围的编号也不会被取整。

如果 Codex 配置为系统钥匙串或 `auto`，工具会停止并提示：

```sh
codexsw setup
codexsw login 1
codexsw 2
```

`setup` 会先备份 `config.toml`，再设置 `cli_auth_credentials_store = "file"`，保留其他配置。组织策略可能禁止这个设置；本工具不覆盖组织策略。

## 切换作用于哪些客户端

Codex CLI、VS Code 扩展、Codex 桌面端**共用同一个 `CODEX_HOME` 且使用文件凭据时**，切换的是同一份 `auth.json`，默认位置是 `~/.codex/auth.json`。CLI 和 IDE 共用登录缓存见 [OpenAI 官方说明](https://learn.chatgpt.com/docs/auth#login-caching)。

切换后：

- 终端：结束旧 Codex 会话，重新打开。共享后台服务也可能需要重新启动。
- VS Code：`Ctrl/Cmd+Shift+P` → `Developer: Reload Window`。
- 桌面端：完全退出并重新打开，核对账号菜单。

无需重启电脑。工具不终止正在工作的客户端；它们可能仍持有旧凭据并刷新回磁盘，请在空闲时切换，及时重载。`status` 的星号只表示磁盘上的登录文件，不能证明已运行客户端已经换号。

Windows 与 WSL 是不同环境，默认不会共用账号文件。自定义 `CODEX_HOME` 的客户端也要使用相同目录。

## 命令手册

下面的 `N` 表示任意正整数编号；输入时不要带尖括号。

| 命令 | 用途 |
| --- | --- |
| `codexsw N` | 选择编号 N；未登记时启动官方登录并添加 |
| `codexsw` / `codexsw status` / `codexsw list` | 按数字顺序列出全部已保存编号、完整邮箱、套餐、工作区 ID 和备份方式 |
| `codexsw save N` | 将当前手动登录登记到编号 N；已有编号仅允许保存同一账号 |
| `codexsw login N` | 重新授权编号 N 并切换；未登记时添加 |
| `codexsw forget N` | 删除编号 N 的备份，保留当前登录文件 |
| `codexsw setup` | 备份配置并启用 Codex 文件凭据 |
| `codexsw unlock` | 清理已退出进程留下的切换锁 |
| `codexsw help` | 查看选项 |
| `codexsw --version` | 查看已安装版本 |

例如，添加账号 3、重新授权账号 10、删除账号 42：

```sh
codexsw 3
codexsw login 10
codexsw forget 42
```

`status` 会按 `1、2、3、10、42……` 排序，只列出已登记编号，不创建缺号。同一用户的同一工作区不能登记到多个编号。同一邮箱下的个人工作区和 Team 工作区可以分别保存到不同编号；登录时请选择对应工作区。列表和切换结果显示完整邮箱、套餐与工作区 ID（套餐未知时显示 `unknown plan`），多个 Team 工作区也可通过 ID 区分。

替换某个编号的账号时，先切到另一个已保存账号，再执行 `forget N` 和 `codexsw N`。例如替换账号 3：先 `codexsw 1`，再 `codexsw forget 3`，最后 `codexsw 3`。正在选中的账号若未登记，切换会暂停并要求先 `save N`，避免丢失登录。

远程或无浏览器环境可使用官方设备码登录：

```sh
codexsw 3 --device-auth
```

设备码登录需要账号或工作区允许该功能。此工具不会保存密码，也不提供账号注册或订阅功能。

| 选项 | 作用 |
| --- | --- |
| `--device-auth` | 添加或重新授权时使用官方设备码登录 |
| `--storage BACKEND` | 首次保存前选择 `dpapi`、`keychain`、`file` 或 `secret-service`；可用方式取决于平台 |
| `--codex-home PATH` | 指定要切换的 Codex home，默认取 `CODEX_HOME` 或 `~/.codex` |
| `--state-dir PATH` | 指定本地账号备份目录 |
| `-h` / `--help` | 查看命令帮助 |

## 从旧版升级

重新运行安装命令，或在新版源码目录执行原来的 `install.ps1` / `install.sh`。无需重新登记已有账号 `1`、`2`，它们的编号、凭据和备份位置均保留。

新增编号后请继续使用 `v0.2.0` 或更新版本；旧双账号版不认识大于 `2` 的编号，会拒绝读取该账号库。

## 账号备份

Codex 自身使用文件登录；**codexsw 的备份方式是另一层**：

| 平台 | 默认备份 | 说明 |
| --- | --- | --- |
| Windows | Windows DPAPI | 当前 Windows 用户加密，兼容原 PowerShell 版 |
| macOS | AES-256-GCM + 登录钥匙串 | 文件加密，随机密钥放在 Keychain |
| Linux | 私有文件 | 目录 `0700`、文件 `0600`，不加密，无桌面环境也能用 |

Linux 桌面环境可安装 `secret-tool`，在首次登记前选择系统密钥环：

```sh
codexsw 1 --storage secret-service
```

选定后会记住该方式；密钥环出错时不会悄悄降级为明文文件。macOS 无法使用 Keychain 的环境，可在首次登记前显式选择 `--storage file`。已有账号库不允许直接更改备份方式。

默认位置，每个 Codex home 单独保存：

- Windows：`%LOCALAPPDATA%\CodexSwitch\<home 哈希>`
- macOS：`~/Library/Application Support/codexsw/<home 哈希>`
- Linux：`${XDG_STATE_HOME:-~/.local/state}/codexsw/<home 哈希>`

需要自定义时：

```sh
codexsw status --codex-home /path/to/.codex --state-dir /private/state
```

切换前先回存 Codex 自动刷新的最新凭据，再原子替换目标登录文件。不要在不同电脑间复制旧的刷新凭据来同时使用。不要把真实 `auth.json`、账号库或临时登录目录提交到仓库。

## 开发、打包与验证

```sh
npm ci --ignore-scripts
npm run check
npm test
npm pack
```

生成的 `codex-account-switch-0.2.0.tgz` 可以离线分发：

```sh
npm install --global ./codex-account-switch-0.2.0.tgz
```

测试使用虚构账号、隔离目录和假的官方登录命令，不进行真实账号登录。覆盖多账号切换、旧版备份兼容、512 账号列表、跳号和超长编号、刷新凭据保存、重新授权、失败与重复登录、配置保护、锁、回滚和密钥环失败。

CI 配置覆盖 Windows/macOS/Linux，以及 Linux 上的 Node.js 20/22/24。Windows 测试使用真实 DPAPI，macOS 有原生 Keychain 测试，Linux 检查原生权限。密钥环的模拟测试不等于原生环境验证；新增 CI 需要推送到 GitHub 后实际运行。

MIT License。独立工具，与 OpenAI 官方无隶属关系。
