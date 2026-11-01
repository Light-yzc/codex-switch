# codexsw

Windows、macOS、Linux 通用的 Codex 双账号切换工具。

```sh
codexsw 1       # 原账号
codexsw 2       # 第二个账号；第一次使用时打开官方登录
codexsw status  # 查看当前选择
```

两份账号各登录一次，以后用同一条命令切换。需要 **Node.js 20+、npm**，添加账号时还需要 **Codex CLI**。没有第三方运行依赖。

[English](README.en.md) · [凭据处理](SECURITY.md) · [开发与测试](CONTRIBUTING.md)

## 安装

三个系统均可直接安装，不需要先安装 Git：

```sh
npm install --global https://github.com/Light-yzc/codex-switch/archive/refs/tags/v0.1.0.tar.gz
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
```

第一次执行 `1` 会自动登记当前登录；第一次执行 `2` 会在独立的临时登录目录中启动官方 `codex login`。在浏览器选择新订阅的账号。登录成功并检查账号身份后才切换，取消登录或选成同一个账号均保留原登录。

尚未登录时先执行 `codexsw setup`，再依次执行 `codexsw 1`、`codexsw 2`。

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

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `codexsw 1` / `codexsw 2` | 选择账号；未登记时启动官方登录 |
| `codexsw status` | 查看编号、脱敏邮箱和备份方式 |
| `codexsw save 1` / `codexsw save 2` | 将当前手动登录登记到指定编号 |
| `codexsw login 1` / `codexsw login 2` | 登录失效后重新授权并切换 |
| `codexsw forget 2` | 删除编号 2 的备份，保留当前登录 |
| `codexsw setup` | 备份配置并启用 Codex 文件凭据 |
| `codexsw unlock` | 清理已退出进程留下的切换锁 |
| `codexsw help` | 查看选项 |

替换已登记的第二个账号：先 `codexsw 1`，再 `codexsw forget 2`，最后 `codexsw 2`。正在选中的账号若未登记，切换会暂停并要求先 `save`，避免丢失登录。

远程或无浏览器环境可使用官方设备码登录：

```sh
codexsw 2 --device-auth
```

设备码登录需要账号或工作区允许该功能。此工具不会保存密码，也不提供账号注册或订阅功能。

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

生成的 `codex-account-switch-0.1.0.tgz` 可以离线分发：

```sh
npm install --global ./codex-account-switch-0.1.0.tgz
```

测试使用虚构账号、隔离目录和假的官方登录命令，不进行真实账号登录。覆盖双向切换、刷新凭据保存、当前账号重新授权、失败与重复登录、配置保护、锁、回滚和密钥环失败。

CI 配置覆盖 Windows/macOS/Linux，以及 Linux 上的 Node.js 20/22/24。Windows 测试使用真实 DPAPI，macOS 有原生 Keychain 测试，Linux 检查原生权限。密钥环的模拟测试不等于原生环境验证；新增 CI 需要推送到 GitHub 后实际运行。

MIT License。独立工具，与 OpenAI 官方无隶属关系。
