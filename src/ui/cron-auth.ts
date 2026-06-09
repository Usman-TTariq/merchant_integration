function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Authorize Vercel Cron or external schedulers hitting /api/cron/*. */
export function isCronAuthorized(req: {
  headers: { authorization?: string | string[]; "x-vercel-cron"?: string | string[] };
}): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  const auth = headerValue(req.headers.authorization);
  const vercelCron = headerValue(req.headers["x-vercel-cron"]) === "1";

  if (secret) {
    return auth === `Bearer ${secret}`;
  }

  return Boolean(process.env.VERCEL && vercelCron);
}
