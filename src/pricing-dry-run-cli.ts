import { dryRunPricing } from "./pricing-dry-run.js";

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== "--reviewed-url") {
  console.error("Usage: node dist/pricing-dry-run-cli.js --reviewed-url <approved HTTPS URL>");
  process.exitCode = 2;
} else {
  try {
    const result = await dryRunPricing(args[1]);
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } catch {
    // Never print upstream errors or URL query strings.
    console.error(JSON.stringify({ error: "dry_run_failed" }));
    process.exitCode = 1;
  }
}
