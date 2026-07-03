import type { Result } from '../../domain/result.ts';

export type RunError = { readonly kind: 'not-found'; readonly message: string } | { readonly kind: 'spawn-failed'; readonly message: string };

export type CommandOutput = { readonly stdout: string; readonly exitCode: number };

export type CommandRunner = {
  readonly run: (cmd: string, args: ReadonlyArray<string>) => Promise<Result<CommandOutput, RunError>>;
};
