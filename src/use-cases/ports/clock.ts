export type Clock = {
  readonly todayIso: () => string;
  readonly nowIso: () => string;
};
