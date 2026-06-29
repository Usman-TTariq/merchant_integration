/** In-memory job locks (per serverless instance). Same job cannot overlap; different jobs may run in parallel. */
const runningJobs = new Map<string, number>();

const DEFAULT_TTL_MS = 320_000;

const JOB_LOCK_TTL_MS: Record<string, number> = {
  stock: 600_000,
  products: 600_000,
  inventory: 600_000,
  orders: 120_000,
  all: 600_000,
  "barcode-cache": DEFAULT_TTL_MS,
  "barcode-index": DEFAULT_TTL_MS,
  link: DEFAULT_TTL_MS,
  "barcode-link": DEFAULT_TTL_MS,
};

export function tryAcquireJobLock(job: string): boolean {
  const now = Date.now();
  const ttl = JOB_LOCK_TTL_MS[job] ?? DEFAULT_TTL_MS;
  const started = runningJobs.get(job);
  if (started != null && now - started < ttl) return false;
  runningJobs.set(job, now);
  return true;
}

export function releaseJobLock(job: string): void {
  runningJobs.delete(job);
}

export function jobLockStatus(): Record<string, number> {
  return Object.fromEntries(runningJobs);
}
