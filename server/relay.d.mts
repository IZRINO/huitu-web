import type { IncomingMessage, ServerResponse } from 'node:http'
export const publicRelay: boolean
export function handleRelay(req: IncomingMessage, res: ServerResponse): Promise<void>
