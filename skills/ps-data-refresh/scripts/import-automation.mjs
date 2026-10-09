import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

async function readDefinition() {
  const deployed = new URL("../references/automations/ps-data-refresh/manifest.json", import.meta.url);
  let content;
  try { content = await readFile(deployed, "utf8"); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    content = await readFile(new URL("../../../automations/ps-data-refresh/manifest.json", import.meta.url), "utf8");
  }
  return JSON.parse(content);
}

export async function automationDraft(time = "09:00") {
  if (typeof time !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    throw new Error("Automation time must be HH:mm in local 24-hour time.");
  }
  const definition = await readDefinition();
  if (definition.name !== "ps-data-refresh" || definition.schemaVersion !== "1.0"
      || definition.scheduling?.intervalHours !== 24 || definition.scheduling.trigger !== "daily"
      || definition.inputs?.scope !== "all" || typeof definition.prompt !== "string"
      || !definition.prompt.startsWith("/ps-data-refresh ") || definition.prompt.length > 2000) {
    throw new Error("Invalid daily sample-refresh automation definition.");
  }
  const parameters = new URLSearchParams({
    name: definition.name, trigger: "daily", time, prompt: definition.prompt,
  });
  const appLink = `ghapp://automations/new?${parameters}`;
  return {
    schemaVersion: "1.0", status: "confirmation-required",
    name: definition.name, scope: "all", trigger: "daily", time,
    intervalHours: 24, execution: "local",
    appLink, launcherUrl: `https://github.com/copilot/app/launch?open=${encodeURIComponent(appLink)}`,
    note: "Review the local daily schedule and project in Copilot App, then confirm Create. This link only opens a draft; no automation has been created.",
  };
}

export async function main(args = process.argv.slice(2)) {
  if (args.length && (args.length !== 2 || args[0] !== "--time")) {
    throw new Error("Usage: node skills/ps-data-refresh/scripts/import-automation.mjs [--time HH:mm]");
  }
  const result = await automationDraft(args[1]);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => {
    console.error(JSON.stringify({ schemaVersion: "1.0", error: error.message }));
    process.exitCode = 1;
  });
}
