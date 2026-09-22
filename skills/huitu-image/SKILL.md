---
name: huitu-image
description: Generate or edit images through a custom OpenAI Images-compatible endpoint using the bundled Huitu CLI. Use when the user requests Huitu or their own image API for single images, batch generation, reference-image edits, or masked edits, with named model profiles, a persistent shared queue, and automatic downloads.
---

# Huitu Image Generation

Use the bundled, precompiled CLI to generate images and save them locally. Requires only Node.js 20.19+ in the 20.x series, or 22.12+. No repository clone, npm dependencies, or compilation is required.

## Prepare

1. Locate [scripts/huitu.mjs](scripts/huitu.mjs) relative to the actual directory of this loaded skill. Run `node` with its absolute path and `--help`; verify that help text is printed. Do not depend on a global `huitu` command. See [direct execution](references/install.md) for path and configuration examples.
2. Inspect existing settings with `profile list --json` and `config show --json`. Reuse the user's chosen profile; do not silently replace the model, endpoint, or output directory. Ask only for missing endpoint, model, or credential information. Credentials can be supplied through local environment variables without exposing them in the conversation.
3. Throughout this skill and its references, `huitu` is shorthand for `node` followed by the absolute path to this skill's `scripts/huitu.mjs`. Keep the same `HUITU_HOME` across project directories to share the three concurrency slots. Do not modify bundled compiled files; CLI configuration and generated images are stored outside the skill directory.

## Submit jobs and retrieve images

- Write prompts to UTF-8 files and pass them with `--prompt-file` to avoid shell quoting errors. Use absolute file paths.
- Generate: `huitu generate --profile main --prompt-file prompt.txt --json`.
- Edit: `huitu edit --profile main --prompt-file prompt.txt --image input.png --mask mask.png --json`. Repeat `--image` for additional references; the mask is optional.
- For multiple jobs, create a JSON array and run `huitu batch --input jobs.json --json`. Do not create isolated queues to bypass the shared concurrency limit.
- Save returned job IDs, then run `huitu jobs wait TASK_ID --wait-timeout 120 --json`. Alternatively, add `--wait` when submitting a short job.
- Report completion only when `data.status` is `succeeded`. Obtain actual absolute paths from `data.files`, confirm the files exist, then display them or pass them to downstream tools. Never invent output paths.
- Consult the [CLI reference](references/cli.md) for parameters, batch JSON, configuration commands, and exit codes. All image-generation parameters exposed by the web app are supported. Use `--help` rather than guessing flag names.

## Queue and failure handling

- Successful submission means queued, not generated. Each job can request one to ten images but occupies one concurrency slot. The default worker runs three jobs concurrently, counting both generation and download time.
- Use `--json` for machine calls. Check the exit code, `ok`, and job `status`: a failed job can still appear inside an `ok:true` response. Exit code `3` means the wait timed out; keep waiting on the same ID instead of resubmitting.
- If a command is interrupted or its response is lost, inspect existing jobs with `jobs list/show` before submitting again. A communication failure does not prove submission failed.
- Downloads automatically retry twice. If they still fail, inspect `error.phase`. When a response checkpoint exists, `jobs retry TASK_ID` reuses the generated result and creates a new job with `parentId`; wait on the new ID.
- Failed or `interrupted` generation is not automatically resubmitted. Explicit retries must stay within the user's authorization and budget. Without retry authorization, report the state instead of retrying in a loop. A billed generation with a lost response cannot be guaranteed deduplication.
- `jobs cancel` cancels the specified job; exiting a wait does not cancel it. Do not stop the shared worker to handle a single failed job.
- The worker inherits environment-variable credentials when it starts. After changing those variables, use `worker restart` only when needed; it waits for active jobs to finish. Queued jobs already have fixed parameters and credentials. Updated credentials require a new job.
- Preserve default concurrency unless the user requests a change. Without a configured real endpoint, validate installation and help output but do not claim real image generation was verified.
