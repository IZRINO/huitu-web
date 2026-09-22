# 绘途 · 蓝晒工坊

自定义中转站地址的 GPT Image 出图与改图台。对接 OpenAI 兼容的 `v1/images/generations` 与 `v1/images/edits`，可改模型名、比例、质量、分辨率，并支持参考图与蒙版编辑。密钥只存在本机浏览器，不经过第三方后端。

默认视觉按晒蓝工坊铺开：出图是曝光，改图是水洗，历史是底片，下载是定影。

## 功能

- 自定义中转站根地址、密钥、模型名、组织号、额外请求头
- 同源代理转发，避开浏览器跨域；也可直连中转站
- 出图 / 改图同一画布，成片可落成下一轮底图
- 质量：`auto` `low` `medium` `high` `xhigh` `max`
- 画幅：常用档、比例、自定义宽高、自动；按官方约束校验（十六倍数、长宽比不超过 3:1、长边不超过 3840、总像素 655360–8294400）
- 透明底、png / webp / jpeg、压缩、审核档、流式中间帧、一次 1–10 张
- 最多 16 张参考图（png / jpg / webp，单张小于 50MB），拖入、粘贴、点击添加
- 蒙版涂改：透明区域被改写
- 对照滑杆、多张选片、中止、下载、复制
- 底片历史存 IndexedDB（最多 80 张）
- 配置导出 / 导入（导入不覆盖密钥）、探测连通

## 环境

- Node.js 20 或以上
- 兼容 OpenAI Images API 的中转站，以及对应密钥

官方模型名示例：

- `gpt-image-2.5-sunburst`
- `gpt-image-2.5-sunburst-2026-09-08`
- `gpt-image-2.5-flare`
- `gpt-image-2`

文档：<https://developers.openai.com/api/docs/guides/image-generation>

## 使用

### 命令行与 Agent 自动生图

标准 Agent Skill 安装：

```sh
npx skills add IZRINO/huitu-web --skill huitu-image
```

技能入口：[skills/huitu-image/SKILL.md](skills/huitu-image/SKILL.md)。包内包含全部已编译 CLI 文件；本机有 Node.js 即可直接执行 `node <技能目录>/scripts/huitu.mjs --help`，无需另行安装依赖或编译。也可将整个 `skills/huitu-image` 目录复制到 agent 的技能目录。

维护者修改 CLI 源码后运行 `npm run build:skill`，将编译文件一并提交；`npm run test:skill` 检查产物同步，并在仓库外临时目录运行整套 CLI 集成测试。

已提供独立 `huitu` CLI：支持网页全部参数、多组模型配置、持久共享队列（默认三个并发）、自动下载。完整安装、参数表和 agent 调用契约见 [CLI 文档](docs/cli.md)。

```powershell
npm install
npm link
huitu config set --output-dir "D:\images" --concurrency 3
huitu profile set main --base-url "https://你的中转/v1" --model "你的模型" --api-key-env HUITU_API_KEY
huitu generate --profile main --prompt-file prompt.txt --wait --json
```

调用前设置密钥环境变量；若后台已启动，修改环境变量后执行 `huitu worker restart`。

### 网页

```bash
npm install
npm run dev
```

浏览器打开 <http://127.0.0.1:5173>。点右上角「中转站」：

1. 接口根地址填到 `/v1` 这一级，例如 `https://api.openai.com/v1` 或 `https://你的中转/v1`
2. 填密钥
3. 确认模型名
4. 默认勾选同源代理
5. 可点「探测连通」

出图写配方后点「曝光」（`Ctrl+Enter`）。改图切到「改图」，拖入底图或把当前片落底，再点「水洗」。

生产构建：

```bash
npm run build
npm start
```

`npm start` 会托管 `dist` 并继续提供 `/api/relay`。端口默认 `4173`，可用环境变量 `PORT` 修改。

开发预览（同样带代理）：

```bash
npm run preview
```

## 快捷键

| 键 | 作用 |
| --- | --- |
| `Ctrl+Enter` / `Cmd+Enter` | 曝光或水洗 |
| `Ctrl+S` / `Cmd+S` | 下载当前片 |
| `Esc` | 关闭中转站面板，或中止进行中的请求 |
| 粘贴图片 | 作为改图底图 |

## 接口对应

根地址为 `{BASE}` 时：

| 工序 | 方法 | 路径 |
| --- | --- | --- |
| 出图 | `POST` | `{BASE}/images/generations` JSON |
| 改图 | `POST` | `{BASE}/images/edits` multipart |
| 探测 | `GET` | `{BASE}/models` |

GPT Image 模型返回 `b64_json`。同源代理把浏览器请求转到 `/api/relay`，用请求头携带目标：

- `x-relay-url` 完整上游地址
- `Authorization` 原样转发
- `x-relay-organization` 映射为 `OpenAI-Organization`
- `x-relay-headers` 额外 JSON 头

代理拒绝转发到链路本地元数据地址。

## 数据存放

| 数据 | 位置 |
| --- | --- |
| 中转站与参数 | `localStorage`：`huitu.settings.v1`、`huitu.params.v1` |
| 底片 | IndexedDB：`huitu-prints` |
| 密钥 | 仅本机，导出配置时留空 |

## 目录

```
huitu-web/
  src/
    App.tsx                 工作台
    components/             底片栏、蒙版、中转站面板
    lib/                    请求、尺寸校验、本地存储
  public/favicon.svg
  vite.config.ts            开发 / preview 同源代理
  server.mjs                生产静态托管 + 代理
```

## 脚本

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 开发 |
| `npm run build` | 类型检查并打包 |
| `npm run preview` | 预览打包结果 |
| `npm start` | 生产托管 |
| `npm run lint` | Oxlint |
