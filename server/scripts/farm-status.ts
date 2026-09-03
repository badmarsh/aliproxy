/**
 * farm-status.ts — terminal window into the Trial Farm.
 *
 * Usage: npm run farm:status
 * Prints keys by status, radar totals, savings meter, and expiring trials.
 */

import { closeDb, getDb } from "../lib/database.js";
import { listKeys } from "../lib/secret-store.js";
import { listGroups } from "../lib/group-store.js";
import { getTrialRadar, getExpiringTrials } from "../lib/trial-store.js";
import { getSavings } from "../lib/usage-analytics.js";
import { listClientKeys } from "../lib/client-key-store.js";

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function main(): void {
  getDb();

  const keys = listKeys();
  const groups = listGroups();
  const radar = getTrialRadar();
  const savings = getSavings();
  const expiring = getExpiringTrials(7);
  const clientKeys = listClientKeys();

  const byStatus = new Map<string, number>();
  for (const k of keys) byStatus.set(k.status, (byStatus.get(k.status) || 0) + 1);

  console.log("\n┌──────────────────────────────────────────────┐");
  console.log("│        Aliproxy 2026 · Farm Status           │");
  console.log("└──────────────────────────────────────────────┘\n");

  console.log(`  Upstream keys      ${keys.length}  (${[...byStatus].map(([s, n]) => `${n} ${s}`).join(", ") || "none"})`);
  console.log(`  Model groups       ${groups.length} enabled / ${groups.filter((g) => !g.enabled).length} disabled`);
  console.log(`  Client keys        ${clientKeys.length}  (${clientKeys.filter((k) => k.enabled).length} enabled)`);

  console.log("\n  FREE QUOTA (radar)");
  console.log(`    tokens remaining    ${radar.totals.free_tokens_remaining.toLocaleString()}`);
  console.log(`    image/video calls   ${radar.totals.free_calls_remaining.toLocaleString()}`);
  console.log(`    models tracked      ${radar.totals.models_tracked} · exhausted rows: ${radar.totals.exhausted_rows}`);

  const top = [...radar.models].filter((m) => m.kind === "tokens").sort((a, b) => b.total_remaining - a.total_remaining).slice(0, 5);
  if (top.length > 0) {
    console.log("\n    richest token pools:");
    for (const m of top) {
      console.log(`      ${m.model.padEnd(24)} ${fmtTokens(m.total_remaining).padStart(8)}  (${m.live_keys}/${m.keys.length} keys live)`);
    }
  }

  console.log("\n  SAVINGS METER");
  console.log(`    free tokens farmed   ${savings.free_tokens.toLocaleString()}`);
  console.log(`    spend avoided (est.) $${savings.estimated_spend_avoided_usd.toFixed(4)}`);
  console.log(`    requests served      ${savings.all_time.requests.toLocaleString()}`);

  if (expiring.length > 0) {
    console.log("\n  ⏰ BURN FIRST (expiring ≤ 7 days with quota left)");
    for (const t of expiring.slice(0, 8)) {
      console.log(`    ${t.alias.padEnd(24)} ${t.model.padEnd(22)} ${t.days_left}d left`);
    }
    if (expiring.length > 8) console.log(`    … +${expiring.length - 8} more`);
  }

  console.log("");
  closeDb();
}

main();
