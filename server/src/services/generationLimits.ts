/** Conservative limits for the single-server pilot. A durable queue comes later. */
export const MAX_ROWS_PER_TABLE = 50_000;
export const MAX_ROWS_PER_RUN = 100_000;
let running = false;

export function validateGenerationLimits(tables: unknown, rows: unknown, seed: unknown): void {
  const fail = (message: string): never => { throw Object.assign(new Error(message), {status:400}); };
  if (!Array.isArray(tables) || !tables.length || tables.length > 100 ||
      tables.some(t => typeof t !== 'string') || new Set(tables).size !== tables.length) {
    fail('Choose 1 to 100 distinct table names.');
  }
  if (!rows || typeof rows !== 'object' || Array.isArray(rows)) fail('Row counts must be an object keyed by table name.');
  const counts = rows as Record<string, unknown>;
  const names = tables as string[];
  // Older clients may retain counts for unchecked tables; those are not generated.
  let total = 0;
  for (const table of names) {
    const count = counts[table] ?? 100;
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 1 || count > MAX_ROWS_PER_TABLE) {
      fail(`Row count for ${table} must be a whole number from 1 to ${MAX_ROWS_PER_TABLE}.`);
    }
    total += count as number;
  }
  if (total > MAX_ROWS_PER_RUN) fail(`A pilot run can request at most ${MAX_ROWS_PER_RUN} rows in total.`);
  if (typeof seed !== 'number' || !Number.isInteger(seed) || seed < 0 || seed > 4_294_967_295) fail('Seed must be a whole number from 0 to 4294967295.');
}

export async function withGenerationSlot<T>(task: () => Promise<T>): Promise<T> {
  if (running) throw Object.assign(new Error('Another dataset is being generated. Wait for it to finish, then retry.'), {status:429});
  running = true;
  try { return await task(); }
  finally { running = false; }
}