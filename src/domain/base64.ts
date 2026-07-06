import { err, ok } from './result.ts';
import type { Result } from './result.ts';

// Uint8Array.fromBase64 (TC39, native in Bun) throws SyntaxError on malformed input — a
// pure-domain native-thrower fallback (rule 17). Graph's contentBytes are always valid
// base64, so the err branch is defensive but real (spaces / stray symbols do throw).
export const decodeBase64 = (base64: string): Result<Uint8Array, string> => {
  try {
    return ok(Uint8Array.fromBase64(base64));
  } catch {
    return err('invalid base64');
  }
};
