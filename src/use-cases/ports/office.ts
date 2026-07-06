import type { Result } from '../../domain/result.ts';

// Every M365 read goes through this port (SPEC §15.1 R1-R3): the adapter proxies the
// ask-marcel-office-cli command registry and never exposes the raw send-capable Graph client.
export type OfficeError = { readonly kind: 'command-failed'; readonly message: string; readonly status?: number } | { readonly kind: 'unknown-command'; readonly message: string };

export type Office = {
  readonly execute: (command: string, params: Record<string, string>) => Promise<Result<unknown, OfficeError>>;
};
