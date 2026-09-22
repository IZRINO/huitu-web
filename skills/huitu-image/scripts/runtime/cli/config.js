import { homedir } from 'node:os';
import { resolve, join } from 'node:path';
import { defaultSettings, defaultParams } from '../src/lib/defaults.js';
import { ASPECTS, resolveSize, validateSize } from '../src/lib/size.js';
import { parseExtra } from '../src/lib/api.js';
import { CliError } from './types.js';
export function defaults() {
    return { version: 1, concurrency: 3, outputDir: join(homedir(), 'Pictures', 'huitu'),
        generationTimeout: 600, downloadTimeout: 60, defaultProfile: 'default',
        defaults: {}, profiles: { default: {} } };
}
export function object(value, name = 'input') {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new CliError(`${name} must be an object`);
}
export function keys(value, allowed, name) {
    for (const key of Object.keys(value))
        if (!allowed.includes(key))
            throw new CliError(`Unknown ${name} field: ${key}`);
}
export function integer(value, min, max, name) {
    if (!Number.isInteger(value) || Number(value) < min || Number(value) > max)
        throw new CliError(`${name} must be an integer between ${min} and ${max}`);
}
export function text(value, name) {
    if (typeof value !== 'string')
        throw new CliError(`${name} must be a string`);
}
export function url(value, name) {
    try {
        const u = new URL(value);
        if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password)
            throw new Error();
    }
    catch {
        throw new CliError(`${name} must be an absolute HTTP(S) URL without embedded credentials`);
    }
}
export function profileName(value) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(value) || ['__proto__', 'constructor', 'prototype'].includes(value))
        throw new CliError('Invalid profile name');
}
const choices = {
    quality: ['auto', 'low', 'medium', 'high', 'xhigh', 'max'], background: ['auto', 'transparent', 'opaque'],
    format: ['png', 'webp', 'jpeg'], moderation: ['auto', 'low'], fidelity: ['low', 'high'],
    sizeMode: ['auto', 'preset', 'aspect', 'custom'], aspect: ASPECTS.map(a => a.id),
};
export function validateParams(input) {
    object(input, 'params');
    keys(input, Object.keys(defaultParams()), 'params');
    for (const [key, value] of Object.entries(input)) {
        if (choices[key]) {
            if (!choices[key].includes(value))
                throw new CliError(`Invalid ${key}: ${value}`);
        }
        else if (key === 'stream') {
            if (typeof value !== 'boolean')
                throw new CliError('stream must be boolean');
        }
        else if (key === 'sizePreset')
            text(value, key);
        else if (key === 'n')
            integer(value, 1, 10, key);
        else if (key === 'compression')
            integer(value, 0, 100, key);
        else if (key === 'partialImages')
            integer(value, 0, 3, key);
        else
            integer(value, 16, 3840, key);
    }
}
export function validateSettings(input) {
    object(input, 'settings');
    keys(input, [...Object.keys(defaultSettings()), 'relayUrl'], 'settings');
    for (const [key, value] of Object.entries(input)) {
        if (key === 'useProxy') {
            if (typeof value !== 'boolean')
                throw new CliError('useProxy must be boolean');
        }
        else {
            text(value, key);
            if (key === 'baseUrl' || (key === 'relayUrl' && value))
                url(value, key);
            if (key === 'model' && !value.trim())
                throw new CliError('model cannot be empty');
            if (key === 'extraHeaders') {
                try {
                    new Headers(parseExtra(value));
                }
                catch {
                    throw new CliError('extraHeaders must be a JSON object of valid string headers');
                }
            }
        }
    }
}
export function validateProfile(input) {
    object(input, 'profile');
    keys(input, ['settings', 'params', 'apiKeyEnv', 'outputDir'], 'profile');
    if (input.settings !== undefined)
        validateSettings(input.settings);
    if (input.params !== undefined)
        validateParams(input.params);
    if (input.apiKeyEnv !== undefined) {
        text(input.apiKeyEnv, 'apiKeyEnv');
        if (input.apiKeyEnv && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(input.apiKeyEnv))
            throw new CliError('Invalid environment variable name');
    }
    if (input.outputDir !== undefined) {
        text(input.outputDir, 'outputDir');
        if (!input.outputDir.trim())
            throw new CliError('outputDir cannot be empty');
    }
}
export function mergeProfile(a, b) {
    return { ...a, ...b, settings: { ...a.settings, ...b.settings }, params: { ...a.params, ...b.params } };
}
export function validateConfig(c) {
    object(c, 'config');
    keys(c, Object.keys(defaults()), 'config');
    if (c.version !== 1)
        throw new CliError('Unsupported config version');
    integer(c.concurrency, 1, 100, 'concurrency');
    integer(c.generationTimeout, 1, 86400, 'generationTimeout');
    integer(c.downloadTimeout, 1, 86400, 'downloadTimeout');
    text(c.outputDir, 'outputDir');
    if (!c.outputDir.trim())
        throw new CliError('outputDir cannot be empty');
    validateProfile(c.defaults);
    object(c.profiles, 'profiles');
    for (const [name, value] of Object.entries(c.profiles)) {
        profileName(name);
        validateProfile(value);
    }
    text(c.defaultProfile, 'defaultProfile');
    if (!Object.hasOwn(c.profiles, c.defaultProfile))
        throw new CliError('Default profile does not exist');
}
export function resolveSpec(config, input) {
    object(input, 'job');
    keys(input, ['mode', 'prompt', 'profile', 'settings', 'params', 'apiKeyEnv', 'outputDir', 'images', 'mask'], 'job');
    if (input.mode !== 'generate' && input.mode !== 'edit')
        throw new CliError('mode must be generate or edit');
    text(input.prompt, 'prompt');
    if (!input.prompt.trim() || input.prompt.length > 32000)
        throw new CliError('prompt must contain 1-32000 characters');
    const spec = input;
    const name = spec.profile ?? config.defaultProfile;
    profileName(name);
    if (!Object.hasOwn(config.profiles, name))
        throw new CliError(`Unknown profile: ${name}`);
    const overrides = { settings: spec.settings, params: spec.params, apiKeyEnv: spec.apiKeyEnv, outputDir: spec.outputDir };
    for (const key of Object.keys(overrides))
        if (overrides[key] === undefined)
            delete overrides[key];
    validateProfile(overrides);
    if (spec.settings?.apiKey)
        throw new CliError('Set API keys with profile set or an environment variable');
    const merged = mergeProfile(mergeProfile(config.defaults, config.profiles[name]), overrides);
    const settings = { ...defaultSettings(), useProxy: false, ...merged.settings };
    const params = { ...defaultParams(), ...merged.params };
    const size = resolveSize(params), check = validateSize(size);
    if (!check.ok)
        throw new CliError(check.message);
    if (settings.useProxy && !settings.relayUrl)
        throw new CliError('CLI proxy mode requires relayUrl');
    const images = spec.images ?? [];
    if (!Array.isArray(images) || images.some(x => typeof x !== 'string') || images.length > 16)
        throw new CliError('images must contain at most 16 file paths');
    if (spec.mask !== undefined)
        text(spec.mask, 'mask');
    if (spec.mode === 'edit' && !images.length)
        throw new CliError('edit requires at least one image');
    if (spec.mode === 'generate' && (images.length || spec.mask))
        throw new CliError('Reference images and masks require edit mode');
    return { name, settings, params, size, apiKeyEnv: merged.apiKeyEnv, images, outputDir: resolve(merged.outputDir ?? config.outputDir) };
}
export function publicValue(value) {
    return JSON.parse(JSON.stringify(value, (key, val) => key === 'apiKey' || key === 'extraHeaders' ? '' : val));
}
