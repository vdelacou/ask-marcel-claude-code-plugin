import { err } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';
import type { Office, OfficeError } from '../use-cases/ports/office.ts';

// A test double for the Office port that ALSO enforces the ask-marcel-office-cli param contracts the
// plugin depends on. A hand fake that silently accepts a value the real library rejects (a lowercase
// bodyContentType, say) is exactly how the draft-creation casing bug shipped green; here the same call
// fails as a command-failed error, mirroring the library's zod rejection. Handlers give each command
// its canned response; an unlisted command returns unknown-command, like the real registry.
export type OfficeCall = { readonly command: string; readonly params: Record<string, string> };
export type OfficeHandler = (params: Record<string, string>) => Promise<Result<unknown, OfficeError>>;
export type OfficeFake = Office & { readonly calls: ReadonlyArray<OfficeCall> };

// Mirror the library's zod enums for the params our commands actually send; extend as we call more.
const enumViolation = (params: Record<string, string>, key: string, allowed: ReadonlyArray<string>): string | undefined => {
  if (!Object.hasOwn(params, key)) return undefined;
  const value = params[key];
  return allowed.includes(value) ? undefined : `${key} must be ${allowed.join('|')}, got '${value}'`;
};

const contractViolation = (command: string, params: Record<string, string>): string | undefined =>
  command === 'create-reply-draft' || command === 'update-mail-draft' ? enumViolation(params, 'bodyContentType', ['Text', 'HTML']) : undefined;

export const createOfficeFake = (handlers: Readonly<Record<string, OfficeHandler>>): OfficeFake => {
  const calls: OfficeCall[] = [];
  return {
    calls,
    execute: async (command, params) => {
      calls.push({ command, params });
      const violation = contractViolation(command, params);
      if (violation !== undefined) return err({ kind: 'command-failed', message: `library rejected ${command}: ${violation}` });
      return Object.hasOwn(handlers, command) ? handlers[command](params) : err({ kind: 'unknown-command', message: command });
    },
  };
};
