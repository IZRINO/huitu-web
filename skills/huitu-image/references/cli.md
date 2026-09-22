# 绘途 CLI

独立于网页的本地生图工具。支持全部网页参数、多个模型配置、持久共享队列、自动下载。无需启动网页或浏览器。多个 agent 使用同一个 `HUITU_HOME` 时，共享默认三个并发名额。

## 安装与快速开始

本技能已包含编译后的 CLI，只需 Node.js 20.19+（20 系列）或 22.12+。按 [直接运行说明](install.md) 找到当前技能的 `scripts/huitu.mjs`，执行：

```sh
node /absolute/path/to/huitu-image/scripts/huitu.mjs --help
```

下文所有 `huitu` 均为 `node` 加此入口绝对路径的简写，不要求全局命令。无需安装项目依赖、克隆仓库或编译。

```powershell
$env:HUITU_API_KEY = '你的密钥'
huitu config set --output-dir "D:\images" --concurrency 3
huitu profile set main --base-url "https://你的中转/v1" --model "你的模型" --api-key-env HUITU_API_KEY
huitu profile use main
huitu worker restart
huitu models probe
huitu generate --prompt "白色背景上的红色汽车" --wait --json
```

环境变量密钥由后台启动时继承。后台已经启动后修改环境变量，执行 `worker restart` 使其生效。也可通过 `profile set main --api-key "密钥"` 保存本地密钥；密钥不写入任务记录、结果清单或配置导出。后台日志和错误消息对当前已配置密钥与额外请求头值进行脱敏。

输出目录自动创建。每个任务使用独立子目录：

```text
D:\images\<任务编号>\01.png
D:\images\<任务编号>\02.png
D:\images\<任务编号>\result.json
```

扩展名依据返回图片实际格式确定。只有全部最终图片保存成功，任务才标记 `succeeded`。中间帧不会保存为成片。

## 配置、模型与参数

```powershell
huitu config init
huitu config show --json
huitu config set --output-dir "D:\images" --concurrency 3 --generation-timeout 600 --download-timeout 60
huitu profile set fast --base-url "https://你的中转/v1" --model "快速模型" --api-key-env FAST_KEY --quality low
huitu profile list
huitu profile show fast
huitu profile use fast
huitu profile remove old
huitu models list --profile fast
```

配置优先级：内置默认 → 全局 `config set` → 命名 `profile set` → 单任务参数。`outputDir` 同样遵循此优先级；并发与超时是全局配置。修改并发立即影响后续派发，降低并发不会取消已有任务。参数、超时、输出路径与凭据均在入队时固定；凭据保存于单独的本地受限权限文件，修改配置不会把新密钥发送到旧任务地址。密钥更新仅用于新任务，显式重试沿用原任务快照。尚有未完成任务的配置不能删除。

| 命令参数 | JSON 字段 | 默认／范围 |
| --- | --- | --- |
| `--base-url` | `settings.baseUrl` | `https://api.openai.com/v1` |
| `--model` | `settings.model` | 当前网页默认模型；允许任意非空名称 |
| `--api-key` | `settings.apiKey` | 仅配置命令接受，不接受任务内密钥 |
| `--api-key-env` | `apiKeyEnv` | 可选；设置后优先于本地密钥 |
| `--organization` | `settings.organization` | 空 |
| `--extra-headers` | `settings.extraHeaders` | JSON 字符串，所有值必须为字符串 |
| `--relay-url` | `settings.relayUrl` | 绝对代理地址，例如 `http://127.0.0.1:4173/api/relay` |
| `--use-proxy` / `--no-use-proxy` | `settings.useProxy` | CLI 默认 `false`；指定代理地址自动启用 |
| `--quality` | `params.quality` | `auto`；可选 `low/medium/high/xhigh/max` |
| `--background` | `params.background` | `auto`；可选 `transparent/opaque` |
| `--format` | `params.format` | `png`；可选 `webp/jpeg` |
| `--compression` | `params.compression` | `100`；范围 `0–100`，PNG 不发送此字段 |
| `--moderation` | `params.moderation` | `auto/low` |
| `--fidelity` | `params.fidelity` | `high/low`，只用于改图 |
| `--n` | `params.n` | `1`；范围 `1–10` |
| `--stream` / `--no-stream` | `params.stream` | `false` |
| `--partial-images` | `params.partialImages` | `2`；范围 `0–3`，流式开启时发送 |
| `--size-mode` | `params.sizeMode` | `preset`；可选 `auto/aspect/custom` |
| `--size-preset` | `params.sizePreset` | `1024x1024` |
| `--aspect` | `params.aspect` | `1:1`；可选 `3:2/2:3/4:3/3:4/16:9/9:16/21:9` |
| `--long-edge` | `params.longEdge` | `1024`，按网页逻辑对齐和修正 |
| `--custom-w` / `--custom-h` | `params.customW/customH` | `1024/1024`，按网页逻辑对齐十六倍数 |
| `--output-dir` | `outputDir` | `~/Pictures/huitu` |

尺寸快捷参数：`--size auto` 或 `--size 1536x1024`。不能与其他尺寸参数同时使用。未显式指定 `--size-mode` 时，`--aspect/--long-edge` 自动选择比例模式，`--custom-w/--custom-h` 选择自定义模式。最终尺寸遵循网页已有校验规则，不替上游保证模型能力。

