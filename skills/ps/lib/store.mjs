import { mkdir, open, readFile, rename, unlink, lstat } from "node:fs/promises";
import path from "node:path";
import { readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import { VERSION, ROLES, ensure, validateConfig, validateSnapshot, assess, correlate, changesSince, investigationPrompt } from "./model.mjs";
import { validatePreview, summarizePreview } from "./preview-model.mjs";
import { redateFixture } from "../../ps-data-refresh/scripts/refresh.mjs";

function readJson(file) {
  try { return JSON.parse(readFileSync(file, "utf8")); }
  catch (error) { throw new Error(`Cannot read ${file}: ${error.message}`, { cause: error }); }
}

async function acquireWriterLock(lockPath) {
  async function create() {
    const handle = await open(lockPath, "wx", 0o600);
    try {
      await handle.writeFile(String(process.pid));
      await handle.sync();
      return handle;
    } catch (error) {
      await handle.close();
      await unlink(lockPath);
      throw error;
    }
  }
  try { return await create(); }
  catch (error) { if (error.code !== "EEXIST") throw error; }

  // Serialize stale-lock recovery so two starters cannot remove a new owner's lock.
  const recoveryPath = `${lockPath}.recovery`;
  const recovery = await open(recoveryPath, "wx", 0o600);
  try {
    const metadata = await lstat(lockPath).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (!metadata) return await create();
    ensure(metadata.isFile() && !metadata.isSymbolicLink(), "Data lock is not a regular file; inspect it manually.");
    const contents = await readFile(lockPath, "utf8");
    if (contents === "" && Date.now() - metadata.mtimeMs < 5000) {
      throw Object.assign(new Error("Writer lock is being initialized."), { code: "EBUSY" });
    }
    ensure(/^[1-9]\d*$/.test(contents) && Number.isSafeInteger(Number(contents)), "Data lock has no valid owner PID; inspect it manually.");
    const owner = Number(contents);
    try {
      process.kill(owner, 0);
      throw Object.assign(new Error(`Writer PID ${owner} is currently updating Product Scout data.`), { code: "EBUSY" });
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
    await unlink(lockPath);
    return await create();
  } finally {
    await recovery.close();
    await unlink(recoveryPath);
  }
}

async function waitForWriter(lockPath) {
  const deadline = Date.now() + 5000;
  for (;;) {
    try { return await acquireWriterLock(lockPath); }
    catch (error) {
      if (!["EEXIST", "ENOENT", "EBUSY"].includes(error.code) || Date.now() >= deadline) {
        throw new Error(`Cannot acquire Product Scout data lock at ${lockPath}. ${error.message}`, { cause: error });
      }
      await delay(25);
    }
  }
}

export async function openStore({ root, dataDir, now = () => Date.now() }) {
  let config;
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const lockPath = path.join(dataDir, "writer.lock");
  const leasePath = path.join(dataDir, `runtime-${randomUUID()}.lock`);
  let closed = false;
  let closePromise;
  const file = path.join(dataDir, "state.json");
  let state = { schemaVersion: "1.0", pipelineVersion: VERSION, revision: 0, snapshots: {}, previous: {}, reviews: [] };
  let previews = new Map();
  let queue = Promise.resolve();
  async function checkDeployment() {
    let deploying;
    try { deploying = await lstat(path.join(root, ".ps/deploy.lock")); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    ensure(!deploying, "Product Scout component deployment is active. Retry after it completes.");
  }

  function loadState() {
    let state = { schemaVersion: "1.0", pipelineVersion: VERSION, revision: 0, snapshots: {}, previous: {}, reviews: [] };
    const previews = new Map();
    let saved;
    try { saved = readFileSync(file, "utf8"); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    if (saved !== undefined) {
      state = JSON.parse(saved);
      ensure(state.schemaVersion === "1.0" && state.pipelineVersion === VERSION && Number.isSafeInteger(state.revision) && state.revision >= 0, "Invalid saved state version/revision.");
      ensure(state.snapshots && state.previous && Array.isArray(state.reviews), "Invalid saved state.");
      for (const [productId, snapshot] of Object.entries(state.snapshots)) {
        const product = config.products.find((item) => item.id === productId);
        ensure(product, `Saved product ${productId} is not configured. Export or migrate its state before removing it.`);
        validateSnapshot(snapshot, product, { now: now(), allowFixture: true });
      }
      for (const [productId, snapshot] of Object.entries(state.previous)) {
        const product = config.products.find((item) => item.id === productId);
        ensure(product, `Previous product ${productId} is not configured.`);
        validateSnapshot(snapshot, product, { now: now(), allowFixture: true });
      }
      if (state.fixturePreviews !== undefined) {
        ensure(state.fixturePreviews && typeof state.fixturePreviews === "object" && !Array.isArray(state.fixturePreviews), "Invalid saved fixture previews.");
        for (const [productId, preview] of Object.entries(state.fixturePreviews)) {
          const product = config.products.find((item) => item.id === productId);
          ensure(product && state.snapshots[productId]?.mode === "fixture", "Saved fixture preview requires a configured fixture snapshot.");
          validatePreview(preview, product, { now: now() });
        }
      }
      const reviewIds = new Set();
      for (const review of state.reviews) {
        ensure(review && typeof review.id === "string" && !reviewIds.has(review.id) && config.products.some((product) => product.id === review.productId) && ["approved", "rejected"].includes(review.decision) && typeof review.reviewer === "string" && review.reviewer.trim() && Number.isFinite(Date.parse(review.reviewedAt)) && typeof review.note === "string" && typeof review.candidate?.title === "string" && Array.isArray(review.candidate?.evidence), "Invalid saved review.");
        reviewIds.add(review.id);
      }
    }
    for (const product of config.products) {
      if (!state.snapshots[product.id] || (product.repositories.length && state.snapshots[product.id].mode === "fixture")) {
        const unavailable = () => ({
            schemaVersion: "1.0", pipelineVersion: VERSION, productId: product.id,
            source: "github-issues", mode: "live", fetchedAt: new Date(now()).toISOString(),
            coverage: { status: "unavailable", note: product.repositories.length ? "No live snapshot has been retrieved yet." : "Configure repository bindings before requesting live GitHub data.", repositories: [] }, issues: [],
          });
        if (product.repositories.length) {
          state.snapshots[product.id] = unavailable();
          delete state.previous[product.id];
          if (state.fixturePreviews) delete state.fixturePreviews[product.id];
        } else {
          try {
            state.snapshots[product.id] = validateSnapshot(readJson(path.join(root, "skills/ps/fixtures", `${product.id}.json`)), product, { now: now(), allowFixture: true });
          } catch (error) {
            if (error.cause?.code !== "ENOENT") throw error;
            state.snapshots[product.id] = unavailable();
          }
        }
      }
      if (!product.repositories.length && state.snapshots[product.id].mode === "fixture") {
        try {
          const preview = state.fixturePreviews?.[product.id]
            ?? readJson(path.join(root, "skills/ps/fixtures", `${product.id}.preview.json`));
          previews.set(product.id, validatePreview(preview, product, { now: now() }));
        } catch (error) {
          if (error.cause?.code !== "ENOENT") throw error;
          // Custom fixture products may have no optional source preview.
        }
      }
    }
    return { state, previews };
  }

  function reload() {
    ({ state, previews } = loadState());
  }

  const startupLock = await waitForWriter(lockPath);
  try {
    await checkDeployment();
    config = validateConfig(readJson(path.join(root, "skills/ps/config/products.json")));
    reload();
    const lease = await open(leasePath, "wx", 0o600);
    try { await lease.writeFile(String(process.pid)); }
    catch (error) { await unlink(leasePath); throw error; }
    finally { await lease.close(); }
  } finally {
    await startupLock.close();
    await unlink(lockPath);
  }

  function productFor(id) {
    const product = config.products.find((item) => item.id === id);
    ensure(product, "Unknown product.");
    return product;
  }

  async function persist(next) {
    const temporary = path.join(dataDir, `state-${randomUUID()}.tmp`);
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(next, null, 2)}\n`);
      await handle.sync();
    } catch (error) {
      await handle.close();
      await unlink(temporary);
      throw error;
    }
    await handle.close();
    try { await rename(temporary, file); }
    catch (error) { await unlink(temporary); throw error; }
    state = next;
  }

  function transaction(action) {
    if (closed) return Promise.reject(new Error("Product Scout store is closed."));
    const operation = queue.then(async () => {
      const lock = await waitForWriter(lockPath);
      try {
        await checkDeployment();
        reload();
        return await action();
      } finally {
        await lock.close();
        await unlink(lockPath);
      }
    });
    // Callers receive the rejection; subsequent transactions must still be able to run.
    queue = operation.catch(() => {});
    return operation;
  }

  const service = {
    refreshFixtures(productId) {
      return transaction(async () => {
        const products = productId === undefined ? config.products : [productFor(productId)];
        const time = now();
        ensure(Number.isFinite(time) && Number.isFinite(new Date(time).getTime()), "Invalid refresh time.");
        const next = structuredClone(state);
        const updatedPreviews = new Map();
        const results = products.map((product) => {
          const existing = state.snapshots[product.id];
          if (product.repositories.length || existing.mode !== "fixture") {
            return { productId: product.id, status: "skipped", reason: product.repositories.length ? "live-refresh-disabled" : "no-fixture" };
          }
          const snapshot = validateSnapshot(redateFixture(existing, time), product, { now: time, allowFixture: true });
          const preview = previews.get(product.id);
          if (preview) {
            const refreshed = validatePreview(redateFixture(preview, time), product, { now: time });
            updatedPreviews.set(product.id, refreshed);
            next.fixturePreviews ??= {};
            next.fixturePreviews[product.id] = refreshed;
          }
          const changed = JSON.stringify(snapshot) !== JSON.stringify(existing)
            || (preview !== undefined && JSON.stringify(updatedPreviews.get(product.id)) !== JSON.stringify(preview));
          if (changed) {
            next.snapshots[product.id] = snapshot;
            // Re-dating a demo is not a new source observation or a comparison baseline.
            delete next.previous[product.id];
          }
          return { productId: product.id, status: changed ? "refreshed" : "unchanged", reason: "fixture-dates" };
        });
        const changed = results.some((result) => result.status === "refreshed");
        const eligible = results.some((result) => result.status !== "skipped");
        if (changed) {
          next.revision += 1;
          await persist(next);
          for (const [id, preview] of updatedPreviews) previews.set(id, preview);
        }
        return {
          productId: productId ?? null,
          status: changed ? "refreshed" : eligible ? "unchanged" : "skipped",
          reason: eligible ? "fixture-dates" : "no-fixture-products",
          changed, refreshedAt: eligible ? new Date(time).toISOString() : null,
          revision: state.revision, products: results,
        };
      });
    },
    getState() {
      ensure(!closed, "Product Scout store is closed.");
      reload();
      return structuredClone({
        schemaVersion: "1.0", pipelineVersion: VERSION, version: VERSION, revision: state.revision, roles: ROLES,
        products: config.products.map((product) => {
          const snapshot = state.snapshots[product.id];
          const reviews = state.reviews.filter((review) => review.productId === product.id);
          return {
            ...product, snapshot, assessment: assess(product, snapshot, now()),
            candidates: correlate(product, snapshot).map((candidate) => ({
              ...candidate, review: reviews.find((review) => review.candidate.id === candidate.id) ?? null,
            })),
            timeline: reviews.filter((review) => review.decision === "approved").sort((a, b) => b.reviewedAt.localeCompare(a.reviewedAt)),
            changes: changesSince(state.previous[product.id], snapshot),
            previewSources: snapshot.mode === "fixture" && !product.repositories.length && previews.has(product.id)
              ? summarizePreview(previews.get(product.id), { now: now(), maxAgeHours: product.rules.maxAgeHours })
              : null,
          };
        }),
      });
    },
    ingestSnapshot(snapshot) {
      return transaction(async () => {
        const product = productFor(snapshot?.productId);
        validateSnapshot(snapshot, product, { now: now() });
        const existing = state.snapshots[product.id];
        ensure(existing.mode !== "live" || Date.parse(snapshot.fetchedAt) >= Date.parse(existing.fetchedAt), "Cannot replace a newer snapshot with an older one.");
        const next = structuredClone(state);
        if (existing.mode === snapshot.mode) next.previous[product.id] = existing;
        else delete next.previous[product.id];
        next.snapshots[product.id] = structuredClone(snapshot);
        if (next.fixturePreviews) delete next.fixturePreviews[product.id];
        next.revision += 1;
        await persist(next);
        return { productId: product.id, revision: state.revision, coverage: snapshot.coverage };
      });
    },
    review({ productId, candidateId, evidenceHash, decision, reviewer, note = "" }) {
      return transaction(async () => {
        const product = productFor(productId);
        const snapshot = state.snapshots[productId];
        const candidate = correlate(product, snapshot).find((item) => item.id === candidateId);
        ensure(candidate && candidate.evidenceHash === evidenceHash, "Evidence changed. Reopen and review the current insight.");
        ensure(!assess(product, snapshot, now()).stale && snapshot.coverage.status === "complete", "Refresh incomplete or stale evidence before recording a decision.");
        ensure(["approved", "rejected"].includes(decision), "Choose approve or reject.");
        ensure(typeof reviewer === "string" && reviewer.trim().length >= 2 && reviewer.length <= 120, "Provide a reviewer name or team (2–120 characters).");
        ensure(typeof note === "string" && note.length <= 2000, "Decision note must be text (max 2000 characters).");
        const existing = state.reviews.find((item) => item.productId === productId && item.candidate.id === candidateId);
        ensure(!existing, "This exact insight has already been reviewed.");
        const review = { id: randomUUID(), productId, decision, reviewer: reviewer.trim(), note: note.trim(), reviewedAt: new Date(now()).toISOString(), classification: "Human-reviewed insight", candidate: structuredClone(candidate) };
        const next = structuredClone(state);
        next.reviews.push(review);
        next.revision += 1;
        await persist(next);
        return structuredClone(review);
      });
    },
    prompt({ productId, ...request }) {
      ensure(!closed, "Product Scout store is closed.");
      reload();
      const product = productFor(productId);
      const snapshot = state.snapshots[productId];
      return investigationPrompt(product, snapshot, request, correlate(product, snapshot));
    },
    close() {
      closed = true;
      closePromise ??= queue.then(() => unlink(leasePath));
      return closePromise;
    },
  };
  return service;
}
