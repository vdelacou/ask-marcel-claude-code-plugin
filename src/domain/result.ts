export type Result<T, E> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

export const mapResult = <T, U, E>(r: Result<T, E>, f: (t: T) => U): Result<U, E> => (r.ok ? ok(f(r.value)) : r);

export const mapError = <T, E, F>(r: Result<T, E>, f: (e: E) => F): Result<T, F> => (r.ok ? r : err(f(r.error)));

export const andThen = <T, U, E>(r: Result<T, E>, f: (t: T) => Result<U, E>): Result<U, E> => (r.ok ? f(r.value) : r);

export const unwrap = <T, E>(r: Result<T, E>): T => {
  if (!r.ok) throw new Error(`unwrap on err: ${JSON.stringify(r.error)}`);
  return r.value;
};