提示词使用 `--prompt`、`--prompt-file UTF8文件` 或 `--prompt-file -`；没有显式提示词参数时读取管道输入。长度 `1–32000`。布尔参数用开关或否定开关，不使用 `--stream false`。

改图示例：

```powershell
huitu edit --profile main --prompt-file edit.txt --image "D:\input\底图.png" --image "D:\input\参考.webp" --mask "D:\input\蒙版.png" --fidelity high --n 2 --wait --json
```

参考图最多十六张，每张不超过 50 MiB，支持 PNG/JPEG/WebP；蒙版必须 PNG，透明区域用于修改。入队时复制输入文件，因此删除或修改原文件不影响队列中的任务。

导入网页导出的配置：

```powershell
huitu config import --input huitu-config.json --profile main
huitu config export --output cli-config.json
```

网页配置导入不会覆盖密钥；网页同源代理开关被转换为直连并输出提示，需要代理时再设置 `--relay-url`。CLI 导出同时包含所有命名配置；密钥与额外请求头内容留空，导入后需要重新补充额外请求头。导出的 JSON 可直接导入；仅密钥始终保留本地已有值。

## 队列、生命周期与失败恢复

```powershell
huitu generate --prompt-file prompt.txt --json
huitu jobs list --status queued --json
huitu jobs show TASK_ID --json
huitu jobs wait TASK_ID --wait-timeout 120 --json
huitu jobs cancel TASK_ID --json
huitu jobs retry TASK_ID --wait --json
huitu worker status --json
huitu worker stop
huitu worker start
huitu worker restart
```

默认提交立即返回编号，后台继续执行。`--wait` 等到任务终态；等待超时或结束等待进程不会取消任务。`worker stop` 停止新派发并等待活动任务完成；重启后继续处理待执行任务。未安装开机启动服务，电脑重启后执行 `worker start` 或其他需要后台的命令恢复队列。

并发以任务为单位，覆盖生成到下载全过程。一个任务即使 `--n 10` 仍占一个名额。按入队顺序派发，网络到达和完成顺序可以不同。

状态：`queued → running → downloading → succeeded`；异常终态为 `failed/cancelled/interrupted`。默认生成超时 600 秒，单次下载超时 60 秒。

生成失败不自动重试。崩溃发生在生成阶段且没有响应检查点时，标记 `interrupted`，需要显式 `jobs retry`。有已保存响应的下载任务会自动恢复；下载失败自动再试两次，仍失败则保留已成功文件。显式重试创建新任务，记录 `parentId`；若已有响应检查点，复用它下载，不重新请求生图。原始结果 URL 过期后可能无法继续下载，需新建生图任务。

数据默认存放于 `~/.huitu`：配置、单任务记录、凭据快照、输入快照、响应检查点与后台日志。使用 `--home` 或 `HUITU_HOME` 隔离其他队列。CLI 与网页不共享历史记录。本地 IPC 使用命名管道／Unix socket；后台还占用一个由数据目录哈希确定的回环 TCP 端口作为操作系统管理的单实例锁，不在该端口提供业务服务。端口冲突会启动失败并记录端口号，可调整 `HUITU_HOME` 避开冲突。

## Agent 调用契约

Agent 使用普通 shell 调用，无需 MCP 服务。机器调用加 `--json`，标准输出为单份 JSON，日志在标准错误。`--help` 输出纯文本；`config export` 不指定文件时输出原始可导入配置 JSON。

```json
{
  "schemaVersion": 1,
  "ok": true,
  "data": {
    "id": "任务编号",
    "status": "succeeded",
    "files": ["D:\\images\\任务编号\\01.png"],
    "usage": { "total_tokens": 123 }
  }
}
```

命令错误返回 `ok:false,error:{code,message}`。任务失败则命令解析成功，返回 `ok:true,data.status:"failed"`，并包含任务 `error:{code,message,phase}`。必须同时检查退出码和任务状态。

| 退出码 | 含义 |
| --- | --- |
| `0` | 命令成功；仅提交成功不表示已生成 |
| `1` | 等待的任务失败／取消／中断，或运行错误 |
| `2` | 参数、配置或任务编号错误 |
| `3` | 等待超时，任务继续执行 |

批量 JSON 文件支持以下结构，字段名与类型严格校验，未知字段报错：

```json
[
  {
    "mode": "generate",
    "profile": "main",
    "prompt": "简洁产品海报",
    "params": { "quality": "high", "sizeMode": "aspect", "aspect": "16:9", "longEdge": 2048 },
    "outputDir": "D:\\images\\campaign"
  },
  {
    "mode": "edit",
    "profile": "main",
    "prompt": "背景改为白色",
    "images": ["D:\\input\\product.png"],
    "params": { "fidelity": "high", "n": 2 }
  }
]
```

```powershell
huitu batch --input jobs.json --wait --json
```

批量输入路径相对于调用进程当前目录解析。单个参数错误阻止本批入队。建议 agent 一次提交批次，保存任务编号，随后调用 `jobs wait`，最终根据 `files` 读取图片。输出为绝对路径。

## 维护者验证（仅源码仓库）

```powershell
npm run build:skill
npm run test:skill
npm run test:cli
npm run lint
npm run build
```

测试使用本地模拟服务，不访问真实模型，不产生生图费用。包括跨进程并发、完整参数、流式多图、改图、下载失败、取消、持久恢复和密钥脱敏。
