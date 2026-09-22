#!/usr/bin/env node
try {
  await import('../dist-cli/cli/main.js')
} catch (error) {
  console.error(error.code === 'ERR_MODULE_NOT_FOUND' ? 'CLI build missing. Run npm run build:cli first.' : error.message)
  process.exitCode = 1
}
