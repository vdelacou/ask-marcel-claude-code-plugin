export type SeedConfig = { readonly relevantTop: number; readonly pageCap: number };

export type VoiceConfig = { readonly fetchTop: number; readonly keep: number };

export type AppConfig = { readonly logLevel: string; readonly seed: SeedConfig; readonly voice: VoiceConfig };

// v0.1 defaults per SPEC.md decisions 15/21 and §9 — raised once the flow is proven.
export const loadConfig = (env: Readonly<Record<string, string | undefined>>): AppConfig => ({
  logLevel: env['LOG_LEVEL'] ?? 'info',
  seed: { relevantTop: 15, pageCap: 40 },
  voice: { fetchTop: 100, keep: 50 },
});
