import { parseArgs } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { homePath } from './store.js';
import { ensureWorker, rpc } from './client.js';
import { runWorker } from './worker.js';
import { CliError, messageOf, terminal } from './types.js';
import { object } from './config.js';
const strings = ['home', 'profile', 'prompt', 'prompt-file', 'input', 'output', 'output-dir', 'base-url', 'api-key', 'api-key-env', 'model', 'organization', 'extra-headers', 'relay-url',
    'quality', 'background', 'format', 'compression', 'moderation', 'fidelity', 'partial-images', 'n', 'size-mode', 'size-preset', 'aspect', 'long-edge', 'custom-w', 'custom-h', 'size', 'mask',
    'concurrency', 'generation-timeout', 'download-timeout', 'wait-timeout', 'status'];
const booleans = ['json', 'wait', 'help', 'stream', 'no-stream', 'use-proxy', 'no-use-proxy'];
const optionDefinitions = Object.fromEntries([
    ...strings.map(key => [key, { type: 'string' }]),
    ...booleans.map(key => [key, { type: 'boolean' }]),
    ['image', { type: 'string', multiple: true }],
]);
const settingFields = { 'base-url': 'baseUrl', 'api-key': 'apiKey', 'model': 'model', 'organization': 'organization', 'extra-headers': 'extraHeaders', 'relay-url': 'relayUrl' };
const paramFields = { quality: 'quality', background: 'background', format: 'format', compression: 'compression', moderation: 'moderation', fidelity: 'fidelity',
    'partial-images': 'partialImages', n: 'n', 'size-mode': 'sizeMode', 'size-preset': 'sizePreset', aspect: 'aspect', 'long-edge': 'longEdge', 'custom-w': 'customW', 'custom-h': 'customH' };
