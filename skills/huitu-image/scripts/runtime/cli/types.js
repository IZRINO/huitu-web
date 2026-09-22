export class CliError extends Error {
    code;
    exitCode;
    constructor(message, code = 'INVALID_ARGUMENT', exitCode = 2) {
        super(message);
        this.code = code;
        this.exitCode = exitCode;
    }
}
export const terminal = (status) => ['succeeded', 'failed', 'cancelled', 'interrupted'].includes(status);
export const messageOf = (error) => error instanceof Error ? error.message : String(error);
