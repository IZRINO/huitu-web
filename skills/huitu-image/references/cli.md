# Huitu CLI

A local image-generation tool independent of the web app. Supports all web image parameters, multiple model profiles, a persistent shared queue, and automatic downloads. No web server or browser is required. Agents using the same `HUITU_HOME` share three concurrent job slots by default.

## Quick start

The skill includes the compiled CLI. Requires only Node.js 20.19+ in the 20.x series, or 22.12+. Follow the [direct execution instructions](install.md) to locate the skill's `scripts/huitu.mjs`, then run:

```sh
node /absolute/path/to/huitu-image/scripts/huitu.mjs --help
```

Every `huitu` command below is shorthand for `node` followed by this entrypoint's absolute path. No global command, dependency installation, repository clone, or compilation is required.

```powershell
$env:HUITU_API_KEY = 'your-api-key'
huitu config set --output-dir "D:\images" --concurrency 3
huitu profile set main --base-url "https://example.com/v1" --model "your-model" --api-key-env HUITU_API_KEY
huitu profile use main
huitu worker restart
huitu models probe
huitu generate --prompt "A red car on a white background" --wait --json
```

The worker inherits environment-variable credentials at startup. After changing them while the worker is running, use `worker restart`. Alternatively, `profile set main --api-key "your-api-key"` stores a local key. Keys are excluded from job records, result manifests, and configuration exports. Worker logs and error messages redact configured keys and extra-header values.

The output directory is created automatically, with a separate subdirectory for each job:

```text
D:\images\<job-id>\01.png
D:\images\<job-id>\02.png
D:\images\<job-id>\result.json
```

File extensions follow the actual returned image format. A job becomes `succeeded` only after all final images have been saved. Partial preview frames are not saved as final images.

## Configuration, models, and parameters

```powershell
huitu config init
huitu config show --json
huitu config set --output-dir "D:\images" --concurrency 3 --generation-timeout 600 --download-timeout 60
huitu profile set fast --base-url "https://example.com/v1" --model "fast-model" --api-key-env FAST_KEY --quality low
huitu profile list
huitu profile show fast
huitu profile use fast
huitu profile remove old
huitu models list --profile fast
```

Precedence: built-in defaults, global `config set`, named `profile set`, then per-job arguments. `outputDir` follows the same order; concurrency and timeouts are global. Changing concurrency affects subsequent dispatch immediately; reducing it does not cancel active jobs. Parameters, timeouts, output paths, and credentials are fixed when a job is queued. Credentials are saved separately in a local file with restricted permissions, so profile edits cannot send a new key to an old job's endpoint. Key changes apply only to new jobs; explicit retries retain the original snapshot. Profiles with unfinished jobs cannot be removed.

Model listing and probing resolve only connection settings and credentials; image dimensions do not affect them. Slow probes run independently of the mutation queue, allowing status queries and cancellation to continue.

| CLI argument | JSON field | Default / range |
| --- | --- | --- |
| `--base-url` | `settings.baseUrl` | `https://api.openai.com/v1` |
| `--model` | `settings.model` | Current web default; any nonempty name is accepted |
| `--api-key` | `settings.apiKey` | Configuration commands only; no inline job keys |
| `--api-key-env` | `apiKeyEnv` | Optional; takes precedence over a stored key |
| `--organization` | `settings.organization` | Empty |
| `--extra-headers` | `settings.extraHeaders` | JSON string containing an object with string values |
| `--relay-url` | `settings.relayUrl` | Absolute relay URL, e.g. `http://127.0.0.1:4173/api/relay` |
| `--relay-token` | `settings.relayToken` | Optional independent relay access token; forwarded only to the relay |
| `--use-proxy` / `--no-use-proxy` | `settings.useProxy` | CLI default `false`; specifying a relay URL enables it |
| `--quality` | `params.quality` | `auto`; also `low/medium/high/xhigh/max` |
| `--background` | `params.background` | `auto`; also `transparent/opaque` |
| `--format` | `params.format` | `png`; also `webp/jpeg` |
| `--compression` | `params.compression` | `100`; range `0–100`; omitted from PNG requests |
| `--moderation` | `params.moderation` | `auto/low` |
| `--fidelity` | `params.fidelity` | `high/low`; edits only |
| `--n` | `params.n` | `1`; range `1–10` |
| `--stream` / `--no-stream` | `params.stream` | `false` |
| `--partial-images` | `params.partialImages` | `2`; range `0–3`; sent only when streaming |
| `--size-mode` | `params.sizeMode` | `preset`; also `auto/aspect/custom` |
| `--size-preset` | `params.sizePreset` | `1024x1024` |
| `--aspect` | `params.aspect` | `1:1`; also `3:2/2:3/4:3/3:4/16:9/9:16/21:9` |
| `--long-edge` | `params.longEdge` | `1024`; rounded and adjusted using web size logic |
| `--custom-w` / `--custom-h` | `params.customW/customH` | `1024/1024`; rounded to multiples of sixteen |
| `--output-dir` | `outputDir` | `~/Pictures/huitu` |

