import { formatError } from './domain/utilities/format-error.ts';

const main = async (): Promise<void> => {
  // Composition wiring lands with the first entry point (SPEC.md §16, M1).
};

try {
  await main();
} catch (e) {
  process.stderr.write(`crashed (unexpected): ${formatError(e)}\n`);
  process.exit(1);
}
