import { resolve, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ensure } from "../../ps/lib/model.mjs";

const DATE_FIELDS = new Set(["fetchedAt", "updatedAt", "createdAt", "asOf", "observedAt", "timestamp", "start", "end"]);

export function redateFixture(snapshot, now) {
  ensure(snapshot?.mode === "fixture", "Only fixture dates may be refreshed.");
  ensure(Number.isFinite(now) && Number.isFinite(new Date(now).getTime()), "Invalid refresh time.");
  const anchor = Date.parse(snapshot.fetchedAt);
  ensure(Number.isFinite(anchor), "Invalid fixture fetchedAt.");
  ensure(now >= anchor, "Cannot refresh fixture dates backwards.");
  const offset = now - anchor;
  function shift(value) {
    if (Array.isArray(value)) return value.map(shift);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).map(([key, child]) => {
      if (!DATE_FIELDS.has(key)) return [key, shift(child)];
      ensure(typeof child === "string" && Number.isFinite(Date.parse(child)), `Invalid fixture date: ${key}.`);
      return [key, new Date(Date.parse(child) + offset).toISOString()];
    }));
  }
  return shift(snapshot);
}

export async function refreshData(productId, service) {
  const result = await service.refreshFixtures(productId);
  return {
    schemaVersion: "1.0",
    pipelineVersion: "0.1.0",
    skillName: "ps-data-refresh",
    skillVersion: "0.5.1",
    ...result,
    retrieved: false,
    ingested: false,
    note: "Local sample dates only; no sources queried. Live evidence, release dates and reviewed history are unchanged.",
  };
}

export async function main(args = process.argv.slice(2)) {
  if (![1, 3].includes(args.length) || !args[0]
      || (args[0].startsWith("--") && args[0] !== "--all")
      || (args.length === 3 && (args[1] !== "--data-dir" || !args[2]))) {
    throw new Error("Usage: node skills/ps-data-refresh/scripts/refresh.mjs PRODUCT_ID|--all [--data-dir PATH]");
  }
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const dataDir = args.length === 3 ? resolve(args[2]) : join(root, ".ps");
  const { openStore } = await import("../../ps/lib/store.mjs");
  const service = await openStore({ root, dataDir });
  try {
    const result = await refreshData(args[0] === "--all" ? undefined : args[0], service);
    console.log(JSON.stringify(result, null, 2));
    return result;
  } finally {
    await service.close();
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(JSON.stringify({ schemaVersion: "1.0", error: error.message }));
    process.exitCode = 1;
  });
}
