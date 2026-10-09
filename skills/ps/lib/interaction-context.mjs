const TTL_MS = 120_000;
const MAX_DOCUMENTS = 8;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PREVIEWS = {
  stories: ["confluence", "Confluence"],
  adoption: ["application-insights", "Application Insights"],
  appMonitoring: ["application-insights", "Application Insights"],
  support: ["zendesk", "Zendesk"],
  business: ["power-bi", "Power BI"],
};
const VIEWS = new Set(["products", "overview", "issues", "timeline", ...Object.keys(PREVIEWS)]);

function ensure(condition, message) {
  if (!condition) throw new Error(message);
}

function exact(value, keys, name) {
  ensure(value !== null && typeof value === "object" && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value)), `${name} must be an object.`);
  const own = Reflect.ownKeys(value);
  ensure(own.length === keys.length && keys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor?.enumerable && Object.hasOwn(descriptor, "value");
  }), `${name} must contain exactly: ${keys.join(", ")}.`);
}

function nonempty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validateInput(input) {
  exact(input, ["viewId", "sequence", "revision", "context"], "Interaction update");
  ensure(typeof input.viewId === "string" && UUID.test(input.viewId), "viewId must be a UUID string.");
  ensure(Number.isSafeInteger(input.sequence) && input.sequence > 0, "sequence must be a positive safe integer.");
  ensure(Number.isSafeInteger(input.revision) && input.revision >= 0, "revision must be a nonnegative safe integer.");
  if (input.context === null) return;
  const context = input.context;
  exact(context, ["productId", "view", "role", "finding", "selectedText", "selectionTruncated"], "context");
  ensure(VIEWS.has(context.view), "Invalid context view.");
  ensure(context.view === "products" ? context.productId === null : nonempty(context.productId),
    "productId must be null for products and a product ID for other views.");
  ensure(nonempty(context.role), "role must be a nonempty string.");
  ensure(typeof context.selectedText === "string" && context.selectedText.length <= 2000,
    "selectedText must be text of at most 2000 characters.");
  ensure(typeof context.selectionTruncated === "boolean", "selectionTruncated must be a boolean.");
  if (context.finding !== null) {
    exact(context.finding, ["kind", "id"], "finding");
    ensure(["issue", "candidate", "review"].includes(context.finding.kind), "Invalid finding kind.");
    ensure(nonempty(context.finding.id), "finding.id must be a nonempty string.");
    ensure(context.finding.kind === "review" ? context.view === "timeline"
      : ["overview", "issues"].includes(context.view), "Finding kind is not allowed in this view.");
  }
}

function validState(state) {
  ensure(state && Number.isSafeInteger(state.revision) && state.revision >= 0
    && Array.isArray(state.roles) && Array.isArray(state.products), "Current runtime state is unavailable.");
}

function previewAvailable(product, view) {
  return product.snapshot?.mode === "fixture" && product.repositories?.length === 0
    && product.previewSources?.mode === "fixture"
    && product.previewSources[view] !== null && typeof product.previewSources[view] === "object";
}

function snapshotMetadata(data, product, time, view, source, label, fallbackStale) {
  ensure(data && ["fixture", "live"].includes(data.mode) && typeof data.fetchedAt === "string"
    && Number.isFinite(Date.parse(data.fetchedAt)), "Source provenance is unavailable or invalid.");
  const metadata = { view, source, label, mode: data.mode, fetchedAt: data.fetchedAt };
  const maxAgeHours = product.rules?.maxAgeHours;
  if (Number.isFinite(maxAgeHours) && maxAgeHours > 0) {
    metadata.stale = time - Date.parse(data.fetchedAt) > maxAgeHours * 3_600_000;
  } else if (typeof data.stale === "boolean") {
    metadata.stale = data.stale;
  } else if (typeof fallbackStale === "boolean") {
    metadata.stale = fallbackStale;
  }
  if (data.coverage !== undefined) metadata.coverage = structuredClone(data.coverage);
  return metadata;
}

function issueMetadata(data, product, time, historical = false) {
  return snapshotMetadata(data, product, time, historical ? "timeline" : "issues",
    "github-issues", "GitHub Issues", historical ? undefined : product.assessment?.stale);
}

function candidateFinding(candidate, reference, product) {
  ensure(candidate && nonempty(candidate.id) && nonempty(candidate.title)
    && (candidate.productId === undefined || candidate.productId === product.id)
    && Array.isArray(candidate.evidence) && candidate.evidence.every((item) => nonempty(item?.id)),
  "Candidate is unavailable or invalid for this product.");
  return { kind: reference.kind, id: reference.id, title: candidate.title,
    evidenceIds: candidate.evidence.map((item) => item.id) };
}

