import dns from 'node:dns/promises'
import { syncBuiltinESMExports } from 'node:module'
import { setTimeout as delay } from 'node:timers/promises'

const lookup = dns.lookup
dns.lookup = async (hostname, options) => {
  if (hostname !== 'pending.invalid') return lookup(hostname, options)
  process.stdout.write('DNS lookup started\n')
  await delay(1000)
  return [{ address: '127.0.0.1', family: 4 }]
}
syncBuiltinESMExports()
