import { request } from 'node:http';
import { spawn } from 'node:child_process';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { endpoint, readJson } from './store.js';
import { CliError } from './types.js';
export async function rpc(home, command, args = {}) {
    const runtime = await readJson(join(home, 'runtime.json'));
    return new Promise((resolve, reject) => {
        const req = request({ socketPath: endpoint(home), path: '/', method: 'POST', headers: { Authorization: runtime.token, 'Content-Type': 'application/json' } }, res => {
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('error', reject);
            res.on('end', () => {
                try {
                    if (res.statusCode === 403)
                        throw new CliError('Worker runtime token is changing; retry startup', 'WORKER_STARTING', 1);
                    const reply = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                    if (!reply.ok)
                        throw new CliError(reply.error?.message || 'Worker rejected request', reply.error?.code || 'IPC_ERROR', reply.error?.exitCode || 1);
                    resolve(reply.data);
                }
                catch (error) {
                    reject(error);
                }
            });
        });
        req.setTimeout(120000, () => req.destroy(new Error('Worker IPC timed out')));
        req.on('error', reject);
        req.end(JSON.stringify({ command, args }));
    });
}
export async function ensureWorker(home) {
    try {
        await rpc(home, 'status');
        return;
    }
    catch (error) {
        if (error instanceof CliError && error.code !== 'WORKER_STARTING')
            throw error;
    }
    const log = await open(join(home, 'worker.log'), 'a', 0o600);
    try {
        const child = spawn(process.execPath, [fileURLToPath(new URL('./main.js', import.meta.url)), '_worker', '--home', home], {
            detached: true, windowsHide: true, stdio: ['ignore', log.fd, log.fd], env: process.env,
        });
        child.unref();
    }
    finally {
        await log.close();
    }
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
        try {
            await rpc(home, 'status');
            return;
        }
        catch {
            await delay(100);
        }
    }
    throw new CliError(`Worker did not start; inspect ${join(home, 'worker.log')}`, 'WORKER_START_FAILED', 1);
}
