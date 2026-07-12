import { DEFERRALS_PATH, dueDeferrals, parseDeferrals, renderDeferrals, upsertDeferral, withoutDeferrals } from '../domain/deferral.ts';
import type { Deferral } from '../domain/deferral.ts';
import { err, ok } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';
import type { Clock } from './ports/clock.ts';
import type { FileProbe } from './ports/file-probe.ts';
import type { FileReader, ReadError } from './ports/file-reader.ts';
import type { FileWriter, WriteError } from './ports/file-writer.ts';

export type DeferralsError = ReadError | WriteError;

type Deps = { readonly files: FileProbe; readonly reader: FileReader; readonly writer: FileWriter; readonly clock: Clock };

// A missing file is an empty book; an existing-but-unreadable one is a real error we never clobber.
const readAll = async (deps: Deps): Promise<Result<ReadonlyArray<Deferral>, ReadError>> => {
  if (!(await deps.files.exists(DEFERRALS_PATH))) return ok([]);
  const content = await deps.reader.read(DEFERRALS_PATH);
  return content.ok ? ok(parseDeferrals(content.value)) : err(content.error);
};

export type AddDeferral = (deferral: Deferral) => Promise<Result<void, DeferralsError>>;

export const createAddDeferral =
  (deps: Deps): AddDeferral =>
  async (deferral) => {
    const all = await readAll(deps);
    if (!all.ok) return err(all.error);
    return deps.writer.write(DEFERRALS_PATH, renderDeferrals(upsertDeferral(all.value, deferral)));
  };

export type ListDeferrals = () => Promise<Result<ReadonlyArray<Deferral>, DeferralsError>>;

export const createListDeferrals =
  (deps: Deps): ListDeferrals =>
  async () =>
    readAll(deps);

export type DueDeferrals = (options: { readonly consume: boolean }) => Promise<Result<ReadonlyArray<Deferral>, DeferralsError>>;

// `consume` removes what it returns (like the KB queue): the resurfaced threads enter the
// current run's triage, so the book must not offer them again tomorrow.
export const createDueDeferrals =
  (deps: Deps): DueDeferrals =>
  async (options) => {
    const all = await readAll(deps);
    if (!all.ok) return err(all.error);
    const due = dueDeferrals(all.value, deps.clock.todayIso());
    if (!options.consume || due.length === 0) return ok(due);
    const written = await deps.writer.write(
      DEFERRALS_PATH,
      renderDeferrals(
        withoutDeferrals(
          all.value,
          due.map((deferral) => deferral.conversationId)
        )
      )
    );
    return written.ok ? ok(due) : err(written.error);
  };
