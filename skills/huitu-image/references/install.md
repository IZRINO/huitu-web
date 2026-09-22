# Run directly after installing the skill

This skill includes all compiled JavaScript files and its own ESM module declaration. The runtime uses only Node.js built-in modules; it needs no Git, npm, project source, global command, or additional dependencies. Requires Node.js 20.19+ in the 20.x series, or 22.12+.

## Install the skill

```sh
npx skills add IZRINO/huitu-web --skill huitu-image
```

This is an optional installation method; the installer itself uses npm. Without npm, copy or download the complete `skills/huitu-image` folder into the agent's skill directory. Running the CLI still does not require npm. Preserve every file under `scripts/runtime`, including its `package.json`.

Codex can use `$CODEX_HOME/skills/huitu-image`, or `~/.codex/skills/huitu-image` when `CODEX_HOME` is unset. Other installers may use the project's `.agents/skills/huitu-image`. Resolve the directory from the actual loaded `SKILL.md` path rather than assuming a fixed location. Reload skills or start a new session as required by the host.

## Entrypoint

The entrypoint is `scripts/huitu.mjs`, relative to the skill directory. There is no need to change into that directory. Prefer absolute paths for task files. In all references, `huitu` is shorthand for this entrypoint invoked with `node`.

These examples use the default user-level Codex location; adjust the variable when the actual location differs.

PowerShell:

```powershell
$huituSkillDir = Join-Path $env:USERPROFILE '.codex/skills/huitu-image'
$huituEntry = Join-Path $huituSkillDir 'scripts/huitu.mjs'
node $huituEntry --help
node $huituEntry profile list --json
```

POSIX shell:

```sh
huitu_skill_dir="${CODEX_HOME:-$HOME/.codex}/skills/huitu-image"
huitu_entry="$huitu_skill_dir/scripts/huitu.mjs"
node "$huitu_entry" --help
node "$huitu_entry" profile list --json
```

Help output must include `generate`, `batch`, and `jobs`. If compiled files are missing, reinstall the complete skill package; do not switch to cloning source and installing dependencies. If Node.js is missing, state the runtime requirement instead of claiming the tool is ready.

## Configure a model and generate

Reuse existing profiles; create one only when necessary. The endpoint and model below are examples: use the user's actual values. Set their existing `HUITU_API_KEY` environment variable in the current shell first. Do not print the key in responses.

```powershell
node $huituEntry profile set main --base-url https://example.com/v1 --model user-selected-model --api-key-env HUITU_API_KEY
node $huituEntry profile use main
node $huituEntry config set --output-dir "D:/images" --concurrency 3
node $huituEntry generate --profile main --prompt-file "D:/prompts/image.txt" --wait --json
```

In a POSIX shell, use `node "$huitu_entry"` instead of `node $huituEntry`. If the worker is already running, changed environment variables require `worker restart`. Existing queued jobs retain their original credential snapshots.

Configuration and queue data default to `~/.huitu`; images default to `~/Pictures/huitu`. Neither is written into the skill directory. Override these using `HUITU_HOME`, `--home`, and `--output-dir`. Agents share the concurrency limit only when they use the same data directory.

Before upgrading the skill, run `worker stop` through the old entrypoint and wait until `worker status` reports that the worker has exited. Then replace the skill files. A subsequent call starts the new worker and restores the queue. Do not delete or move a skill directory while a worker still depends on that path.

See the [CLI reference](cli.md) for all image parameters, batch JSON, and status handling.
