import { extractSemver, gteSemver } from './semver.ts';

// Microsoft 365 access is library-only (SPEC §15.1): the doctor no longer probes an
// ask-marcel-office binary version; a live get-current-user call IS the M365 readiness signal.
export type CheckId = 'bun' | 'qmd' | 'auth' | 'kb' | 'qmd-collection' | 'voice-profile' | 'user-md';

export type CheckStatus = 'ok' | 'missing' | 'outdated' | 'error';

export type DoctorCheck = { readonly id: CheckId; readonly status: CheckStatus; readonly detail: string; readonly fix?: string };

export type DoctorReport = { readonly ready: boolean; readonly checks: ReadonlyArray<DoctorCheck> };

export type ToolProbe = { readonly kind: 'version'; readonly stdout: string } | { readonly kind: 'absent' } | { readonly kind: 'failed'; readonly message: string };

export type AuthProbe = { readonly kind: 'ok' } | { readonly kind: 'unauthenticated' };

export type DoctorInputs = {
  readonly bun: ToolProbe;
  readonly qmd: ToolProbe;
  readonly auth: AuthProbe;
  readonly collections: ToolProbe;
  readonly kbExists: boolean;
  readonly voiceProfileExists: boolean;
  readonly userMdExists: boolean;
};

type ToolId = 'bun' | 'qmd';

const TOOL_POLICY: Readonly<Record<ToolId, { readonly minimum: string; readonly installFix: string }>> = {
  bun: { minimum: '1.2.0', installFix: 'curl -fsSL https://bun.sh/install | bash - then add ~/.bun/bin to PATH in ~/.zshrc' },
  qmd: { minimum: '2.5.0', installFix: 'bun install -g @tobilu/qmd' },
};

const COLLECTION_FIX = 'qmd collection add data/kb --name replu-kb';

const AUTH_FIX = 'sign in to Microsoft 365 via the setup skill (browser login)';

const evaluateTool = (id: ToolId, probe: ToolProbe): DoctorCheck => {
  const policy = TOOL_POLICY[id];
  if (probe.kind === 'absent') return { id, status: 'missing', detail: 'not installed', fix: policy.installFix };
  if (probe.kind === 'failed') return { id, status: 'error', detail: probe.message };
  const version = extractSemver(probe.stdout);
  if (version === undefined) return { id, status: 'error', detail: `unparseable version output: ${probe.stdout}` };
  if (!gteSemver(version, policy.minimum)) return { id, status: 'outdated', detail: `${version} is below the minimum ${policy.minimum}`, fix: policy.installFix };
  return { id, status: 'ok', detail: version };
};

const evaluateAuth = (auth: AuthProbe): DoctorCheck =>
  auth.kind === 'ok'
    ? { id: 'auth', status: 'ok', detail: 'Microsoft 365 session valid' }
    : { id: 'auth', status: 'missing', detail: 'no valid Microsoft 365 session', fix: AUTH_FIX };

const evaluateCollection = (probe: ToolProbe): DoctorCheck => {
  if (probe.kind === 'absent') return { id: 'qmd-collection', status: 'missing', detail: 'qmd is not installed', fix: COLLECTION_FIX };
  if (probe.kind === 'failed') return { id: 'qmd-collection', status: 'error', detail: probe.message };
  if (!probe.stdout.includes('replu-kb')) return { id: 'qmd-collection', status: 'missing', detail: 'collection replu-kb is not registered', fix: COLLECTION_FIX };
  return { id: 'qmd-collection', status: 'ok', detail: 'replu-kb registered' };
};

const evaluateFile = (id: CheckId, exists: boolean, path: string, fix: string): DoctorCheck =>
  exists ? { id, status: 'ok', detail: path } : { id, status: 'missing', detail: `${path} is missing`, fix };

export const evaluateDoctor = (inputs: DoctorInputs): DoctorReport => {
  const checks: ReadonlyArray<DoctorCheck> = [
    evaluateTool('bun', inputs.bun),
    evaluateTool('qmd', inputs.qmd),
    evaluateAuth(inputs.auth),
    evaluateFile('kb', inputs.kbExists, 'data/kb/index.md', 'initialize the OKF tree under data/kb (setup skill)'),
    evaluateCollection(inputs.collections),
    evaluateFile('voice-profile', inputs.voiceProfileExists, 'data/profile/voice-profile.md', 'run the voice-profile skill'),
    evaluateFile('user-md', inputs.userMdExists, 'data/profile/user.md', 'seed data/profile/user.md (setup skill)'),
  ];
  return { ready: checks.every((c) => c.status === 'ok'), checks };
};
