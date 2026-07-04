import type { Clock } from '../use-cases/ports/clock.ts';

export const createSystemClock = (): Clock => ({
  todayIso: () => new Date().toISOString().slice(0, 10),
  nowIso: () => new Date().toISOString(),
});
