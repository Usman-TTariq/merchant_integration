/**
 * Pre-deploy validation: build + production env checks.
 * Usage: npm run deploy:check
 */
import { spawnSync } from "node:child_process";

function run(cmd: string, args: string[]): number {
  const result = spawnSync(cmd, args, { stdio: "inherit", shell: true });
  return result.status ?? 1;
}

console.log("=== Deploy check ===\n");

console.log("1/2 TypeScript build…");
if (run("npm", ["run", "build"]) !== 0) process.exit(1);

console.log("\n2/2 Production env verify…");
const envCode = run("npm", ["run", "env:verify", "--", "--production"]);
if (envCode !== 0) {
  console.log("\nDeploy check: build OK, env incomplete.");
  console.log("Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in Vercel, then:");
  console.log("  npx vercel login");
  console.log("  npx vercel --prod");
  console.log("  npm run db:setup");
  console.log("  npm run prod:bootstrap");
  process.exit(1);
}

console.log("\nDeploy check passed. Run: npx vercel --prod");
