import type { FileProbe } from '../use-cases/ports/file-probe.ts';

export const createBunFileProbe = (): FileProbe => ({
  exists: (path) => Bun.file(path).exists(),
});
