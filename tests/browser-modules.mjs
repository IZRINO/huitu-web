import { mkdtemp, mkdir, readFile, readdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

export async function browserModules(t) {
  const dir = await mkdtemp(join(tmpdir(), 'huitu-browser-tests-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await mkdir(join(dir, 'lib'))
  await writeFile(join(dir, 'package.json'), '{"type":"module"}')
  for (const name of await readdir('src/lib')) {
    if (!name.endsWith('.ts')) continue
    const result = ts.transpileModule(await readFile(join('src/lib', name), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2023 },
      transformers: { after: [context => root => ts.visitEachChild(root, node => {
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
          const path = node.moduleSpecifier.text
          if (path.startsWith('.') && !path.endsWith('.js')) {
            const specifier = ts.factory.createStringLiteral(`${path}.js`)
            return ts.isImportDeclaration(node)
              ? ts.factory.updateImportDeclaration(node, node.modifiers, node.importClause, specifier, node.attributes)
              : ts.factory.updateExportDeclaration(node, node.modifiers, node.isTypeOnly, node.exportClause, specifier, node.attributes)
          }
        }
        return node
      }, context)] },
    })
    await writeFile(join(dir, 'lib', name.replace(/\.ts$/, '.js')), result.outputText)
  }
  return name => import(pathToFileURL(join(dir, 'lib', `${name}.js`)).href)
}
