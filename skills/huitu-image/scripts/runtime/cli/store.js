import { mkdir, readFile, writeFile, rename, readdir, realpath, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { randomUUID, createHash } from 'node:crypto';
import { homedir, tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { defaults, integer, object, profileName, text, validateConfig, validateParams, validateProfile, validateSettings } from './config.js';
import { defaultParams, defaultSettings } from '../src/lib/defaults.js';
import { validateSize } from '../src/lib/size.js';
import { CliError } from './types.js';
export async function homePath(input) {
    const path = resolve(input || process.env.HUITU_HOME || join(homedir(), '.huitu'));
    await mkdir(path, { recursive: true, mode: 0o700 });
    return realpath(path);
}
export function endpoint(home) {
    const hash = createHash('sha256').update(process.platform === 'win32' ? home.toLowerCase() : home).digest('hex').slice(0, 24);
    return process.platform === 'win32' ? `\\\\.\\pipe\\huitu-${hash}` : join(tmpdir(), `huitu-${hash}.sock`);
}
export function jobDir(home, id) {
    if (!/^[0-9a-f-]{36}$/.test(id))
        throw new CliError('Invalid job ID');
    return join(home, 'jobs', id);
}
const writes = new Map();
export async function atomicJson(path, value) {
    const body = JSON.stringify(value, null, 2);
    const previous = writes.get(path) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(async () => {
        const temp = `${path}.${randomUUID()}.tmp`;
        try {
            await writeFile(temp, body, { mode: 0o600, flag: 'wx' });
            await rename(temp, path);
        }
        finally {
            await rm(temp, { force: true });
        }
    });
    writes.set(path, current);
    try {
        await current;
    }
    finally {
        if (writes.get(path) === current)
            writes.delete(path);
    }
}
export async function readJson(path) { return JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, '')); }
export async function loadConfig(home) {
    try {
        const config = await readJson(join(home, 'config.json'));
        validateConfig(config);
        return config;
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return defaults();
        throw error;
    }
}
function validateStoredJob(value, id) {
    object(value, 'stored job');
    if (value.id !== id)
        throw new CliError('Stored job ID does not match its directory');
    integer(value.sequence, 1, Number.MAX_SAFE_INTEGER, 'sequence');
    if (!['queued', 'running', 'downloading', 'succeeded', 'failed', 'cancelled', 'interrupted'].includes(value.status))
        throw new CliError('Invalid stored job status');
    if (value.mode !== 'generate' && value.mode !== 'edit')
        throw new CliError('Invalid stored job mode');
    text(value.prompt, 'prompt');
    text(value.profile, 'profile');
    profileName(value.profile);
    if (!value.prompt.trim() || value.prompt.length > 32000)
        throw new CliError('Invalid stored prompt');
    validateSettings(value.settings);
    validateParams(value.params);
    for (const key of Object.keys(defaultSettings()))
        if (!Object.hasOwn(value.settings, key))
            throw new CliError(`Missing stored setting: ${key}`);
    for (const key of Object.keys(defaultParams()))
        if (!Object.hasOwn(value.params, key))
            throw new CliError(`Missing stored parameter: ${key}`);
    if (value.settings.useProxy && !value.settings.relayUrl)
        throw new CliError('Stored proxy job requires relayUrl');
    validateProfile({ apiKeyEnv: value.apiKeyEnv });
    text(value.size, 'size');
    if (!validateSize(value.size).ok)
        throw new CliError('Invalid stored size');
    integer(value.generationTimeout, 1, 86400, 'generationTimeout');
    integer(value.downloadTimeout, 1, 86400, 'downloadTimeout');
    text(value.outputDir, 'outputDir');
    if (!isAbsolute(value.outputDir))
        throw new CliError('Stored outputDir must be absolute');
    for (const key of ['images', 'files']) {
        const paths = value[key];
        if (!Array.isArray(paths) || paths.some(path => typeof path !== 'string' || !isAbsolute(path)))
            throw new CliError(`Invalid stored ${key}`);
    }
    if (value.images.length > 16 || (value.mode === 'edit' && !value.images.length))
        throw new CliError('Invalid stored reference count');
    if (value.mask !== undefined) {
        text(value.mask, 'mask');
        if (!isAbsolute(value.mask))
            throw new CliError('Stored mask must be absolute');
    }
    if (value.parentId !== undefined) {
        text(value.parentId, 'parentId');
        jobDir('', value.parentId);
    }
    for (const key of ['createdAt', 'startedAt', 'finishedAt']) {
        if (key === 'createdAt' || value[key] !== undefined) {
            text(value[key], key);
            if (!Number.isFinite(Date.parse(value[key])))
                throw new CliError(`Invalid stored ${key}`);
        }
    }
    if (value.error !== undefined) {
        object(value.error, 'error');
        for (const key of ['code', 'message', 'phase'])
            text(value.error[key], key);
    }
}
export async function loadJobs(home, onInvalid = id => console.error(`Skipping invalid job record: ${id}; original file preserved`)) {
    await mkdir(join(home, 'jobs'), { recursive: true, mode: 0o700 });
    const jobs = [];
    for (const entry of await readdir(join(home, 'jobs'))) {
        if (!/^[0-9a-f-]{36}$/.test(entry))
            continue;
        try {
            const job = await readJson(join(jobDir(home, entry), 'job.json'));
            validateStoredJob(job, entry);
            jobs.push(job);
        }
        catch (error) {
            if (error.code !== 'ENOENT')
                onInvalid(entry);
        }
    }
    return jobs.sort((a, b) => a.sequence - b.sequence);
}
export async function claimLock(home) {
    // Kernel-owned lease: process death releases it atomically. No stale-file reclamation race.
    const identity = process.platform === 'win32' ? home.toLowerCase() : home;
    const port = 20000 + createHash('sha256').update(identity).digest().readUInt32BE(0) % 40000;
    const lease = createServer(socket => socket.destroy());
    const claimed = await new Promise((resolve, reject) => {
        lease.once('error', (error) => error.code === 'EADDRINUSE' ? resolve(false) : reject(error));
        lease.listen({ port, host: '127.0.0.1', exclusive: true }, () => resolve(true));
    });
    if (!claimed) {
        console.error(`Worker singleton lease unavailable on 127.0.0.1:${port}`);
        return null;
    }
    return lease;
}
