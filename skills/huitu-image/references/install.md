# 安装后直接调用

技能包包含全部已编译 JavaScript 文件及独立 ESM 模块声明。运行时只使用 Node.js 内置模块；无需 Git、npm、项目源码、全局命令或额外依赖。唯一运行要求是本机有 Node.js 20.19+（20 系列）或 22.12+。

## 安装技能

```sh
npx skills add IZRINO/huitu-web --skill huitu-image
```

上述命令是可选的技能安装方式，安装器本身使用 npm。没有 npm 时，直接复制或下载完整 `skills/huitu-image` 文件夹到 agent 的技能目录即可，运行工具仍不依赖 npm。必须保留 `scripts/runtime` 全部文件及其中的 `package.json`。

Codex 可使用 `$CODEX_HOME/skills/huitu-image`，未设置时使用 `~/.codex/skills/huitu-image`；其他安装器可能使用项目 `.agents/skills/huitu-image`。以宿主实际加载的 `SKILL.md` 路径确定技能目录，不假定某个固定路径。安装后按宿主要求重新加载技能或开启新会话。

## 调用入口

相对于技能目录，入口是 `scripts/huitu.mjs`。无需切换到技能目录；所有任务文件路径建议使用绝对路径。参考文档中 `huitu` 均为此入口的简写。

以下示例采用用户级 Codex 默认位置；实际目录不同时替换变量值。

PowerShell：

```powershell
$huituSkillDir = Join-Path $env:USERPROFILE '.codex/skills/huitu-image'
$huituEntry = Join-Path $huituSkillDir 'scripts/huitu.mjs'
node $huituEntry --help
node $huituEntry profile list --json
```

POSIX shell：

```sh
huitu_skill_dir="${CODEX_HOME:-$HOME/.codex}/skills/huitu-image"
huitu_entry="$huitu_skill_dir/scripts/huitu.mjs"
node "$huitu_entry" --help
node "$huitu_entry" profile list --json
```

帮助输出必须包含 `generate`、`batch`、`jobs`。若缺少编译文件，重新安装完整技能包；不要改成克隆源码并安装依赖。缺少 Node.js 时说明运行时要求，不声称已可执行。

## 配置模型与生成

复用已有 profile；仅在未配置时新增。下面的接口和模型是示例，使用用户给定值。先在当前 shell 设置用户已有的 `HUITU_API_KEY` 环境变量；不在回复中输出密钥。

```powershell
node $huituEntry profile set main --base-url https://example.com/v1 --model user-selected-model --api-key-env HUITU_API_KEY
node $huituEntry profile use main
node $huituEntry config set --output-dir "D:/images" --concurrency 3
node $huituEntry generate --profile main --prompt-file "D:/prompts/image.txt" --wait --json
```

POSIX shell 使用 `node "$huitu_entry"` 替代 `node $huituEntry`。后台已经启动时，修改环境变量需执行 `worker restart`；队列中的旧任务继续使用原凭据快照。

默认配置和队列位于 `~/.huitu`，图片默认位于 `~/Pictures/huitu`，不会写入技能目录。可以通过 `HUITU_HOME`、`--home` 和 `--output-dir` 调整。多个 agent 使用同一个数据目录才共享并发上限。

升级技能前用旧入口执行 `worker stop`，等待 `worker status` 显示后台已退出再替换技能文件；重新调用会启动新版后台并恢复队列。不要在仍有后台依赖当前技能路径时删除或移动目录。

全部生成参数、批量 JSON 和状态处理见 [CLI 参考](cli.md)。