function resolve(context, state, time) {
  ensure(state.roles.includes(context.role), "Role is no longer available.");
  if (context.view === "products") return { productName: null, finding: null, snapshots: [] };
  const product = state.products.find((item) => item.id === context.productId);
  ensure(product && nonempty(product.name), "Product is unavailable.");
  ensure(!product.snapshot || product.snapshot.productId === product.id, "Snapshot belongs to another product.");
  const reference = context.finding;
  let finding = null;
  let snapshots = [];
  if (reference?.kind === "issue") {
    const issue = product.snapshot?.issues?.find((item) => item.id === reference.id);
    ensure(issue && nonempty(issue.title), "Issue is unavailable for this product.");
    finding = { kind: "issue", id: issue.id, title: issue.title, evidenceIds: [issue.id] };
    snapshots = [issueMetadata(product.snapshot, product, time)];
  } else if (reference?.kind === "candidate") {
    const candidate = product.candidates?.find((item) => item.id === reference.id);
    finding = candidateFinding(candidate, reference, product);
    snapshots = [issueMetadata(candidate, product, time)];
  } else if (reference?.kind === "review") {
    const review = product.timeline?.find((item) => item.id === reference.id);
    ensure(review && review.productId === product.id && review.decision === "approved",
      "Review is unavailable for this product.");
    finding = candidateFinding(review.candidate, reference, product);
    // Archived evidence retains its own timestamps and mode, even after a live refresh.
    snapshots = [issueMetadata(review.candidate, product, time, true)];
  } else if (Object.hasOwn(PREVIEWS, context.view)) {
    ensure(previewAvailable(product, context.view), "Preview source is unavailable for this product.");
    snapshots = [snapshotMetadata(product.previewSources, product, time, context.view, ...PREVIEWS[context.view])];
  } else if (context.view === "timeline") {
    for (const review of product.timeline ?? []) {
      ensure(review.productId === product.id && review.decision === "approved",
        "Review is unavailable for this product.");
      candidateFinding(review.candidate, { kind: "review", id: review.id }, product);
      const metadata = issueMetadata(review.candidate, product, time, true);
      if (!snapshots.some((item) => JSON.stringify(item) === JSON.stringify(metadata))) snapshots.push(metadata);
    }
  } else {
    if (product.snapshot) snapshots.push(issueMetadata(product.snapshot, product, time));
    else ensure(context.view === "overview", "Issues source is unavailable for this product.");
    if (context.view === "overview") {
      for (const view of Object.keys(PREVIEWS)) {
        if (previewAvailable(product, view)) {
          snapshots.push(snapshotMetadata(product.previewSources, product, time, view, ...PREVIEWS[view]));
        }
      }
    }
  }
  return { productName: product.name, finding, snapshots };
}

/**
 * Session-local document leases only. selectedText is untrusted browser text,
 * never an instruction, verified evidence, a source query or a review decision.
 * Equal/lower sequences cannot renew a lease; closes retain their high-water mark.
 */
export function createInteractionContext({ getState, now = Date.now }) {
  ensure(typeof getState === "function", "getState must be a function.");
  ensure(typeof now === "function", "now must be a function.");
  const documents = new Map();
  function prune(time) {
    for (const [id, document] of documents) {
      if (time - document.updatedAt >= TTL_MS) documents.delete(id);
    }
  }
  function result(status, reason) {
    return { schemaVersion: "1.0", status, context: null, reason };
  }
  return {
    update(input) {
      validateInput(input);
      const time = now();
      prune(time);
      const id = input.viewId.toLowerCase();
      const previous = documents.get(id);
      if (previous && input.sequence <= previous.sequence) return { accepted: false, reason: "superseded" };
      const state = getState();
      validState(state);
      ensure(input.revision === state.revision, "State revision changed; refresh the document before updating context.");
      if (input.context !== null) resolve(input.context, state, time);
      ensure(previous || documents.size < MAX_DOCUMENTS, "Interaction context document limit (8) reached.");
      const context = input.context === null ? null : {
        productId: input.context.productId, view: input.context.view, role: input.context.role,
        finding: input.context.finding === null ? null : {
          kind: input.context.finding.kind, id: input.context.finding.id,
        },
        selectedText: input.context.selectedText, selectionTruncated: input.context.selectionTruncated,
      };
      const unchanged = previous && JSON.stringify(previous.context) === JSON.stringify(context);
      documents.set(id, {
        sequence: input.sequence, revision: input.revision, context, updatedAt: time,
        capturedAt: unchanged ? previous.capturedAt : new Date(time).toISOString(),
      });
      return { accepted: true };
    },
    read() {
      const time = now();
      prune(time);
      const active = [...documents.values()].filter((document) => document.context !== null);
      if (!active.length) return result("unavailable", "No active document context.");
      if (active.length > 1) return result("ambiguous", "Multiple active document contexts.");
      const document = active[0];
      const state = getState();
      try {
        validState(state);
        ensure(document.revision === state.revision, "State revision changed; refresh the document context.");
        const enriched = resolve(document.context, state, time);
        return {
          schemaVersion: "1.0", status: "available",
          context: structuredClone({
            ...document.context, ...enriched, revision: document.revision, capturedAt: document.capturedAt,
          }),
        };
      } catch (error) {
        return result("outdated", error.message);
      }
    },
    clear() {
      documents.clear();
    },
  };
}