const numeric = new Set(['compression', 'partial-images', 'n', 'long-edge', 'custom-w', 'custom-h']);
const generationOptions = [...Object.keys(settingFields).filter(k => k !== 'api-key'), ...Object.keys(paramFields), 'api-key-env', 'output-dir', 'use-proxy', 'no-use-proxy', 'stream', 'no-stream', 'size'];
const help = `huitu — persistent image queue (default concurrency: 3)

Configuration:
  config init | show | set [options] | import --input FILE [--profile NAME] | export [--output FILE]
  profile set NAME [options] | list | show NAME | use NAME | remove NAME
  models list|probe [--profile NAME]
Tasks:
  generate --prompt TEXT | --prompt-file FILE|- [options] [--wait] [--json]
  edit --prompt TEXT --image FILE [--image FILE] [--mask PNG] [options]
  batch --input FILE|- [--wait] [--json]
  jobs list [--status STATE] | show ID | wait ID [--wait-timeout SECONDS] | cancel ID | retry ID [--wait]
Worker:
  worker start | stop | restart | status

Connection: --profile --base-url --model --organization --extra-headers JSON --relay-url
            --use-proxy / --no-use-proxy --api-key-env (profile set also accepts --api-key)
Image: --quality auto|low|medium|high|xhigh|max --background auto|transparent|opaque
       --format png|webp|jpeg --compression 0..100 --moderation auto|low --fidelity high|low
       --n 1..10 --stream / --no-stream --partial-images 0..3
Size:  --size auto|WIDTHxHEIGHT, or --size-mode auto|preset|aspect|custom
       --size-preset --aspect --long-edge --custom-w --custom-h
Config: --output-dir --concurrency --generation-timeout --download-timeout (seconds)
Global: --home DIRECTORY (or HUITU_HOME) --json --help
Agent contract and full examples: docs/cli.md
`;
let jsonMode = process.argv.includes('--json');
function output(data) {
    process.stdout.write(JSON.stringify(jsonMode ? { schemaVersion: 1, ok: true, data } : data, null, jsonMode ? undefined : 2) + '\n');
}
async function inputText(path) {
    if (path !== '-')
        return readFile(resolve(path), 'utf8');
    let value = '';
    for await (const chunk of process.stdin)
        value += chunk;
    return value;
}
function parseJson(raw) {
    try {
        return JSON.parse(raw.replace(/^\uFEFF/, ''));
    }
    catch {
        throw new CliError('Invalid JSON input');
    }
}
async function main() {
    let parsed;
    try {
        parsed = parseArgs({ options: optionDefinitions, allowPositionals: true, strict: true });
    }
    catch (error) {
        throw new CliError(messageOf(error));
    }
    const values = parsed.values;
    const positionals = parsed.positionals;
    jsonMode = values.json === true;
    const [command, action, name] = positionals;
    if (values.help || !command) {
        process.stdout.write(help);
        return;
    }
    const str = (key) => values[key];
    const number = (key) => { const value = Number(str(key)); if (!Number.isFinite(value))
        throw new CliError(`${key} must be numeric`); return value; };
    function allow(options, count) {
        const allowed = new Set(['home', 'json', 'help', ...options]);
        for (const key of Object.keys(values))
            if (!allowed.has(key))
                throw new CliError(`--${key} is not valid for this command`);
        if (positionals.length !== count)
            throw new CliError('Unexpected or missing positional arguments; use --help');
        if (str('wait-timeout') !== undefined && number('wait-timeout') < 0)
            throw new CliError('wait-timeout must be nonnegative');
    }
    function profile() {
        const settings = {}, params = {};
        for (const [flag, key] of Object.entries(settingFields))
            if (values[flag] !== undefined)
                settings[key] = str(flag);
        for (const [flag, key] of Object.entries(paramFields))
            if (values[flag] !== undefined)
                params[key] = numeric.has(flag) ? number(flag) : str(flag);
        if (values.stream && values['no-stream'])
            throw new CliError('Conflicting stream options');
        if (values['use-proxy'] && values['no-use-proxy'])
            throw new CliError('Conflicting proxy options');
        if (values.stream !== undefined || values['no-stream'] !== undefined)
            params.stream = Boolean(values.stream);
        if (values['use-proxy'] !== undefined || values['no-use-proxy'] !== undefined)
            settings.useProxy = Boolean(values['use-proxy']);
        if (values['relay-url'] && values['no-use-proxy'] === undefined)
            settings.useProxy = true;
        if (values.size !== undefined) {
            if (['size-mode', 'size-preset', 'aspect', 'long-edge', 'custom-w', 'custom-h'].some(k => values[k] !== undefined))
                throw new CliError('--size conflicts with other size options');
            params.sizeMode = str('size') === 'auto' ? 'auto' : 'preset';
            params.sizePreset = str('size');
        }
        else if (!values['size-mode']) {
            const modes = [values['size-preset'] ? 'preset' : '', values.aspect || values['long-edge'] ? 'aspect' : '', values['custom-w'] || values['custom-h'] ? 'custom' : ''].filter(Boolean);
            if (modes.length > 1)
                throw new CliError('Conflicting size modes');
            if (modes.length)
                params.sizeMode = modes[0];
        }
        return { settings, params, ...(str('api-key-env') !== undefined ? { apiKeyEnv: str('api-key-env') } : str('api-key') !== undefined ? { apiKeyEnv: '' } : {}), ...(str('output-dir') ? { outputDir: resolve(str('output-dir')) } : {}) };
    }
    const home = await homePath(str('home'));
    if (command === '_worker') {
        allow([], 1);
        await runWorker(home);
        return;
    }
    if (command === 'worker' && action === 'status') {
        allow([], 2);
        try {
            output(await rpc(home, 'status'));
        }
        catch (error) {
            if (error instanceof CliError)
                throw error;
            output({ running: false });
        }
        return;
    }
    if (command === 'worker') {
        allow([], 2);
        if (!['start', 'stop', 'restart'].includes(action))
            throw new CliError('Unknown worker action');
        if (action === 'stop' || action === 'restart') {
            let running = false;
            try {
                await rpc(home, 'status');
                running = true;
            }
            catch (error) {
                if (error instanceof CliError)
                    throw error;
            }
            if (running) {
                await rpc(home, 'stop');
                if (action === 'stop') {
                    output({ stopping: true });
                    return;
                }
                for (;;) {
                    await delay(200);
                    try {
                        await rpc(home, 'status');
                    }
                    catch {
                        break;
                    }
                }
            }
            else if (action === 'stop') {
                output({ running: false });
                return;
            }
        }
        await ensureWorker(home);
        output(await rpc(home, 'status'));
        return;
    }
    async function call(cmd, args = {}) { await ensureWorker(home); return rpc(home, cmd, args); }
    async function waitJobs(initial) {
        const seconds = str('wait-timeout') === undefined ? 0 : number('wait-timeout');
        if (seconds < 0)
            throw new CliError('wait-timeout must be nonnegative');
        const deadline = seconds ? Date.now() + seconds * 1000 : Infinity;
        let jobs = initial;
        while (jobs.some(j => !terminal(j.status))) {
            if (Date.now() >= deadline) {
                output({ timedOut: true, jobs });
                process.exitCode = 3;
                return;
            }
            await delay(250);
            jobs = await Promise.all(jobs.map(job => call('jobs.show', { id: job.id })));
        }
        output(jobs.length === 1 ? jobs[0] : jobs);
        if (jobs.some(j => j.status !== 'succeeded'))
            process.exitCode = 1;
    }
    switch (command) {
        case 'config': {
            if (action === 'init' || action === 'show') {
                allow([], 2);
                output(await call(action === 'init' ? 'config.init' : 'config.get'));
                return;
            }
            if (action === 'set') {
                allow([...generationOptions, 'api-key', 'concurrency', 'generation-timeout', 'download-timeout'], 2);
                const patch = { defaults: profile() };
                if (str('output-dir') !== undefined) {
                    patch.outputDir = resolve(str('output-dir'));
                    delete patch.defaults.outputDir;
                }
                for (const flag of ['concurrency', 'generation-timeout', 'download-timeout'])
                    if (str(flag) !== undefined)
                        patch[flag.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = number(flag);
                output(await call('config.set', patch));
                return;
            }
            if (action === 'import') {
                allow(['input', 'profile'], 2);
                if (!str('input'))
                    throw new CliError('--input is required');
                const data = parseJson(await inputText(str('input')));
                object(data);
                if (data.version !== 1)
                    process.stderr.write('Web import: CLI uses direct connection; set --relay-url explicitly to enable relay. Existing key preserved.\n');
                output(await call('config.import', { data, profile: str('profile') }));
                return;
            }
            if (action === 'export') {
                allow(['output'], 2);
                const data = await call('config.get');
                if (str('output')) {
                    await writeFile(resolve(str('output')), JSON.stringify(data, null, 2), { mode: 0o600 });
                    output({ path: resolve(str('output')) });
                }
                else
                    process.stdout.write(JSON.stringify(data, null, 2) + '\n');
                return;
            }
            throw new CliError('Unknown config action');
        }
        case 'profile': {
            if (action === 'list' || action === 'show') {
                allow([], action === 'list' ? 2 : 3);
                const config = await call('config.get');
                if (action === 'show' && !Object.hasOwn(config.profiles, name))
                    throw new CliError('Unknown profile');
                output(action === 'list' ? { defaultProfile: config.defaultProfile, profiles: config.profiles } : config.profiles[name]);
                return;
            }
            if (action === 'set') {
                allow([...generationOptions, 'api-key'], 3);
                output(await call('profile.set', { name: action && name, profile: profile() }));
                return;
            }
            if (action === 'use' || action === 'remove') {
                allow([], 3);
                output(await call(`profile.${action}`, { name }));
                return;
            }
            throw new CliError('Unknown profile action');
        }
        case 'models': {
            allow(['profile'], 2);
            if (!['list', 'probe'].includes(action))
                throw new CliError('Unknown models action');
            output(await call('models', { profile: str('profile'), probe: action === 'probe' }));
            return;
        }
        case 'generate':
        case 'edit': {
            allow([...generationOptions, 'profile', 'prompt', 'prompt-file', 'image', 'mask', 'wait', 'wait-timeout'], 1);
            if (str('prompt') !== undefined && str('prompt-file') !== undefined)
                throw new CliError('Choose --prompt or --prompt-file');
            const prompt = str('prompt') ?? (str('prompt-file') ? await inputText(str('prompt-file')) : !process.stdin.isTTY ? await inputText('-') : '');
            const spec = { ...profile(), mode: command, prompt, profile: str('profile'), images: (values.image ?? []).map(p => resolve(p)), mask: str('mask') ? resolve(str('mask')) : undefined };
            const job = await call('submit', { spec });
            if (values.wait)
                await waitJobs([job]);
            else
                output(job);
            return;
        }
        case 'batch': {
            allow(['input', 'wait', 'wait-timeout'], 1);
            if (!str('input'))
                throw new CliError('--input required');
            const specs = parseJson(await inputText(str('input')));
            if (!Array.isArray(specs))
                throw new CliError('Batch requires a JSON array');
            for (const spec of specs) {
                object(spec);
                if (Array.isArray(spec.images))
                    spec.images = spec.images.map((path) => typeof path === 'string' ? resolve(path) : path);
                if (typeof spec.mask === 'string')
                    spec.mask = resolve(spec.mask);
                if (typeof spec.outputDir === 'string')
                    spec.outputDir = resolve(spec.outputDir);
            }
            const jobs = await call('batch', { specs });
            if (values.wait)
                await waitJobs(jobs);
            else
                output(jobs);
            return;
        }
        case 'jobs': {
            if (action === 'list') {
                allow(['status'], 2);
                output(await call('jobs.list', { status: str('status') }));
                return;
            }
            if (['show', 'cancel', 'retry', 'wait'].includes(action)) {
                allow(action === 'retry' ? ['wait', 'wait-timeout'] : action === 'wait' ? ['wait-timeout'] : [], 3);
                const job = await call(`jobs.${action === 'wait' ? 'show' : action}`, { id: name });
                if (action === 'wait' || values.wait)
                    await waitJobs([job]);
                else
                    output(job);
                return;
            }
            throw new CliError('Unknown jobs action');
        }
        default: throw new CliError(`Unknown command: ${command}`);
    }
}
await main().catch(error => {
    const payload = { code: error instanceof CliError ? error.code : 'CLI_ERROR', message: messageOf(error) };
    if (jsonMode)
        process.stdout.write(JSON.stringify({ schemaVersion: 1, ok: false, error: payload }) + '\n');
    else
        process.stderr.write(`${payload.code}: ${payload.message}\n`);
    process.exitCode = error instanceof CliError ? error.exitCode : 1;
});