Size shortcuts: `--size auto` or `--size 1536x1024`. Do not combine them with other size flags. Without an explicit `--size-mode`, `--aspect/--long-edge` selects aspect mode, and `--custom-w/--custom-h` selects custom mode. Final dimensions follow the web app's existing validation rules; validation does not guarantee upstream model support.

Supply prompts with `--prompt`, `--prompt-file UTF8_FILE`, or `--prompt-file -`. Without explicit prompt arguments, the CLI reads piped input. Prompt length is `1–32000`. Boolean flags use positive or negative switches, not `--stream false`.

Editing example:

```powershell
huitu edit --profile main --prompt-file edit.txt --image "D:\input\base.png" --image "D:\input\reference.webp" --mask "D:\input\mask.png" --fidelity high --n 2 --wait --json
```

Up to sixteen reference images are accepted, each at most 50 MiB, in PNG/JPEG/WebP format. Masks must be PNG; transparent regions indicate areas to edit. Inputs are copied when queued, so changing or deleting the originals does not affect queued jobs.

Import a configuration exported by the web app:

```powershell
huitu config import --input huitu-config.json --profile main
huitu config export --output cli-config.json
```

Web configuration import preserves the local key and relay token. The browser's same-origin proxy setting becomes a direct connection, with a notice; set `--relay-url` afterward if a relay is needed. CLI exports contain all named profiles but leave keys, relay tokens and extra headers empty. Reconfigure extra headers after import. Exported JSON can be imported directly; API keys and relay tokens preserve existing local values.

## Queue lifecycle and recovery

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

Submission returns an ID immediately by default, while the worker continues in the background. `--wait` waits for a terminal state. A wait timeout or termination of the waiting process does not cancel the job. `worker stop` stops dispatching and waits for active jobs to finish; restarting resumes queued work. No system startup service is installed. After reboot, run `worker start` or another command that needs the worker to restore the queue.

Concurrency counts jobs from generation through download. A job with `--n 10` still occupies one slot. Jobs are dispatched in queue order, but network arrival and completion order may differ.

States: `queued → running → downloading → succeeded`; other terminal states are `failed/cancelled/interrupted`. The default generation timeout is 600 seconds; each download attempt has a 60-second timeout.

Generation failures are not automatically retried. A crash during generation without a saved response checkpoint marks the job `interrupted`, requiring explicit `jobs retry`. Downloads with saved responses resume automatically. Failed downloads retry twice, then preserve completed files if still unsuccessful. Explicit retries create a new job with `parentId`; if a response checkpoint exists, they reuse it without requesting generation again. An expired result URL may prevent further downloading and require a new generation job.

Retries retain the original endpoint, model, credentials, image parameters and timeouts after profile edits or removal. Generation retries need the saved credentials and input snapshots. Download retries with a response checkpoint do not need the original references or credential file; they copy any healthy completed images and retrieve only missing results.

At startup, each persisted job is parsed and validated independently. Damaged records are skipped with their original files preserved; healthy jobs still load and resume. `worker status --json` returns their IDs in `data.invalidJobs`; queries or retries for those IDs return `JOB_RECORD_INVALID`. Worker logs name the skipped IDs without printing raw record contents. Inspect and repair records locally, then restart the worker to reload them. Do not automatically resubmit damaged records whose generation outcome is unknown.

