export type SeedConfig = { readonly relevantTop: number; readonly pageCap: number };

export type VoiceConfig = { readonly fetchTop: number; readonly keep: number };

export type ScanConfig = { readonly cap: number };

export type TriageConfig = { readonly batchSize: number };

export type ResearchConfig = { readonly batchSize: number };

export type SearchConfig = { readonly topPerBackend: number };

export type ScratchConfig = { readonly retentionDays: number };

export type FollowUpsConfig = { readonly fetchTop: number; readonly minAgeDays: number };

export type AppConfig = {
  readonly logLevel: string;
  readonly seed: SeedConfig;
  readonly voice: VoiceConfig;
  readonly scan: ScanConfig;
  readonly triage: TriageConfig;
  readonly research: ResearchConfig;
  readonly search: SearchConfig;
  readonly scratch: ScratchConfig;
  readonly followUps: FollowUpsConfig;
};

// v0.1 defaults per SPEC.md decision 15 (scan 25 / triage 4 / research 2 — raised to 50/8/4 once
// the flow is proven), decision 21 / §9 (voice), and §6 (search: 10 hits per backend per round
// keeps the merged list readable; a round that needs more passes --top).
export const loadConfig = (env: Readonly<Record<string, string | undefined>>): AppConfig => ({
  logLevel: env['LOG_LEVEL'] ?? 'info',
  seed: { relevantTop: 15, pageCap: 40 },
  voice: { fetchTop: 100, keep: 50 },
  scan: { cap: 25 },
  triage: { batchSize: 4 },
  research: { batchSize: 2 },
  search: { topPerBackend: 10 },
  scratch: { retentionDays: 7 },
  followUps: { fetchTop: 100, minAgeDays: 3 },
});
