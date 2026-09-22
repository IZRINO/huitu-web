import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const target = join(root, 'skills', 'huitu-image', 'scripts', 'runtime')
const check = process.argv.includes('--check')
const temporary = await mkdtemp(join(tmpdir(), 'huitu-skill-build-'))
const temporaryChild = relative(resolve(tmpdir()), resolve(temporary))
if (isAbsolute(temporaryChild) || temporaryChild.startsWith('..') || !temporaryChild.startsWith('huitu-skill-build-')) throw new Error('Refusing cleanup outside skill build temporary directory')
async function files(dir, prefix = '') {
  const result = []
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const name = prefix ? `${prefix}/${item.name}` : item.name
    if (item.isDirectory()) result.push(...await files(join(dir, item.name), name))
    else result.push(name)
  }
  return result.sort()
}
try {
  const compiled = spawnSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', join(root, 'tsconfig.cli.json'), '--outDir', temporary], { cwd: root, stdio: 'inherit', windowsHide: true })
  if (compiled.error) throw compiled.error
  if (compiled.status !== 0) throw new Error(`CLI compilation failed (${compiled.status})`)
  await writeFile(join(temporary, 'package.json'), JSON.stringify({ private: true, type: 'module', engines: { node: '^20.19.0 || >=22.12.0' } }, null, 2) + '\n')
  const expected = await files(temporary)
  if (check) {
    const actual = await files(target)
    if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error('Skill runtime file list is stale. Run npm run build:skill')
  }
  for (const name of expected) {
    const content = await readFile(join(temporary, name), 'utf8')
    if (check) {
      if ((await readFile(join(target, name), 'utf8')).replace(/\r\n/g, '\n') !== content.replace(/\r\n/g, '\n')) throw new Error(`Skill runtime is stale: ${name}. Run npm run build:skill`)
    } else {
      await mkdir(dirname(join(target, name)), { recursive: true })
      await writeFile(join(target, name), content)
    }
  }
  if (!check) {
    for (const name of await files(target)) if (!expected.includes(name)) await rm(join(target, name))
  }
  console.log(`Skill runtime ${check ? 'verified' : 'built'}: ${expected.length} files, no external runtime dependencies`)
} finally {
  await rm(temporary, { recursive: true, force: true })
}
