import { extractSemver, gteSemver } from './semver.ts';

export type CheckId = 'bun' | 'qmd' | 'ask-marcel' | 'auth' | 'kb' | 'qmd-collection' | 'voice-profile' | 'user-md';

export type CheckStatus = 'ok' | 'missing' | 'outdated' | 'error';

export type DoctorCheck = { readonly id: CheckId; readonly status: CheckStatus; readonly detail: string; readonly fix?: string };

export type DoctorReport = { readonly ready: boolean; readonly checks: ReadonlyArray<DoctorCheck> };

export type ToolProbe = { readonly kind: 'version'; readonly stdout: string } | { readonly kind: 'absent' } | { readonly kind: 'failed'; readonly message: string };

export type AuthProbe = { readonly kind: 'ok' } | { readonly kind: 'unauthenticated' } | { readonly kind: 'failed'; readonly message: string };

export type DoctorInputs = {
  readonly bun: ToolProbe;
  readonly qmd: ToolProbe;
  readonly askMarcel: ToolProbe;
  readonly auth: AuthProbe;
};

type ToolId = 'bun' | 'qmd' | 'ask-marcel';

const TOOL_POLICY: Readonly<Record<ToolId, { readonly minimum: string; readonly installFix: string }>> = {
  bun: { minimum: '1.2.0', installFix: 'curl -fsSL https://bun.sh/install | bash - then add ~/.bun/bin to PATH in ~/.zshrc' },
  qmd: { minimum: '2.5.0', installFix: 'bun install -g @tobilu/qmd' },
  'ask-marcel': { minimum: '1.5.0', installFix: 'npm i -g ask-marcel-office-cli (or: ask-marcel update)' },
};

const evaluateTool = (id: ToolId, probe: ToolProbe): DoctorCheck => {
  const policy = TOOL_POLICY[id];
  if (probe.kind === 'absent') return { id, status: 'missing', detail: 'not installed', fix: policy.installFix };
  if (probe.kind === 'failed') return { id, status: 'error', detail: probe.message };
  const version = extractSemver(probe.stdout);
  if (version === undefined) return { id, status: 'error', detail: `unparseable version output: ${probe.stdout}` };
  if (!gteSemver(version, policy.minimum)) return { id, status: 'outdated', detail: `${version} is below the minimum ${policy.minimum}`, fix: policy.installFix };
  return { id, status: 'ok', detail: version };
};

const evaluateAuth = (auth: AuthProbe): DoctorCheck => {
  if (auth.kind === 'ok') return { id: 'auth', status: 'ok', detail: 'Microsoft 365 session valid' };
  if (auth.kind === 'unauthenticated') return { id: 'auth', status: 'missing', detail: 'no valid Microsoft 365 session', fix: 'ask-marcel login' };
  return { id: 'auth', status: 'error', detail: auth.message };
};

export const evaluateDoctor = (inputs: DoctorInputs): DoctorReport => {
  const checks: ReadonlyArray<DoctorCheck> = [
    evaluateTool('bun', inputs.bun),
    evaluateTool('qmd', inputs.qmd),
    evaluateTool('ask-marcel', inputs.askMarcel),
    evaluateAuth(inputs.auth),
  ];
  return { ready: checks.every((c) => c.status === 'ok'), checks };
};