Data defaults to `~/.huitu`: configuration, job records, credential snapshots, input snapshots, response checkpoints, and worker logs. Use `--home` or `HUITU_HOME` to isolate another queue. CLI and browser history are separate. Local IPC uses a named pipe or Unix socket. The worker also holds a loopback TCP port derived from the data-directory hash as an operating-system-managed singleton lock; no application service is exposed on that port. A port conflict prevents startup and logs the port number; a different `HUITU_HOME` can avoid the conflict.

## Agent contract

Invoke through a normal shell; no MCP service is required. Use `--json` for machine calls: stdout contains one JSON value, and logs go to stderr. `--help` prints plain text. `config export` without a destination file prints raw, importable configuration JSON.

```json
{
  "schemaVersion": 1,
  "ok": true,
  "data": {
    "id": "job-id",
    "status": "succeeded",
    "files": ["D:\\images\\job-id\\01.png"],
    "usage": { "total_tokens": 123 }
  }
}
```

Command errors return `ok:false,error:{code,message}`. A failed job can still be returned by a successful command as `ok:true,data.status:"failed"`, with job `error:{code,message,phase}`. Check both exit code and job state.

Return shapes depend on the operation:

| Operation | `data` shape | Handling |
| --- | --- | --- |
| Single submission, show, retry or completed single wait | Job object | Check `status`, then read `files` |
| Batch submission without `--wait` | Array of jobs, including one-job batches | Save every `id`; submission only confirms queuing |
| Completed batch wait with multiple jobs | Array of jobs in submission order | Check each `status` and retain successful `files` |
| Completed one-job batch wait | Job object | Same handling as a single wait |
| Any wait timeout, exit `3` | `{ "timedOut": true, "jobs": [...] }` | Latest known states for all requested jobs; keep IDs and continue waiting on unfinished jobs |

For example, a timed-out wait may return:

```json
{
  "schemaVersion": 1,
  "ok": true,
  "data": {
    "timedOut": true,
    "jobs": [
      { "id": "first-job-id", "status": "succeeded", "files": ["D:\\images\\first-job-id\\01.png"] },
      { "id": "second-job-id", "status": "running", "files": [] }
    ]
  }
}
```

A completed batch wait exits `1` if any job is failed, cancelled or interrupted, while still returning all job results. Report per-job failures and preserve successful files. Polling combines unfinished IDs into one IPC request per round; already completed jobs retain their last result without further queries. If the worker disconnects, the wait attempts to restore it and query the same IDs.

| Exit code | Meaning |
| --- | --- |
| `0` | Command succeeded; submission alone does not mean generation finished |
| `1` | A waited-on job failed, was cancelled or interrupted, or a runtime error occurred |
| `2` | Invalid argument, configuration, or job ID |
| `3` | Wait timed out; the job continues |

Batch JSON uses the following structure. Field names and types are validated strictly; unknown fields fail validation.

```json
[
  {
    "mode": "generate",
    "profile": "main",
    "prompt": "A minimal product poster",
    "params": { "quality": "high", "sizeMode": "aspect", "aspect": "16:9", "longEdge": 2048 },
    "outputDir": "D:\\images\\campaign"
  },
  {
    "mode": "edit",
    "profile": "main",
    "prompt": "Change the background to white",
    "images": ["D:\\input\\product.png"],
    "params": { "fidelity": "high", "n": 2 }
  }
]
```

```powershell
huitu batch --input jobs.json --wait --json
```

Batch paths are resolved relative to the calling process's working directory. A parameter error prevents the entire batch from being queued. Prefer submitting a batch once, saving its job IDs, then calling `jobs wait` and reading images from `files`. Returned file paths are absolute.

## Maintainer validation (source repository only)

```powershell
npm run build:skill
npm run test:skill
npm run test:cli
npm run lint
npm run build
```

Tests use a local mock service, not real models, and incur no generation charges. Coverage includes cross-process concurrency, all parameters, streaming multiple images, editing, download failures, cancellation, persistent recovery, and credential redaction.
