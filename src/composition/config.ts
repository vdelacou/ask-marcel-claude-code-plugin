export type SeedConfig = { readonly relevantTop: number; readonly pageCap: number };

export type AppConfig = { readonly logLevel: string; readonly seed: SeedConfig };

// v0.1 defaults per SPEC.md decision 15/§2 — raised once the flow is proven.
export const loadConfig = (env: Readonly<Record<string, string | undefined>>): AppConfig => ({
  logLevel: env['LOG_LEVEL'] ?? 'info',
  seed: { relevantTop: 15, pageCap: 40 },
});
