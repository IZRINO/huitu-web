# 安装技能与运行工具

技能包与运行工具是两层：安装技能提供操作知识，安装 CLI 提供实际执行能力。仅复制本技能目录不会安装 CLI 或配置凭据。

## 安装技能

仓库：<https://github.com/IZRINO/huitu-web>，技能目录：`skills/huitu-image`。

支持 Agent Skills 的安装器可直接安装此目录。例如：

```sh
npx skills add IZRINO/huitu-web --skill huitu-image
```

也可把整个 `skills/huitu-image` 目录（包括 `agents` 与 `references`）复制到目标 agent 的技能目录。Codex 使用 `$CODEX_HOME/skills/huitu-image`，未设置 `CODEX_HOME` 时使用 `~/.codex/skills/huitu-image`。其他 agent 使用其支持的技能目录。不要只复制 `SKILL.md`。安装后按宿主要求重新加载技能或开启新会话。

## 运行工具：复用优先

先尝试 `huitu --help`。已有可用 CLI 时无需再次克隆。当前仓库有 `bin/huitu.mjs` 时可直接复用，但先确认已构建 `dist-cli/cli/main.js`。

需要 Git、npm，以及 Node.js 20.19+（20 系列）或 22.12+。依赖中含编译器，安装时保留开发依赖。仓库未发布 npm 包，不使用 `npm install -g huitu-web` 猜测安装来源。

## 全新运行环境

选择用户缓存目录安装运行工具，不把它放进业务项目。以下默认路径仅用于首次安装；目录已存在时先检查内容和远程地址，复用正确仓库，不覆盖或删除已有目录。

PowerShell：

```powershell
$huituRuntime = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'huitu-cli'
git clone --depth 1 https://github.com/IZRINO/huitu-web.git $huituRuntime
Set-Location $huituRuntime
npm ci --ignore-scripts --include=dev
node node_modules/typescript/bin/tsc -p tsconfig.cli.json
node bin/huitu.mjs --help
```

POSIX shell：

```sh
huitu_runtime="${XDG_DATA_HOME:-$HOME/.local/share}/huitu-cli"
mkdir -p "$(dirname "$huitu_runtime")"
git clone --depth 1 https://github.com/IZRINO/huitu-web.git "$huitu_runtime"
cd "$huitu_runtime"
npm ci --ignore-scripts --include=dev
node node_modules/typescript/bin/tsc -p tsconfig.cli.json
node bin/huitu.mjs --help
```

逐步检查退出码，失败停止后续步骤。帮助输出必须包含 `generate`、`batch`、`jobs`；不能仅凭退出码判断安装成功。`--ignore-scripts` 后显式调用编译器，避免安装生命周期或 shell 包装器静默跳过构建。

后续从用户项目调用 `node` 加运行工具 `bin/huitu.mjs` 的绝对路径即可；无需全局安装。用户需要全局命令时可在运行工具目录执行 `npm link --ignore-scripts`，随后验证 `huitu --help`。包装器有问题时保留绝对路径调用。

## 首次配置

下列示例中的接口地址、模型名、配置名和路径由用户实际选择替换，不把示例值当作已配置服务。密钥从已有环境变量或用户本地配置读取。示例假定位于运行工具目录：

```sh
node bin/huitu.mjs profile set main --base-url https://example.com/v1 --model user-selected-model --api-key-env HUITU_API_KEY
node bin/huitu.mjs profile use main
node bin/huitu.mjs config set --output-dir ./images --concurrency 3
node bin/huitu.mjs models probe --profile main --json
```

在首次运行配置命令前设置 `HUITU_API_KEY`；后台已经启动时，更新环境变量后执行 `worker restart`。`models probe` 仅检查连接，模型接口可能不提供列表；它不是实际生图验证。

需要同步网页参数时导入网页导出的 JSON：`config import --input huitu-config.json --profile main`。密钥不会从导入文件覆盖本地值，代理默认改为直连。

完整参数和真实生图调用见 [CLI 参考](cli.md)。
