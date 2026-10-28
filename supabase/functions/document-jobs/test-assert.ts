/** Dependency-free assertions for the document-jobs Deno tests (no remote imports). */
export function assert(condition: unknown, message = 'Assertion failed'): asserts condition {
  if (!condition) throw new Error(message);
}
export function assertEquals(actual: unknown, expected: unknown, message = ''): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message ? message + ': ' : ''}atteso ${e}, ricevuto ${a}`);
}
export function assertThrows(fn: () => unknown): unknown {
  try { fn(); } catch (error) { return error; }
  throw new Error('Era attesa un’eccezione.');
}
