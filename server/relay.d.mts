import type { IncomingMessage, ServerResponse } from 'node:http'
export function handleRelay(req: IncomingMessage, res: ServerResponse): Promise<void>
