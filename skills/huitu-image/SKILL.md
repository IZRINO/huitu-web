---
name: huitu-image
description: 使用绘途 CLI 通过自定义 OpenAI Images 兼容接口生图、批量生图或参考图及蒙版改图。支持命名模型配置、持久共享队列、默认三并发、自动下载和结构化任务结果；适用于用户要求调用绘途或自有生图中转站的任务。
---

# 绘途生图

使用本地 CLI 完成生成与文件落盘；无需浏览器、网页服务或 MCP。

## 准备

1. 优先复用已安装的 `huitu`，执行 `huitu --help` 确认确有帮助输出。不存在或运行失败时，阅读 [安装与运行环境](references/install.md)，安装独立运行工具。技能目录本身不包含 CLI 可执行文件。
2. 用 `profile list --json`、`config show --json` 确认现有配置。复用用户选择的配置，不擅自替换模型、中转站或输出目录。缺少接口、模型或凭据时，只询问缺少的值；密钥可由用户设置为环境变量，不要求在对话中公开。
3. 有全局命令时使用 `huitu`；否则所有示例中的 `huitu` 替换为 `node` 加已安装仓库中 `bin/huitu.mjs` 的绝对路径。从任意项目目录调用均保持同一个 `HUITU_HOME`，才能共享三个并发名额。

## 提交与取回图片

- 提示词写入 UTF-8 文件，通过 `--prompt-file` 传入，避免 shell 转义损坏长提示词。文件路径使用绝对路径。
- 单次生成：`huitu generate --profile main --prompt-file prompt.txt --json`。
- 改图：`huitu edit --profile main --prompt-file prompt.txt --image input.png --mask mask.png --json`；`--image` 可重复，蒙版可省略。
- 多任务先编写 JSON 数组，再执行 `huitu batch --input jobs.json --json`；不要启动彼此隔离的队列规避并发限制。
- 保存返回的任务编号，再执行 `huitu jobs wait TASK_ID --wait-timeout 120 --json`。短任务也可在提交时指定 `--wait`。
- 只有 `data.status` 为 `succeeded` 才宣布完成；从 `data.files` 获取真实绝对路径，检查文件存在后向用户展示或交给后续工具。不要编造输出路径。
- 需要参数、批量 JSON 格式、配置命令或退出码细节时，阅读 [CLI 完整参考](references/cli.md)。所有当前网页生图参数均可设置；不确定选项时使用 `--help`，不要猜测标志名。

## 队列与失败处理

- 提交成功仅表示入队。一个任务可生成一至十张图片，但仅占一个并发名额；后台默认同时处理三个任务，生成至下载全过程计入名额。
- 机器调用使用 `--json`。同时检查退出码、`ok` 和任务 `status`：任务失败仍可能返回 `ok:true`。退出码 `3` 仅表示等待超时，继续等待原编号，不重新提交。
- 命令被中断或响应丢失时，先通过 `jobs list/show` 查找既有任务。不要把通信失败当成任务未提交。
- 下载会自动重试两次；仍失败时先检查 `error.phase`。已有响应检查点的 `jobs retry TASK_ID` 会复用生成结果，创建带 `parentId` 的新任务；继续等待新编号。
- 生成失败或 `interrupted` 不会自动重发。是否显式重试以用户任务授权与预算为准；没有重试授权时报告状态，不循环重试。已计费但响应丢失的生成无法保证去重。
- `jobs cancel` 取消指定任务；退出等待不会取消任务。不要为单任务错误停止整个共享后台。
- 环境变量密钥在后台启动时继承；变量变更后仅在确有需要时执行 `worker restart`，它会等待现有活动任务结束。排队任务的参数和凭据已固定，改配置不会更新旧任务；新凭据需要新建任务。
- 用户未要求修改并发时保留默认值。未配置真实接口时可完成安装与帮助检查，但不声称已验证真实生图。
