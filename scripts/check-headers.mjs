#!/usr/bin/env node
/**
 * "Does my site still announce what it runs?"
 *
 * A header claim in a document is a claim. This asks the site itself, and exits
 * non-zero if a response names the framework or a version — so it can be run
 * after every deploy, or pasted into a monitoring check.
 *
 *   node scripts/check-headers.mjs                      # https://pryvalogs.com
 *   node scripts/check-headers.mjs http://localhost:3111
 *   node scripts/check-headers.mjs https://pryva.example /api/health /login
 *
 * What it can and cannot see is stated in the output rather than implied:
 * `Server: Vercel` is written by the platform after the app runs, so it appears
 * here as a note — hiding it needs a proxy in front of the deployment.
 */
import { inspectBanners, revealsVersion } from "../src/lib/platform/server-banner.ts";

const base = (process.argv[2] ?? "https://pryvalogs.com").replace(/\/$/, "");
const paths = process.argv.slice(3);
const targets = paths.length > 0 ? paths : ["/", "/login", "/api/health", "/dashboard/support"];

const checked = [];
const leaks = [];
const notices = [];

function headerObject(response) {
  const out = {};
  response.headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

for (const path of targets) {
  const url = `${base}${path}`;
  try {
    const response = await fetch(url, { redirect: "manual" });
    const headers = headerObject(response);
    const report = inspectBanners(headers, { hostedOnVercel: /vercel/i.test(headers.server ?? "") || /\.vercel\.app$/.test(base) });
    checked.push({ url, status: response.status });
    leaks.push(...report.leaks.map((leak) => ({ ...leak, url })));
    notices.push(...report.notices.map((notice) => ({ ...notice, url })));

    // A framework banner under another name is still a banner: anything whose
    // value names a version is reported even if the header is unfamiliar.
    for (const [key, value] of Object.entries(headers)) {
      if (key.startsWith("x-") && /next\.?js|express|php|django|laravel|wordpress/i.test(value)) {
        const already = leaks.some((leak) => leak.url === url && leak.header === key);
        if (!already) {
          leaks.push({ url, header: key, value, why: "names the software behind the site", fixable: true });
        }
      }
    }
  } catch (error) {
    console.error(`✗ ${url} — could not be reached: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  }
}

console.log(`Checked ${checked.length} response(s) from ${base}\n`);
for (const entry of checked) console.log(`  ${String(entry.status).padEnd(4)} ${entry.url}`);

// "No leaks" and "nothing was examined" are different answers, and only one of
// them is good news. A host that could not be reached — egress-blocked sandbox,
// DNS typo, a deployment protection wall — used to fall through to the green
// line below and read as a passing check with zero evidence behind it. The exit
// code was already 2, but the sentence a human reads said the opposite.
if (checked.length === 0) {
  console.log(`\n✗ Nothing was checked: no response from ${base}. This is not a pass.`);
  process.exitCode = 2;
} else if (leaks.length === 0) {
  console.log("\n✓ No framework banner and no version in any response header.");
} else {
  console.log("\n✗ These responses disclose the stack:");
  for (const leak of leaks) {
    console.log(`   ${leak.url}\n     ${leak.header}: ${leak.value}\n     → ${leak.why}`);
    console.log(`     ${leak.fixable ? "app code removes this; redeploy if it is still here" : "only a proxy in front of the deployment can remove this"}`);
  }
  process.exitCode = 1;
}

if (notices.length > 0) {
  const named = [...new Set(notices.map((notice) => `${notice.header}: ${notice.value}`))];
  console.log(
    `\nNote: ${named.join(", ")} — identifies the host, carries no version, and is written by the platform after the app runs.` +
      (revealsVersion(notices[0]?.value) ? "" : " Nothing exploitable is disclosed by it; removing it needs a proxy in front (Cloudflare, nginx)."),
  );
}
