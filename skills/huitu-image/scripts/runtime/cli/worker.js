import { createServer } from 'node:http';
import { mkdir, rm, chmod, stat, copyFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { randomUUID, randomBytes, timingSafeEqual } from 'node:crypto';
import { requestImages, authHeaders, relayFetch, parseExtra } from '../src/lib/api.js';
import { atomicJson, claimLock, endpoint, jobDir, loadConfig, loadJobs, readJson } from './store.js';
import { mergeProfile, publicValue, resolveSpec, validateConfig, validateProfile, profileName, object } from './config.js';
import { checkInput, downloadImage, imageFile, stageInputs } from './images.js';
import { CliError, messageOf, terminal } from './types.js';
export async function runWorker(home) {
    const lease = await claimLock(home);
    if (!lease)
        return;
    try {
        const socketPath = endpoint(home), runtime = join(home, 'runtime.json');
        let config = await loadConfig(home);
        const jobs = new Map((await loadJobs(home)).map(job => [job.id, job]));
        let sequence = Math.max(0, ...[...jobs.values()].map(job => job.sequence));
        const active = new Map();
        const environment = { ...process.env };
        let stopping = false, closing = false;
        const saveJob = (job) => atomicJson(join(jobDir(home, job.id), 'job.json'), job);
        const jobView = (job) => publicValue(job);
        const profileFor = (name) => mergeProfile(config.defaults, config.profiles[name] ?? {});
        const keyFor = (name, env) => env ? environment[env] || '' : profileFor(name).settings?.apiKey || '';
        function scrub(message, job, actualKey) {
            const secrets = actualKey ? [actualKey] : [];
            for (const p of [config.defaults, ...Object.values(config.profiles)]) {
                if (p.settings?.apiKey)
                    secrets.push(p.settings.apiKey);
                if (p.apiKeyEnv && environment[p.apiKeyEnv])
                    secrets.push(environment[p.apiKeyEnv]);
                if (p.settings?.extraHeaders)
                    secrets.push(...Object.values(parseExtra(p.settings.extraHeaders)));
            }
            if (job) {
                secrets.push(keyFor(job.profile, job.apiKeyEnv));
                secrets.push(...Object.values(parseExtra(job.settings.extraHeaders)));
            }
            for (const secret of secrets.filter(Boolean).sort((a, b) => b.length - a.length))
                message = message.split(secret).join('[REDACTED]');
            return message.slice(0, 2000);
        }
        for (const job of jobs.values()) {
            if (job.status === 'running') {
                // A response checkpoint proves generation completed; absence cannot prove it did not.
                const exists = await stat(join(jobDir(home, job.id), 'response.json')).then(() => true, () => false);
                job.status = exists ? 'downloading' : 'interrupted';
                if (!exists) {
                    job.error = { code: 'INTERRUPTED', message: 'Generation outcome unknown; explicit retry required', phase: 'generation' };
                    job.finishedAt = new Date().toISOString();
                }
                await saveJob(job);
            }
        }
        async function execute(job, controller) {
            let phase = job.status === 'downloading' ? 'download' : 'generation';
            let apiKey = '';
            try {
                let response;
                if (job.status === 'downloading')
                    response = await readJson(join(jobDir(home, job.id), 'response.json'));
                else {
                    job.status = 'running';
                    job.startedAt = new Date().toISOString();
                    await saveJob(job);
                    controller.signal.throwIfAborted();
                    apiKey = (await readJson(join(jobDir(home, job.id), 'credentials.json'))).apiKey;
                    if (!apiKey)
                        throw new CliError('Missing API key; configure profile or restart worker with its key environment variable', 'MISSING_CREDENTIALS', 1);
                    const p = job.params;
                    const body = { prompt: job.prompt, model: job.settings.model, size: job.size, n: p.n,
                        quality: p.quality, background: p.background, output_format: p.format, output_compression: p.compression,
                        moderation: p.moderation, stream: p.stream, partial_images: p.partialImages };
                    const request = job.mode === 'edit' ? { ...body, images: await Promise.all(job.images.map(imageFile)),
                        mask: job.mask ? await imageFile(job.mask) : undefined, input_fidelity: p.fidelity } : body;
                    response = await requestImages({ ...job.settings, apiKey }, request, {
                        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(job.generationTimeout * 1000)]),
                    });
                    controller.signal.throwIfAborted();
                    await atomicJson(join(jobDir(home, job.id), 'response.json'), response);
                    controller.signal.throwIfAborted();
                    job.usage = response.usage;
                    job.status = 'downloading';
                    await saveJob(job);
                    phase = 'download';
                }
                if (!response.data?.length)
                    throw new Error('No final images returned');
                const failures = [];
                for (const [index, image] of response.data.entries()) {
                    controller.signal.throwIfAborted();
                    try {
                        const prefix = `${String(index + 1).padStart(2, '0')}.`;
                        const saved = job.files.find(path => path.startsWith(join(job.outputDir, prefix)));
                        if (saved && await checkInput(saved).then(() => true, () => false))
                            continue;
                        const file = await downloadImage(image, job.outputDir, index, controller.signal, job.downloadTimeout);
                        if (!job.files.includes(file))
                            job.files.push(file);
                        await saveJob(job);
                    }
                    catch (error) {
                        controller.signal.throwIfAborted();
                        failures.push(`Image ${index + 1}: ${messageOf(error)}`);
                    }
                }
                if (failures.length)
                    throw new Error(failures.join('; '));
                if (response.data.length !== job.params.n)
                    throw new Error(`Expected ${job.params.n} final images, received ${response.data.length}`);
                controller.signal.throwIfAborted();
                job.status = 'succeeded';
                job.finishedAt = new Date().toISOString();
                delete job.error;
                await mkdir(job.outputDir, { recursive: true });
                controller.signal.throwIfAborted();
                await atomicJson(join(job.outputDir, 'result.json'), { schemaVersion: 1, ...jobView(job) });
                await saveJob(job);
            }
            catch (error) {
                if (job.status !== 'cancelled') {
                    job.status = 'failed';
                    job.error = { code: error instanceof CliError ? error.code : phase === 'download' ? 'DOWNLOAD_FAILED' : 'GENERATION_FAILED', message: scrub(messageOf(error), job, apiKey), phase };
                }
                job.finishedAt = new Date().toISOString();
                await saveJob(job);
                await mkdir(job.outputDir, { recursive: true });
                await atomicJson(join(job.outputDir, 'result.json'), { schemaVersion: 1, ...jobView(job) }).catch(() => undefined);
            }
            finally {
                active.delete(job.id);
                pump();
            }
        }
        function pump() {
            if (stopping) {
                if (!active.size)
                    void close();
                return;
            }
            for (const job of jobs.values()) {
                if (active.size >= config.concurrency)
                    break;
                if (!active.has(job.id) && (job.status === 'queued' || job.status === 'downloading')) {
                    const controller = new AbortController();
                    active.set(job.id, controller);
                    void execute(job, controller).catch(error => console.error(scrub(messageOf(error), job)));
                }
            }
        }
        function find(id) {
            const job = jobs.get(String(id));
            if (!job)
                throw new CliError('Unknown job', 'NOT_FOUND');
            return job;
        }
        async function submit(input, parent, publish = true) {
            if (stopping)
                throw new CliError('Worker is stopping', 'WORKER_STOPPING', 1);
            const spec = input;
            const resolved = resolveSpec(config, input);
            const credentials = parent ? await readJson(join(jobDir(home, parent.id), 'credentials.json')) : { apiKey: keyFor(resolved.name, resolved.apiKeyEnv) };
            if (!credentials.apiKey)
                throw new CliError('Missing API key; configure profile or restart worker with its key environment variable', 'MISSING_CREDENTIALS');
            for (const path of resolved.images)
                await checkInput(path);
            if (spec.mask)
                await checkInput(spec.mask, true);
            const id = randomUUID(), dir = jobDir(home, id);
            await mkdir(dir, { recursive: true, mode: 0o700 });
            try {
                const staged = await stageInputs(dir, resolved.images, spec.mask);
                await atomicJson(join(dir, 'credentials.json'), credentials);
                const job = { id, sequence: ++sequence, status: 'queued', mode: spec.mode, prompt: spec.prompt.trim(),
                    profile: resolved.name, settings: { ...resolved.settings, apiKey: '' }, apiKeyEnv: resolved.apiKeyEnv,
                    params: resolved.params, size: resolved.size, ...staged, outputDir: join(resolved.outputDir, id),
                    generationTimeout: config.generationTimeout, downloadTimeout: config.downloadTimeout,
                    createdAt: new Date().toISOString(), files: [] };
                if (parent) {
                    job.parentId = parent.id;
                    job.settings = { ...parent.settings };
                    job.params = { ...parent.params };
                    job.size = parent.size;
                    job.apiKeyEnv = parent.apiKeyEnv;
                    if (await stat(join(jobDir(home, parent.id), 'response.json')).then(() => true, () => false)) {
                        const response = await readJson(join(jobDir(home, parent.id), 'response.json'));
                        await atomicJson(join(dir, 'response.json'), response);
                        job.status = 'downloading';
                        job.usage = parent.usage;
                        for (const path of parent.files) {
                            if (!await checkInput(path).then(() => true, () => false))
                                continue;
                            await mkdir(job.outputDir, { recursive: true });
                            const target = join(job.outputDir, basename(path));
                            await copyFile(path, target);
                            job.files.push(target);
                        }
                    }
                }
                await saveJob(job);
                if (publish)
                    jobs.set(id, job);
                return job;
            }
            catch (error) {
                await rm(dir, { recursive: true, force: true });
                throw error;
            }
        }
        async function saveConfig(next) {
            validateConfig(next);
            await atomicJson(join(home, 'config.json'), next);
            config = next;
            return publicValue(config);
        }
        async function handle(command, args) {
            switch (command) {
                case 'status': return { pid: process.pid, stopping, concurrency: config.concurrency, active: active.size, queued: [...jobs.values()].filter(j => j.status === 'queued').length };
                case 'stop':
                    stopping = true;
                    return { stopping: true };
                case 'config.get': return publicValue(config);
                case 'config.init': return saveConfig(config);
                case 'config.set': return saveConfig({ ...config, ...args, defaults: args.defaults ? mergeProfile(config.defaults, args.defaults) : config.defaults });
                case 'config.import': {
                    object(args.data, 'config import');
                    const imported = args.data;
                    if (imported.version === 1) {
                        validateConfig(imported);
                        const next = structuredClone(imported);
                        for (const [name, profile] of Object.entries(next.profiles))
                            profile.settings = { ...profile.settings, apiKey: config.profiles[name]?.settings?.apiKey || '' };
                        next.defaults.settings = { ...next.defaults.settings, apiKey: config.defaults.settings?.apiKey || '' };
                        return saveConfig(next);
                    }
                    const profile = { settings: imported.settings ?? {}, params: imported.params ?? {} };
                    validateProfile(profile);
                    const name = String(args.profile || config.defaultProfile);
                    profileName(name);
                    const settings = { ...profile.settings, useProxy: false, apiKey: config.profiles[name]?.settings?.apiKey || '' };
                    return saveConfig({ ...config, profiles: { ...config.profiles, [name]: mergeProfile(config.profiles[name] ?? {}, { ...profile, settings }) } });
                }
                case 'profile.set': {
                    const name = String(args.name);
                    profileName(name);
                    validateProfile(args.profile);
                    return saveConfig({ ...config, profiles: { ...config.profiles, [name]: mergeProfile(config.profiles[name] ?? {}, args.profile) } });
                }
                case 'profile.use': return saveConfig({ ...config, defaultProfile: args.name });
                case 'profile.remove': {
                    const name = String(args.name);
                    if (name === config.defaultProfile)
                        throw new CliError('Cannot remove the default profile');
                    if ([...jobs.values()].some(j => j.profile === name && !terminal(j.status)))
                        throw new CliError('Profile has unfinished jobs');
                    const profiles = { ...config.profiles };
                    delete profiles[name];
                    return saveConfig({ ...config, profiles });
                }
                case 'models': {
                    const resolved = resolveSpec(config, { mode: 'generate', prompt: 'probe', profile: args.profile });
                    const apiKey = keyFor(resolved.name, resolved.apiKeyEnv);
                    if (!apiKey)
                        throw new CliError('Missing API key');
                    const response = await relayFetch({ ...resolved.settings, apiKey }, `${resolved.settings.baseUrl.replace(/\/+$/, '')}/models`, { headers: authHeaders(apiKey), signal: AbortSignal.timeout(12000) });
                    if (response.status === 404 && args.probe)
                        return { reachable: true, modelsAvailable: false };
                    if (!response.ok)
                        throw new CliError(`Models endpoint HTTP ${response.status}`, 'UPSTREAM_ERROR', 1);
                    const body = await response.json();
                    return { reachable: true, models: (body.data ?? []).map(m => m.id) };
                }
                case 'submit': return jobView(await submit(args.spec));
                case 'batch': {
                    if (!Array.isArray(args.specs) || !args.specs.length)
                        throw new CliError('Batch must be a nonempty JSON array');
                    for (const spec of args.specs) {
                        const r = resolveSpec(config, spec);
                        for (const path of r.images)
                            await checkInput(path);
                        if (spec.mask)
                            await checkInput(spec.mask, true);
                    }
                    const added = [];
                    try {
                        for (const spec of args.specs)
                            added.push(await submit(spec, undefined, false));
                        for (const job of added)
                            jobs.set(job.id, job);
                        return added.map(jobView);
                    }
                    catch (error) {
                        for (const job of added) {
                            jobs.delete(job.id);
                            await rm(jobDir(home, job.id), { recursive: true, force: true });
                        }
                        ;
                        throw error;
                    }
                }
                case 'jobs.list': return [...jobs.values()].filter(j => !args.status || j.status === args.status).map(jobView);
                case 'jobs.show': return jobView(find(args.id));
                case 'jobs.cancel': {
                    const job = find(args.id);
                    if (!terminal(job.status)) {
                        job.status = 'cancelled';
                        job.finishedAt = new Date().toISOString();
                        active.get(job.id)?.abort();
                        await saveJob(job);
                    }
                    return jobView(job);
                }
                case 'jobs.retry': {
                    const parent = find(args.id);
                    if (!['failed', 'cancelled', 'interrupted'].includes(parent.status) || active.has(parent.id))
                        throw new CliError('Retry requires a finished failed, cancelled or interrupted job');
                    return jobView(await submit({ mode: parent.mode, prompt: parent.prompt, profile: parent.profile, settings: parent.settings, params: parent.params,
                        images: parent.images, mask: parent.mask, outputDir: join(parent.outputDir, '..'), apiKeyEnv: parent.apiKeyEnv }, parent));
                }
                default: throw new CliError(`Unknown command: ${command}`);
            }
        }
        const token = randomBytes(32).toString('hex');
        let mutations = Promise.resolve();
        const server = createServer(async (req, res) => {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Connection', 'close');
            const supplied = Buffer.from(String(req.headers.authorization || '')), expected = Buffer.from(token);
            if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
                res.writeHead(403);
                res.end('{}');
                return;
            }
            try {
                const chunks = [];
                let size = 0;
                for await (const chunk of req) {
                    size += chunk.length;
                    if (size > 16 * 1024 * 1024)
                        throw new CliError('IPC request too large');
                    chunks.push(chunk);
                }
                const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                const operation = mutations.catch(() => undefined).then(() => handle(input.command, input.args ?? {}));
                mutations = operation;
                const data = await operation;
                res.end(JSON.stringify({ schemaVersion: 1, ok: true, data }));
            }
            catch (error) {
                res.end(JSON.stringify({ schemaVersion: 1, ok: false, error: { code: error instanceof CliError ? error.code : 'WORKER_ERROR', message: scrub(messageOf(error)), exitCode: error instanceof CliError ? error.exitCode : 1 } }));
            }
            finally {
                pump();
            }
        });
        async function close() {
            if (closing)
                return;
            closing = true;
            await new Promise(resolve => server.close(() => resolve()));
            await rm(runtime, { force: true });
            if (process.platform !== 'win32')
                await rm(socketPath, { force: true });
            await new Promise(resolve => lease.close(() => resolve()));
        }
        process.on('SIGTERM', () => { stopping = true; pump(); });
        process.on('SIGINT', () => { stopping = true; pump(); });
        if (process.platform !== 'win32')
            await rm(socketPath, { force: true });
        await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socketPath, () => resolve()); });
        if (process.platform !== 'win32')
            await chmod(socketPath, 0o600);
        await atomicJson(runtime, { pid: process.pid, token });
        pump();
    }
    catch (error) {
        lease.close();
        throw error;
    }
}
