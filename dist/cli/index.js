// src/lib/core/engine.ts
import { watch } from "fs";
import { sep as sep4 } from "path";

// src/lib/core/pricing/cost.ts
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// src/lib/core/pricing/overrides.ts
var OPUS = {
  input_cost_per_token: 5e-6,
  output_cost_per_token: 25e-6,
  cache_creation_input_token_cost: 625e-8,
  cache_creation_input_token_cost_above_1hr: 1e-5,
  cache_read_input_token_cost: 5e-7
};
var SONNET = {
  input_cost_per_token: 3e-6,
  output_cost_per_token: 15e-6,
  cache_creation_input_token_cost: 375e-8,
  cache_creation_input_token_cost_above_1hr: 6e-6,
  cache_read_input_token_cost: 3e-7
};
var HAIKU = {
  input_cost_per_token: 1e-6,
  output_cost_per_token: 5e-6,
  cache_creation_input_token_cost: 125e-8,
  cache_creation_input_token_cost_above_1hr: 2e-6,
  cache_read_input_token_cost: 1e-7
};
var PRICE_OVERRIDES = {
  "claude-opus-4-6": OPUS,
  "claude-opus-4-7": OPUS,
  "claude-opus-4-8": OPUS,
  "claude-sonnet-4-6": SONNET,
  "claude-haiku-4-5-20251001": HAIKU,
  "claude-haiku-4-5": HAIKU
};

// src/lib/core/pricing/cost.ts
var snapshot = null;
var snapshotMeta = {};
function loadSnapshot() {
  if (snapshot) return snapshot;
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    // dev (src tree) — static/ is the project root
    join(here, "../../../../static/pricing/litellm-prices.json"),
    join(process.cwd(), "static/pricing/litellm-prices.json"),
    // adapter-node build — static assets land in build/client/
    join(process.cwd(), "build/client/pricing/litellm-prices.json"),
    join(here, "../../client/pricing/litellm-prices.json"),
    join(here, "../client/pricing/litellm-prices.json")
  ];
  for (const path of candidates) {
    try {
      const raw = readFileSync(path, "utf8");
      const parsed = JSON.parse(raw);
      snapshot = parsed;
      snapshotMeta = parsed._meta ?? {};
      return snapshot;
    } catch {
    }
  }
  snapshot = { prices: {} };
  return snapshot;
}
function getPricingMeta() {
  loadSnapshot();
  return {
    snapshotDate: snapshotMeta?.snapshot_date ?? null,
    source: snapshotMeta?.source ?? null
  };
}
var priceCache = /* @__PURE__ */ new Map();
function resolvePrice(model) {
  if (priceCache.has(model)) return priceCache.get(model) ?? null;
  const resolved = resolveUncached(model);
  priceCache.set(model, resolved);
  return resolved;
}
function asEntry(p) {
  if (!p) return null;
  if (p.input_cost_per_token == null || p.output_cost_per_token == null) return null;
  return {
    input_cost_per_token: p.input_cost_per_token,
    output_cost_per_token: p.output_cost_per_token,
    cache_creation_input_token_cost: p.cache_creation_input_token_cost ?? 0,
    cache_creation_input_token_cost_above_1hr: p.cache_creation_input_token_cost_above_1hr,
    cache_read_input_token_cost: p.cache_read_input_token_cost ?? 0
  };
}
function resolveUncached(model) {
  if (PRICE_OVERRIDES[model]) return PRICE_OVERRIDES[model];
  const snap = loadSnapshot();
  const exact = asEntry(snap.prices[model]);
  if (exact) return exact;
  const candidates = [
    `anthropic.${model}`,
    `anthropic.${model}-v1:0`,
    `anthropic.${model}-v1`,
    `us.anthropic.${model}`,
    `us.anthropic.${model}-v1:0`,
    `azure_ai/${model}`,
    `claude-${model}`
    // defensive
  ];
  for (const c of candidates) {
    const e = asEntry(snap.prices[c]);
    if (e) return e;
  }
  if (/opus/i.test(model) && PRICE_OVERRIDES["claude-opus-4-8"]) {
    return PRICE_OVERRIDES["claude-opus-4-8"];
  }
  if (/sonnet/i.test(model) && PRICE_OVERRIDES["claude-sonnet-4-6"]) {
    return PRICE_OVERRIDES["claude-sonnet-4-6"];
  }
  if (/haiku/i.test(model) && PRICE_OVERRIDES["claude-haiku-4-5"]) {
    return PRICE_OVERRIDES["claude-haiku-4-5"];
  }
  return null;
}
function computeCost(model, tokens, cacheCreation1h = 0, cacheCreation5m = 0) {
  const price = resolvePrice(model);
  if (!price) return null;
  let cacheCreationCost;
  const oneHrRate = price.cache_creation_input_token_cost_above_1hr;
  if (oneHrRate != null && (cacheCreation1h > 0 || cacheCreation5m > 0)) {
    cacheCreationCost = cacheCreation1h * oneHrRate + cacheCreation5m * price.cache_creation_input_token_cost;
    const accounted = cacheCreation1h + cacheCreation5m;
    const remainder = tokens.cacheCreation - accounted;
    if (remainder > 0) cacheCreationCost += remainder * price.cache_creation_input_token_cost;
  } else {
    cacheCreationCost = tokens.cacheCreation * price.cache_creation_input_token_cost;
  }
  return tokens.input * price.input_cost_per_token + tokens.output * price.output_cost_per_token + cacheCreationCost + tokens.cacheRead * price.cache_read_input_token_cost;
}
function hasPrice(model) {
  return resolvePrice(model) !== null;
}

// src/lib/core/rollup/blocks.ts
var FIVE_HOURS_MS = 5 * 60 * 60 * 1e3;
function zeroTokens() {
  return { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };
}
function addTokens(into, from) {
  into.input += from.input;
  into.output += from.output;
  into.cacheCreation += from.cacheCreation;
  into.cacheRead += from.cacheRead;
}
var BlockAccumulator = class {
  blocks = /* @__PURE__ */ new Map();
  add(rec) {
    const start = Math.floor(rec.timestamp / FIVE_HOURS_MS) * FIVE_HOURS_MS;
    let b = this.blocks.get(start);
    if (!b) {
      b = {
        startTs: start,
        endTs: start + FIVE_HOURS_MS,
        tokens: zeroTokens(),
        requests: 0,
        cost: 0,
        isActive: false
      };
      this.blocks.set(start, b);
    }
    addTokens(b.tokens, rec.tokens);
    b.requests++;
    b.cost += rec.cost ?? 0;
  }
  snapshot(now) {
    return [...this.blocks.values()].map((b) => ({ ...b, tokens: { ...b.tokens }, isActive: now < b.endTs })).sort((a, b) => b.startTs - a.startTs);
  }
};

// src/lib/core/rollup/rollup.ts
var KEY_SEP = "";
function zeroTokens2() {
  return { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };
}
function addTokens2(into, from) {
  into.input += from.input;
  into.output += from.output;
  into.cacheCreation += from.cacheCreation;
  into.cacheRead += from.cacheRead;
}
var Rollup = class {
  /** key: `${day}\u001f${provider}\u001f${model}` */
  dayModel = /* @__PURE__ */ new Map();
  sessions = /* @__PURE__ */ new Map();
  modelCost = /* @__PURE__ */ new Map();
  providerCost = /* @__PURE__ */ new Map();
  unknownPriceModels = /* @__PURE__ */ new Set();
  totalTokens = zeroTokens2();
  totalRequests = 0;
  totalCost = 0;
  totalCostUnknown = 0;
  earliestDay = null;
  latestDay = null;
  filesScanned = 0;
  linesSkipped = 0;
  duplicatesSkipped = 0;
  recordsCounted = 0;
  cutoverTs = null;
  dirtyDayModel = /* @__PURE__ */ new Set();
  dirtySessions = /* @__PURE__ */ new Set();
  dirtyAny = false;
  setCutover(ts) {
    this.cutoverTs = ts;
  }
  markFileScanned() {
    this.filesScanned++;
  }
  addSkipped(n = 1) {
    this.linesSkipped += n;
  }
  addDuplicate(n = 1) {
    this.duplicatesSkipped += n;
  }
  /** Add a single already-deduped usage record to the rollup. */
  add(rec) {
    this.recordsCounted++;
    this.dirtyAny = true;
    const cost = rec.cost ?? 0;
    const unknown = rec.cost == null ? 1 : 0;
    if (rec.cost == null && !hasPrice(rec.model)) {
      this.unknownPriceModels.add(rec.model);
    }
    const dmKey = recordKey(rec.day, rec.provider, rec.model);
    let dm = this.dayModel.get(dmKey);
    if (!dm) {
      dm = {
        day: rec.day,
        provider: rec.provider,
        model: rec.model,
        tokens: zeroTokens2(),
        requests: 0,
        cost: 0,
        costUnknownRequests: 0
      };
      this.dayModel.set(dmKey, dm);
    }
    addTokens2(dm.tokens, rec.tokens);
    dm.requests++;
    dm.cost += cost;
    dm.costUnknownRequests += unknown;
    this.dirtyDayModel.add(dmKey);
    const recSessionKey = sessionKey(rec.provider, rec.sessionId);
    let s = this.sessions.get(recSessionKey);
    if (!s) {
      s = {
        sessionId: rec.sessionId,
        provider: rec.provider,
        project: rec.project,
        firstTs: rec.timestamp,
        lastTs: rec.timestamp,
        tokens: zeroTokens2(),
        requests: 0,
        cost: 0,
        costUnknownRequests: 0,
        modelCounts: /* @__PURE__ */ new Map()
      };
      this.sessions.set(recSessionKey, s);
    }
    addTokens2(s.tokens, rec.tokens);
    s.requests++;
    s.cost += cost;
    s.costUnknownRequests += unknown;
    s.firstTs = Math.min(s.firstTs, rec.timestamp);
    s.lastTs = Math.max(s.lastTs, rec.timestamp);
    s.modelCounts.set(rec.model, (s.modelCounts.get(rec.model) ?? 0) + 1);
    this.dirtySessions.add(recSessionKey);
    addTokens2(this.totalTokens, rec.tokens);
    this.totalRequests++;
    this.totalCost += cost;
    this.totalCostUnknown += unknown;
    this.modelCost.set(rec.model, (this.modelCost.get(rec.model) ?? 0) + cost);
    this.providerCost.set(rec.provider, (this.providerCost.get(rec.provider) ?? 0) + cost);
    this.blockAccumulator.add(rec);
    if (this.earliestDay == null || rec.day < this.earliestDay) this.earliestDay = rec.day;
    if (this.latestDay == null || rec.day > this.latestDay) this.latestDay = rec.day;
  }
  modelsByCost() {
    return [...this.modelCost.entries()].sort((a, b) => b[1] - a[1]).map(([m]) => m);
  }
  providersByCost() {
    return [...this.providerCost.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p);
  }
  sessionSummary(s) {
    const models = [...s.modelCounts.entries()].sort((a, b) => b[1] - a[1]).map(([m]) => m);
    return {
      sessionId: s.sessionId,
      provider: s.provider,
      project: s.project,
      firstTs: s.firstTs,
      lastTs: s.lastTs,
      tokens: { ...s.tokens },
      requests: s.requests,
      cost: s.cost,
      costUnknownRequests: s.costUnknownRequests,
      models
    };
  }
  blockAccumulator = new BlockAccumulator();
  /** Rolling 5-hour blocks (ccusage window model), newest first. */
  computeBlocks(now = Date.now()) {
    return this.blockAccumulator.snapshot(now);
  }
  snapshot(now = Date.now()) {
    const meta = getPricingMeta();
    void meta;
    return {
      generatedAt: now,
      earliestDay: this.earliestDay,
      latestDay: this.latestDay,
      totals: {
        tokens: { ...this.totalTokens },
        requests: this.totalRequests,
        cost: this.totalCost,
        costUnknownRequests: this.totalCostUnknown
      },
      dayModel: [...this.dayModel.values()].map((d) => ({ ...d, tokens: { ...d.tokens } })),
      sessions: [...this.sessions.values()].map((s) => this.sessionSummary(s)).sort((a, b) => b.lastTs - a.lastTs),
      blocks: this.blockAccumulator.snapshot(now),
      models: this.modelsByCost(),
      providers: this.providersByCost(),
      unknownPriceModels: [...this.unknownPriceModels],
      stats: {
        filesScanned: this.filesScanned,
        recordsCounted: this.recordsCounted,
        linesSkipped: this.linesSkipped,
        duplicatesSkipped: this.duplicatesSkipped
      },
      cutoverTs: this.cutoverTs
    };
  }
  hasDirty() {
    return this.dirtyAny;
  }
  /** Drain accumulated changes into a delta and reset the dirty sets. */
  drainDelta(now = Date.now()) {
    if (!this.dirtyAny) return null;
    const dayModel = [];
    for (const k of this.dirtyDayModel) {
      const dm = this.dayModel.get(k);
      if (dm) dayModel.push({ ...dm, tokens: { ...dm.tokens } });
    }
    const sessions = [];
    for (const id of this.dirtySessions) {
      const s = this.sessions.get(id);
      if (s) sessions.push(this.sessionSummary(s));
    }
    this.dirtyDayModel.clear();
    this.dirtySessions.clear();
    this.dirtyAny = false;
    return {
      generatedAt: now,
      dayModel,
      sessions,
      blocks: this.blockAccumulator.snapshot(now),
      totals: {
        tokens: { ...this.totalTokens },
        requests: this.totalRequests,
        cost: this.totalCost,
        costUnknownRequests: this.totalCostUnknown
      },
      earliestDay: this.earliestDay,
      latestDay: this.latestDay,
      models: this.modelsByCost(),
      providers: this.providersByCost(),
      unknownPriceModels: [...this.unknownPriceModels],
      stats: {
        filesScanned: this.filesScanned,
        recordsCounted: this.recordsCounted,
        linesSkipped: this.linesSkipped,
        duplicatesSkipped: this.duplicatesSkipped
      }
    };
  }
};
function recordKey(day, provider, model) {
  return `${day}${KEY_SEP}${provider}${KEY_SEP}${model}`;
}
function sessionKey(provider, sessionId) {
  return `${provider}${KEY_SEP}${sessionId}`;
}

// src/lib/core/ingest/dedup.ts
var nullCounter = 0;
function makeKey(messageId, requestId) {
  if (messageId == null || requestId == null) {
    return `__nokey__:${nullCounter++}`;
  }
  return `${messageId}:${requestId}`;
}
function isNoKey(key) {
  return key.startsWith("__nokey__:");
}
var DedupSet = class {
  seen = /* @__PURE__ */ new Set();
  /** Returns true if this is the FIRST time we've seen the key (i.e. count it). */
  add(key) {
    if (isNoKey(key)) return true;
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    return true;
  }
  has(key) {
    return !isNoKey(key) && this.seen.has(key);
  }
  get size() {
    return this.seen.size;
  }
};

// src/lib/core/ingest/discover.ts
import { homedir } from "os";
import { join as join2, sep, basename } from "path";
import { readdir, stat } from "fs/promises";
function resolveRoots(env = process.env) {
  const override = env.CLAUDE_CONFIG_DIR?.trim();
  if (override) {
    return override.split(",").map((p) => p.trim()).filter(Boolean);
  }
  const home = homedir();
  return [join2(home, ".config", "claude"), join2(home, ".claude")];
}
async function isDir(p) {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}
function decodeProject(encoded) {
  if (!encoded.startsWith("-")) return encoded;
  return "/" + encoded.slice(1).split("-").join("/");
}
async function walkJsonl(dir, out) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join2(dir, entry.name);
    if (entry.isDirectory()) {
      await walkJsonl(full, out);
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      out.push(full);
    }
  }
}
async function discoverFiles(env = process.env) {
  const roots = resolveRoots(env);
  const result = [];
  const seen = /* @__PURE__ */ new Set();
  for (const root of roots) {
    const projectsDir = join2(root, "projects");
    if (!await isDir(projectsDir)) continue;
    const files = [];
    await walkJsonl(projectsDir, files);
    for (const path of files) {
      if (seen.has(path)) continue;
      seen.add(path);
      result.push({
        path,
        project: projectForFile(projectsDir, path),
        // subagent files live under .../<session>/subagents/agent-*.jsonl
        isSidechain: path.includes(`${sep}subagents${sep}`) || basename(path).startsWith("agent-")
      });
    }
  }
  return result;
}
async function resolveProjectsDirs(env = process.env) {
  const dirs = [];
  for (const root of resolveRoots(env)) {
    const projectsDir = join2(root, "projects");
    if (await isDir(projectsDir)) dirs.push(projectsDir);
  }
  return dirs;
}
function projectForFile(projectsDir, filePath) {
  const rel = filePath.slice(projectsDir.length + 1);
  const encoded = rel.split(sep)[0] ?? "";
  return decodeProject(encoded);
}

// src/lib/core/watch/tail.ts
import { createReadStream } from "fs";
import { stat as stat2 } from "fs/promises";
import { createInterface } from "readline";
import { basename as basename2, sep as sep2 } from "path";

// src/lib/core/ingest/parse.ts
function num(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}
function parseLine(line, ctx) {
  const trimmed = line.trim();
  if (!trimmed || trimmed[0] !== "{") return null;
  let obj;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (obj.type !== "assistant") return null;
  const msg = obj.message;
  if (!msg || !msg.usage) return null;
  const model = msg.model;
  if (!model || model === "<synthetic>") return null;
  const ts = obj.timestamp ? Date.parse(obj.timestamp) : NaN;
  if (!Number.isFinite(ts)) return null;
  const u = msg.usage;
  const tokens = {
    input: num(u.input_tokens),
    output: num(u.output_tokens),
    cacheCreation: num(u.cache_creation_input_tokens),
    cacheRead: num(u.cache_read_input_tokens)
  };
  if (tokens.input === 0 && tokens.output === 0 && tokens.cacheCreation === 0 && tokens.cacheRead === 0) {
    return null;
  }
  const cacheCreation1h = num(u.cache_creation?.ephemeral_1h_input_tokens);
  const cacheCreation5m = num(u.cache_creation?.ephemeral_5m_input_tokens);
  const cost = computeCost(model, tokens, cacheCreation1h, cacheCreation5m);
  const day = isoDayUTC(ts);
  return {
    key: makeKey(msg.id ?? null, obj.requestId ?? null),
    provider: "claude",
    timestamp: ts,
    day,
    model,
    tokens,
    cacheCreation1h,
    cacheCreation5m,
    webSearchRequests: num(u.server_tool_use?.web_search_requests),
    webFetchRequests: num(u.server_tool_use?.web_fetch_requests),
    sessionId: obj.sessionId ?? "unknown",
    project: ctx.project,
    isSidechain: obj.isSidechain ?? ctx.fileIsSidechain,
    cost
  };
}
function isoDayUTC(epochMs) {
  const d = new Date(epochMs);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// src/lib/core/watch/tail.ts
function projectFor(projectsDir, filePath) {
  if (!filePath.startsWith(projectsDir)) return "unknown";
  const rel = filePath.slice(projectsDir.length + 1);
  const encoded = rel.split(sep2)[0] ?? "";
  return decodeProject(encoded);
}
function isSidechainPath(filePath) {
  return filePath.includes(`${sep2}subagents${sep2}`) || basename2(filePath).startsWith("agent-");
}
async function ingestRange(filePath, startOffset, projectsDir, rollup, dedup) {
  let size;
  try {
    size = (await stat2(filePath)).size;
  } catch {
    return startOffset;
  }
  if (size <= startOffset) {
    return size < startOffset ? await ingestRange(filePath, 0, projectsDir, rollup, dedup) : startOffset;
  }
  const ctx = {
    project: projectFor(projectsDir, filePath),
    fileIsSidechain: isSidechainPath(filePath)
  };
  const stream = createReadStream(filePath, {
    start: startOffset,
    end: size - 1,
    encoding: "utf8",
    highWaterMark: 1 << 20
    // 1 MiB chunks
  });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    const rec = parseLine(line, ctx);
    if (!rec) {
      rollup.addSkipped();
      continue;
    }
    if (!dedup.add(rec.key)) {
      rollup.addDuplicate();
      continue;
    }
    rollup.add(rec);
  }
  return size;
}

// src/lib/core/config.ts
import { homedir as homedir2 } from "os";
import { join as join3 } from "path";
import { chmod, mkdir, readFile, stat as stat3, writeFile } from "fs/promises";
var DEFAULT_HOST = "0.0.0.0";
var DEFAULT_PORT = 5178;
var DEFAULT_CURSOR_POLL_SECONDS = 3600;
var cache = null;
function configFilePath(input = {}) {
  const home = input.homeDir ?? homedir2();
  const env = input.env ?? process.env;
  const configHome = env.XDG_CONFIG_HOME?.trim() || join3(home, ".config");
  return join3(configHome, "chaching", "config.json");
}
function defaultConfig() {
  return {
    cutoverTs: null,
    server: { host: DEFAULT_HOST, port: DEFAULT_PORT },
    providers: {
      claude: { enabled: true, roots: ["~/.claude", "~/.config/claude"] },
      codex: { enabled: true, root: "~/.codex/sessions" },
      cursor: { enabled: false, adminApiToken: "", email: null, pollSeconds: DEFAULT_CURSOR_POLL_SECONDS },
      opencode: { enabled: true, dbPath: "~/.local/share/opencode/opencode.db" }
    }
  };
}
function normalizeConfig(raw) {
  const defaults = defaultConfig();
  const root = objectRecord(raw);
  const providers = objectRecord(root.providers);
  const server = objectRecord(root.server);
  const claude = objectRecord(providers.claude);
  const codex = objectRecord(providers.codex);
  const cursor = objectRecord(providers.cursor);
  const opencode = objectRecord(providers.opencode);
  return {
    cutoverTs: numberOrNull(root.cutoverTs),
    server: {
      host: stringOr(server.host, defaults.server.host),
      port: positiveIntOr(server.port, defaults.server.port)
    },
    providers: {
      claude: {
        enabled: booleanOr(claude.enabled, defaults.providers.claude.enabled),
        roots: stringArrayOr(claude.roots, defaults.providers.claude.roots)
      },
      codex: {
        enabled: booleanOr(codex.enabled, defaults.providers.codex.enabled),
        root: stringOr(codex.root, defaults.providers.codex.root)
      },
      cursor: {
        enabled: booleanOr(cursor.enabled, defaults.providers.cursor.enabled),
        adminApiToken: stringOr(cursor.adminApiToken, defaults.providers.cursor.adminApiToken),
        email: nullableStringOr(cursor.email, defaults.providers.cursor.email),
        pollSeconds: positiveIntOr(cursor.pollSeconds, defaults.providers.cursor.pollSeconds)
      },
      opencode: {
        enabled: booleanOr(opencode.enabled, defaults.providers.opencode.enabled),
        dbPath: stringOr(opencode.dbPath, defaults.providers.opencode.dbPath)
      }
    }
  };
}
async function loadConfig() {
  if (cache) return cache;
  try {
    const raw = await readFile(configFilePath(), "utf8");
    const parsed = JSON.parse(raw);
    cache = normalizeConfig(parsed);
  } catch {
    cache = defaultConfig();
  }
  return cache;
}
function objectRecord(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return value;
}
function stringOr(value, fallback) {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}
function nullableStringOr(value, fallback) {
  if (value === null) return null;
  return typeof value === "string" ? value : fallback;
}
function booleanOr(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}
function numberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function positiveIntOr(value, fallback) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}
function stringArrayOr(value, fallback) {
  if (!Array.isArray(value)) return fallback;
  const strings = value.filter((item) => typeof item === "string" && item.length > 0);
  return strings.length > 0 ? strings : fallback;
}

// src/lib/core/fs-utils.ts
import { stat as stat4 } from "fs/promises";
import { join as join4, sep as sep3 } from "path";
import { homedir as homedir3 } from "os";
async function safeMtime(path) {
  try {
    return (await stat4(path)).mtimeMs;
  } catch {
    return null;
  }
}
function expandPath(path) {
  if (path === "~") return homedir3();
  if (path.startsWith(`~${sep3}`)) return join4(homedir3(), path.slice(2));
  return path;
}

// src/lib/core/provider-status.ts
var ProviderStatus = class {
  errors = /* @__PURE__ */ new Map();
  clear(provider) {
    this.errors.delete(provider);
  }
  recordError(provider, error) {
    this.errors.set(provider, errorMessage(error));
  }
  recordMessage(provider, message) {
    this.errors.set(provider, message);
  }
  snapshot() {
    return Object.fromEntries(this.errors);
  }
};
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

// src/lib/core/providers/codex/local.ts
import { createReadStream as createReadStream2 } from "fs";
import { readdir as readdir2 } from "fs/promises";
import { basename as basename3, join as join5 } from "path";
import { createInterface as createInterface2 } from "readline";

// src/lib/core/providers/codex/parse.ts
function createCodexLineParser(ctx) {
  let currentModel = "unknown";
  let currentProject = ctx.project;
  let sequence = 0;
  return {
    parse(line) {
      const obj = parseObject(line);
      if (!obj) return null;
      const type = stringValue(obj.type);
      const payload = objectValue(obj.payload);
      if (type === "turn_context") {
        currentModel = stringValue(payload.model) ?? currentModel;
        currentProject = stringValue(payload.cwd) ?? currentProject;
        return null;
      }
      if (type !== "event_msg" || stringValue(payload.type) !== "token_count") return null;
      const timestamp = stringValue(obj.timestamp);
      if (!timestamp) return null;
      const ts = Date.parse(timestamp);
      if (!Number.isFinite(ts)) return null;
      const info = objectValue(payload.info);
      const usage = tokenUsage(objectValue(info.last_token_usage));
      const cached = usage.cached_input_tokens ?? 0;
      const input = Math.max((usage.input_tokens ?? 0) - cached, 0);
      const output = (usage.output_tokens ?? 0) + (usage.reasoning_output_tokens ?? 0);
      const tokens = { input, output, cacheCreation: 0, cacheRead: cached };
      if (tokens.input === 0 && tokens.output === 0 && tokens.cacheRead === 0) return null;
      sequence += 1;
      return {
        key: `codex:${ctx.sessionId}:${sequence}`,
        provider: "codex",
        timestamp: ts,
        day: isoDayUTC(ts),
        model: currentModel,
        tokens,
        cacheCreation1h: 0,
        cacheCreation5m: 0,
        webSearchRequests: 0,
        webFetchRequests: 0,
        sessionId: ctx.sessionId,
        project: currentProject,
        isSidechain: false,
        cost: computeCost(currentModel, tokens)
      };
    }
  };
}
function parseObject(line) {
  try {
    const parsed = JSON.parse(line);
    return objectValue(parsed);
  } catch {
    return null;
  }
}
function objectValue(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return value;
}
function stringValue(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}
function tokenUsage(value) {
  return {
    input_tokens: numberValue(value.input_tokens),
    cached_input_tokens: numberValue(value.cached_input_tokens),
    output_tokens: numberValue(value.output_tokens),
    reasoning_output_tokens: numberValue(value.reasoning_output_tokens)
  };
}
function numberValue(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

// src/lib/core/providers/codex/local.ts
async function readCodexRecords(root) {
  const files = await walkJsonl2(root);
  const records = [];
  const errors = [];
  for (const file of files) {
    const parser = createCodexLineParser({ sessionId: basename3(file, ".jsonl"), project: "codex" });
    try {
      const stream = createReadStream2(file, { encoding: "utf8", highWaterMark: 1 << 20 });
      const rl = createInterface2({ input: stream, crlfDelay: Infinity });
      for await (const line of rl) {
        const rec = parser.parse(line);
        if (rec) records.push(rec);
      }
    } catch (error) {
      errors.push(errorMessage2(error));
    }
  }
  return { filesScanned: files.length, records, errors };
}
function errorMessage2(error) {
  return error instanceof Error ? error.message : String(error);
}
async function walkJsonl2(dir) {
  const out = [];
  await walkJsonlInto(dir, out);
  return out;
}
async function walkJsonlInto(dir, out) {
  const entries = await readdir2(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join5(dir, entry.name);
    if (entry.isDirectory()) {
      await walkJsonlInto(full, out);
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      out.push(full);
    }
  }
}

// src/lib/core/providers/opencode/sqlite.ts
import { DatabaseSync } from "node:sqlite";
async function readOpenCodeSessions(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const rows = db.prepare(`SELECT id, path, agent, model, cost, tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write, time_created, time_updated FROM session`).all().map(parseRow);
    return rows.map(rowToRecord);
  } finally {
    db.close();
  }
}
function parseRow(row) {
  return {
    id: stringValue2(row.id, "unknown"),
    path: nullableString(row.path),
    agent: nullableString(row.agent),
    model: nullableString(row.model),
    cost: numberValue2(row.cost),
    tokens_input: numberValue2(row.tokens_input),
    tokens_output: numberValue2(row.tokens_output),
    tokens_reasoning: numberValue2(row.tokens_reasoning),
    tokens_cache_read: numberValue2(row.tokens_cache_read),
    tokens_cache_write: numberValue2(row.tokens_cache_write),
    time_created: numberValue2(row.time_created),
    time_updated: numberValue2(row.time_updated)
  };
}
function rowToRecord(row) {
  const tokens = {
    input: row.tokens_input,
    output: row.tokens_output + row.tokens_reasoning,
    cacheCreation: row.tokens_cache_write,
    cacheRead: row.tokens_cache_read
  };
  return {
    key: `opencode:${row.id}`,
    provider: "opencode",
    timestamp: row.time_updated,
    day: isoDayUTC(row.time_updated),
    model: modelLabel(row.model),
    tokens,
    cacheCreation1h: 0,
    cacheCreation5m: 0,
    webSearchRequests: 0,
    webFetchRequests: 0,
    sessionId: row.id,
    project: row.path ?? row.agent ?? "opencode",
    isSidechain: false,
    cost: row.cost
  };
}
function modelLabel(raw) {
  if (!raw) return "unknown";
  try {
    const parsed = JSON.parse(raw);
    const info = modelInfo(parsed);
    if (info.id && info.providerID) return `${info.providerID}/${info.id}`;
    if (info.id) return info.id;
    return raw;
  } catch {
    return raw;
  }
}
function modelInfo(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const record = value;
  return {
    id: typeof record.id === "string" ? record.id : void 0,
    providerID: typeof record.providerID === "string" ? record.providerID : void 0,
    variant: typeof record.variant === "string" ? record.variant : void 0
  };
}
function stringValue2(value, fallback) {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}
function nullableString(value) {
  return typeof value === "string" ? value : null;
}
function numberValue2(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

// src/lib/core/providers/cursor/api.ts
function cursorEventToRecord(event) {
  const timestamp = Number(event.timestamp);
  const usage = event.tokenUsage ?? {};
  const tokens = {
    input: usage.inputTokens ?? 0,
    output: usage.outputTokens ?? 0,
    cacheCreation: usage.cacheWriteTokens ?? 0,
    cacheRead: usage.cacheReadTokens ?? 0
  };
  const owner = event.userEmail ?? event.serviceAccountName ?? event.serviceAccountId ?? "cursor";
  return {
    key: `cursor:${event.timestamp}:${owner}:${event.model}`,
    provider: "cursor",
    timestamp,
    day: isoDayUTC(timestamp),
    model: event.model,
    tokens,
    cacheCreation1h: 0,
    cacheCreation5m: 0,
    webSearchRequests: 0,
    webFetchRequests: 0,
    sessionId: `cursor:${event.timestamp}:${owner}`,
    project: owner,
    isSidechain: Boolean(event.isHeadless),
    cost: event.chargedCents / 100
  };
}
async function fetchCursorUsageRecords(opts) {
  const fetcher = opts.fetcher ?? fetch;
  const pageSize = opts.pageSize ?? 100;
  const records = [];
  let page = 1;
  let hasNextPage = true;
  while (hasNextPage) {
    const body = opts.email ? { startDate: opts.startDate, endDate: opts.endDate, email: opts.email, page, pageSize } : { startDate: opts.startDate, endDate: opts.endDate, page, pageSize };
    const request = new Request("https://api.cursor.com/teams/filtered-usage-events", {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`${opts.adminApiToken}:`).toString("base64")}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(body)
    });
    const response = await fetcher(request);
    if (!response.ok) throw new CursorApiError(response.status);
    const payload = await response.json();
    const parsed = parseUsageResponse(payload);
    records.push(...parsed.events.map(cursorEventToRecord));
    hasNextPage = parsed.hasNextPage;
    page += 1;
  }
  return records;
}
var CursorApiError = class extends Error {
  constructor(status) {
    super(`Cursor Admin API returned HTTP ${status}`);
    this.status = status;
  }
  status;
};
function parseUsageResponse(payload) {
  const root = objectValue2(payload);
  const pagination = objectValue2(root.pagination);
  const usageEvents = Array.isArray(root.usageEvents) ? root.usageEvents : [];
  return {
    events: usageEvents.map(parseEvent).filter((event) => event !== null),
    hasNextPage: Boolean(pagination.hasNextPage)
  };
}
function parseEvent(value) {
  const event = objectValue2(value);
  const timestamp = stringValue3(event.timestamp);
  const model = stringValue3(event.model);
  const chargedCents = numberValue3(event.chargedCents);
  if (!timestamp || !model) return null;
  return {
    timestamp,
    userEmail: optionalString(event.userEmail),
    serviceAccountId: optionalString(event.serviceAccountId),
    serviceAccountName: optionalString(event.serviceAccountName),
    model,
    kind: optionalString(event.kind),
    maxMode: optionalBoolean(event.maxMode),
    requestsCosts: optionalNumber(event.requestsCosts),
    isTokenBasedCall: optionalBoolean(event.isTokenBasedCall),
    isChargeable: optionalBoolean(event.isChargeable),
    isHeadless: optionalBoolean(event.isHeadless),
    tokenUsage: parseTokenUsage(event.tokenUsage),
    chargedCents,
    cursorTokenFee: optionalNumber(event.cursorTokenFee)
  };
}
function parseTokenUsage(value) {
  const usage = objectValue2(value);
  if (Object.keys(usage).length === 0) return void 0;
  return {
    inputTokens: optionalNumber(usage.inputTokens),
    outputTokens: optionalNumber(usage.outputTokens),
    cacheWriteTokens: optionalNumber(usage.cacheWriteTokens),
    cacheReadTokens: optionalNumber(usage.cacheReadTokens),
    totalCents: optionalNumber(usage.totalCents),
    discountPercentOff: optionalNumber(usage.discountPercentOff)
  };
}
function objectValue2(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return value;
}
function stringValue3(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}
function optionalString(value) {
  return typeof value === "string" ? value : void 0;
}
function numberValue3(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
function optionalNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : void 0;
}
function optionalBoolean(value) {
  return typeof value === "boolean" ? value : void 0;
}

// src/lib/core/engine.ts
var MTIME_POLL_MS = 4e3;
var DELTA_DEBOUNCE_MS = 400;
var Ingestion = class {
  constructor(config, watchEnabled) {
    this.config = config;
    this.watchEnabled = watchEnabled;
  }
  config;
  watchEnabled;
  rollup = new Rollup();
  dedup = new DedupSet();
  fileStates = /* @__PURE__ */ new Map();
  // path -> {offset,...}
  fileToProjectsDir = /* @__PURE__ */ new Map();
  // path -> owning projects dir
  projectsDirs = [];
  watchers = [];
  mtimes = /* @__PURE__ */ new Map();
  pollTimer = null;
  cursorTimer = null;
  deltaTimer = null;
  listeners = /* @__PURE__ */ new Set();
  ready = null;
  coldScanMs = 0;
  pendingChanges = /* @__PURE__ */ new Set();
  claudeEnv = null;
  providerStatus = new ProviderStatus();
  disposed = false;
  /** Idempotent: kicks off the cold scan + watchers once. */
  ensureStarted() {
    if (!this.ready) this.ready = this.start();
    return this.ready;
  }
  async start() {
    const t0 = Date.now();
    const cfg = this.config ?? await loadConfig();
    this.rollup.setCutover(cfg.cutoverTs);
    const claudeEnv = {
      ...process.env,
      CLAUDE_CONFIG_DIR: cfg.providers.claude.roots.map(expandPath).join(",")
    };
    this.claudeEnv = cfg.providers.claude.enabled ? claudeEnv : null;
    this.projectsDirs = cfg.providers.claude.enabled ? await resolveProjectsDirs(claudeEnv) : [];
    const files = cfg.providers.claude.enabled ? await discoverFiles(claudeEnv) : [];
    for (const f of files) {
      const projectsDir = this.owningProjectsDir(f.path);
      this.fileToProjectsDir.set(f.path, projectsDir);
      this.rollup.markFileScanned();
      try {
        const newOffset = await ingestRange(f.path, 0, projectsDir, this.rollup, this.dedup);
        this.fileStates.set(f.path, {
          offset: newOffset,
          project: f.project,
          isSidechain: f.isSidechain
        });
        const m = await safeMtime(f.path);
        if (m != null) this.mtimes.set(f.path, m);
      } catch {
      }
    }
    if (cfg.providers.codex.enabled) {
      await this.ingestCodex(expandPath(cfg.providers.codex.root));
    }
    if (cfg.providers.opencode.enabled) {
      await this.ingestOpenCode(expandPath(cfg.providers.opencode.dbPath));
    }
    if (cfg.providers.cursor.enabled && cfg.providers.cursor.adminApiToken) {
      await this.ingestCursor(cfg.providers.cursor.adminApiToken, cfg.providers.cursor.email);
      if (this.watchEnabled && !this.disposed) this.startCursorPolling(cfg.providers.cursor);
    }
    this.coldScanMs = Date.now() - t0;
    if (this.watchEnabled && !this.disposed) this.startWatching();
  }
  async ingestCodex(root) {
    try {
      const result = await readCodexRecords(root);
      for (let i = 0; i < result.filesScanned; i++) this.rollup.markFileScanned();
      this.addProviderRecords(result.records);
      const [firstError] = result.errors;
      if (firstError) this.providerStatus.recordMessage("codex", firstError);
      else this.providerStatus.clear("codex");
    } catch (error) {
      this.providerStatus.recordError("codex", error);
      return;
    }
  }
  async ingestOpenCode(dbPath) {
    try {
      this.rollup.markFileScanned();
      const records = await readOpenCodeSessions(dbPath);
      this.addProviderRecords(records);
      this.providerStatus.clear("opencode");
    } catch (error) {
      this.providerStatus.recordError("opencode", error);
      return;
    }
  }
  async ingestCursor(adminApiToken, email) {
    try {
      const endDate = Date.now();
      const startDate = endDate - 30 * 24 * 60 * 60 * 1e3;
      const records = await fetchCursorUsageRecords({
        adminApiToken,
        startDate,
        endDate,
        email: email ?? void 0,
        pageSize: 100
      });
      this.addProviderRecords(records);
      this.providerStatus.clear("cursor");
    } catch (error) {
      this.providerStatus.recordError("cursor", error);
      return;
    }
  }
  addProviderRecords(records) {
    for (const rec of records) {
      if (!this.dedup.add(rec.key)) {
        this.rollup.addDuplicate();
        continue;
      }
      this.rollup.add(rec);
    }
  }
  startCursorPolling(cfg) {
    if (this.cursorTimer || !cfg.adminApiToken) return;
    this.cursorTimer = setInterval(() => void this.pollCursor(cfg), cfg.pollSeconds * 1e3);
    if (this.cursorTimer.unref) this.cursorTimer.unref();
  }
  async pollCursor(cfg) {
    if (this.disposed) return;
    await this.ingestCursor(cfg.adminApiToken, cfg.email);
    if (this.disposed) return;
    if (this.rollup.hasDirty()) {
      const delta = this.rollup.drainDelta();
      if (delta) for (const fn of this.listeners) fn(delta);
    }
  }
  owningProjectsDir(filePath) {
    for (const dir of this.projectsDirs) {
      if (filePath.startsWith(dir + sep4)) return dir;
    }
    return this.projectsDirs[0] ?? "";
  }
  startWatching() {
    for (const dir of this.projectsDirs) {
      try {
        const w = watch(dir, { recursive: true }, (_event, filename) => {
          if (!filename) return;
          const name = filename.toString();
          if (!name.endsWith(".jsonl")) return;
          const full = name.startsWith(dir) ? name : `${dir}${sep4}${name}`;
          this.fileToProjectsDir.set(full, dir);
          this.queueChange(full);
        });
        this.watchers.push(w);
      } catch {
      }
    }
    this.pollTimer = setInterval(() => void this.pollMtimes(), MTIME_POLL_MS);
    if (this.pollTimer.unref) this.pollTimer.unref();
  }
  queueChange(full) {
    if (this.disposed) return;
    this.pendingChanges.add(full);
    if (this.deltaTimer) return;
    this.deltaTimer = setTimeout(() => void this.flushChanges(), DELTA_DEBOUNCE_MS);
    if (this.deltaTimer.unref) this.deltaTimer.unref();
  }
  async flushChanges() {
    this.deltaTimer = null;
    if (this.disposed) return;
    const paths = [...this.pendingChanges];
    this.pendingChanges.clear();
    for (const full of paths) {
      await this.tailFile(full);
    }
    if (this.disposed) return;
    if (this.rollup.hasDirty()) {
      const delta = this.rollup.drainDelta();
      if (delta) for (const fn of this.listeners) fn(delta);
    }
  }
  async tailFile(full) {
    const projectsDir = this.fileToProjectsDir.get(full) ?? this.owningProjectsDir(full);
    const state = this.fileStates.get(full);
    const startOffset = state?.offset ?? 0;
    if (!state) this.rollup.markFileScanned();
    try {
      const newOffset = await ingestRange(full, startOffset, projectsDir, this.rollup, this.dedup);
      const existing = this.fileStates.get(full);
      this.fileStates.set(full, {
        offset: newOffset,
        project: existing?.project ?? "unknown",
        isSidechain: existing?.isSidechain ?? full.includes(`${sep4}subagents${sep4}`)
      });
      const m = await safeMtime(full);
      if (m != null) this.mtimes.set(full, m);
    } catch {
    }
  }
  async pollMtimes() {
    let changed = false;
    try {
      if (this.disposed || !this.claudeEnv) return;
      const files = await discoverFiles(this.claudeEnv);
      for (const f of files) {
        const m = await safeMtime(f.path);
        if (m == null) continue;
        const prev = this.mtimes.get(f.path);
        if (prev === void 0 || m > prev) {
          this.fileToProjectsDir.set(f.path, this.owningProjectsDir(f.path));
          this.pendingChanges.add(f.path);
          changed = true;
        }
      }
    } catch {
    }
    if (changed && !this.deltaTimer) {
      this.deltaTimer = setTimeout(() => void this.flushChanges(), DELTA_DEBOUNCE_MS);
      if (this.deltaTimer.unref) this.deltaTimer.unref();
    }
  }
  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  snapshot() {
    return this.rollup.snapshot();
  }
  setCutover(ts) {
    this.rollup.setCutover(ts);
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const w of this.watchers) {
      try {
        w.close();
      } catch {
      }
    }
    this.watchers = [];
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.cursorTimer) {
      clearInterval(this.cursorTimer);
      this.cursorTimer = null;
    }
    if (this.deltaTimer) {
      clearTimeout(this.deltaTimer);
      this.deltaTimer = null;
    }
    this.listeners.clear();
  }
  get stats() {
    return {
      coldScanMs: this.coldScanMs,
      files: this.fileStates.size,
      providerErrors: this.providerStatus.snapshot()
    };
  }
};
async function runOnce(config) {
  const engine = new Ingestion(config ?? null, false);
  try {
    await engine.ensureStarted();
    return engine.snapshot();
  } finally {
    engine.dispose();
  }
}

// src/lib/core/aggregate.ts
function zeroTokens3() {
  return { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };
}
function addInto(into, from) {
  into.input += from.input;
  into.output += from.output;
  into.cacheCreation += from.cacheCreation;
  into.cacheRead += from.cacheRead;
}
function aggregateByModel(dayModel) {
  const m = /* @__PURE__ */ new Map();
  for (const dm of dayModel) {
    let t = m.get(dm.model);
    if (!t) {
      t = { model: dm.model, tokens: zeroTokens3(), cost: 0, requests: 0 };
      m.set(dm.model, t);
    }
    addInto(t.tokens, dm.tokens);
    t.cost += dm.cost;
    t.requests += dm.requests;
  }
  return [...m.values()].sort((a, b) => b.cost - a.cost);
}
function aggregateByProvider(dayModel) {
  const providers = /* @__PURE__ */ new Map();
  for (const dm of dayModel) {
    let t = providers.get(dm.provider);
    if (!t) {
      t = { provider: dm.provider, tokens: zeroTokens3(), cost: 0, requests: 0 };
      providers.set(dm.provider, t);
    }
    addInto(t.tokens, dm.tokens);
    t.cost += dm.cost;
    t.requests += dm.requests;
  }
  return [...providers.values()].sort((a, b) => b.cost - a.cost);
}
function sumGrain(dayModel, opts = {}) {
  const t = { tokens: zeroTokens3(), cost: 0, requests: 0, costUnknownRequests: 0 };
  for (const dm of dayModel) {
    if (opts.from && dm.day < opts.from) continue;
    if (opts.to && dm.day > opts.to) continue;
    if (opts.models && opts.models.size > 0 && !opts.models.has(dm.model)) continue;
    if (opts.providers && opts.providers.size > 0 && !opts.providers.has(dm.provider)) continue;
    addInto(t.tokens, dm.tokens);
    t.cost += dm.cost;
    t.requests += dm.requests;
    t.costUnknownRequests += dm.costUnknownRequests;
  }
  return t;
}
function filterDays(dayModel, from, to) {
  if (!from && !to) return dayModel;
  return dayModel.filter((dm) => (!from || dm.day >= from) && (!to || dm.day <= to));
}

// src/lib/format.ts
function providerLabel(provider) {
  switch (provider) {
    case "claude":
      return "Claude Code";
    case "codex":
      return "Codex";
    case "opencode":
      return "OpenCode";
    case "cursor":
      return "Cursor";
    default:
      return provider;
  }
}
function modelLabel2(model) {
  const m = model.match(/^claude-(opus|sonnet|haiku)-(\d+)-(\d+)/i);
  if (m) {
    const name = m[1][0].toUpperCase() + m[1].slice(1);
    return `${name} ${m[2]}.${m[3]}`;
  }
  return model;
}
var usd0 = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0
});
var usd2 = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});
var usd4 = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 4,
  maximumFractionDigits: 4
});
function money(v) {
  if (v >= 1e3) return usd0.format(v);
  if (v >= 0.01) return usd2.format(v);
  if (v > 0) return usd4.format(v);
  return "$0.00";
}
function compactTokens(v) {
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return String(Math.round(v));
}
var intFmt = new Intl.NumberFormat("en-US");
function int(v) {
  return intFmt.format(Math.round(v));
}

// src/cli/commands/stats.ts
var TOP_MODELS = 8;
async function runStats(flags) {
  const cfg = await loadConfig();
  const snapshot2 = await runOnce(cfg);
  if (flags.json) {
    if (flags.period || flags.providers) {
      const providerFilter = flags.providers && flags.providers.length > 0 ? new Set(flags.providers) : null;
      const { from, to } = periodDayRange(flags.period);
      let grain = filterDays(snapshot2.dayModel, from, to);
      if (providerFilter) {
        grain = grain.filter((dm) => providerFilter.has(dm.provider));
      }
      const scoped = {
        ...snapshot2,
        dayModel: grain
      };
      process.stdout.write(JSON.stringify(scoped) + "\n");
    } else {
      process.stdout.write(JSON.stringify(snapshot2) + "\n");
    }
    return;
  }
  printHuman(snapshot2, flags);
}
function periodDayRange(period) {
  if (!period) return { from: void 0, to: void 0 };
  const now = /* @__PURE__ */ new Date();
  const todayUTC = now.toISOString().slice(0, 10);
  if (period === "day") {
    return { from: todayUTC, to: todayUTC };
  }
  if (period === "week") {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const dow = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() - dow);
    const from = d.toISOString().slice(0, 10);
    return { from, to: todayUTC };
  }
  if (period === "month") {
    const from = `${todayUTC.slice(0, 7)}-01`;
    return { from, to: todayUTC };
  }
  return { from: void 0, to: void 0 };
}
function printHuman(snapshot2, flags) {
  const providerFilter = flags.providers && flags.providers.length > 0 ? new Set(flags.providers) : null;
  const { from, to } = periodDayRange(flags.period);
  let grain = filterDays(snapshot2.dayModel, from, to);
  if (providerFilter) {
    grain = grain.filter((dm) => providerFilter.has(dm.provider));
  }
  if (snapshot2.dayModel.length === 0) {
    console.log("chaching: no data found.");
    console.log("");
    console.log("Run `chaching init` to configure your providers and start tracking spend.");
    return;
  }
  if (grain.length === 0) {
    const label = flags.providers ? `provider(s): ${flags.providers.join(", ")}` : "";
    const periodLabel2 = flags.period ? ` for period: ${flags.period}` : "";
    console.log(`chaching: no data found for ${label}${periodLabel2}.`);
    return;
  }
  const totals = sumGrain(grain);
  const byProvider = aggregateByProvider(grain);
  const byModel = aggregateByModel(grain).slice(0, TOP_MODELS);
  const totalToks = totals.tokens.input + totals.tokens.output + totals.tokens.cacheCreation + totals.tokens.cacheRead;
  const periodLabel = flags.period ? `  period: ${flags.period}${from ? ` (${from} \u2192 ${to ?? "today"})` : ""}` : "";
  const provLabel = providerFilter ? `  provider filter: ${flags.providers?.join(", ")}` : "";
  console.log("");
  console.log("  chaching \u2014 spend summary");
  if (periodLabel) console.log(periodLabel);
  if (provLabel) console.log(provLabel);
  if (snapshot2.earliestDay) {
    console.log(`  data since: ${snapshot2.earliestDay}`);
  }
  console.log("");
  console.log(`  Total cost:    ${money(totals.cost)}`);
  console.log(`  Total tokens:  ${compactTokens(totalToks)}`);
  console.log(`    Input:       ${compactTokens(totals.tokens.input)}`);
  console.log(`    Output:      ${compactTokens(totals.tokens.output)}`);
  console.log(`    Cache read:  ${compactTokens(totals.tokens.cacheRead)}`);
  console.log(`    Cache write: ${compactTokens(totals.tokens.cacheCreation)}`);
  console.log(`  Requests:      ${int(totals.requests)}`);
  if (totals.costUnknownRequests > 0) {
    console.log(`  (${int(totals.costUnknownRequests)} request(s) with unknown pricing)`);
  }
  if (byProvider.length > 0) {
    console.log("");
    console.log("  By provider:");
    for (const p of byProvider) {
      const toks = p.tokens.input + p.tokens.output + p.tokens.cacheCreation + p.tokens.cacheRead;
      console.log(`    ${providerLabel(p.provider).padEnd(16)} ${money(p.cost).padStart(10)}  ${compactTokens(toks).padStart(7)} tokens  ${int(p.requests).padStart(6)} req`);
    }
  }
  if (byModel.length > 0) {
    console.log("");
    console.log(`  By model (top ${Math.min(TOP_MODELS, byModel.length)}):`);
    for (const m of byModel) {
      const toks = m.tokens.input + m.tokens.output + m.tokens.cacheCreation + m.tokens.cacheRead;
      console.log(`    ${modelLabel2(m.model).padEnd(20)} ${money(m.cost).padStart(10)}  ${compactTokens(toks).padStart(7)} tokens  ${int(m.requests).padStart(6)} req`);
    }
  }
  console.log("");
}

// src/cli/commands/serve.ts
import { existsSync } from "fs";
import { readFile as readFile2 } from "fs/promises";
import { homedir as homedir4 } from "os";
import { dirname as dirname2, join as join6 } from "path";
import { fileURLToPath as fileURLToPath2 } from "url";
function configPath() {
  const configHome = process.env.XDG_CONFIG_HOME?.trim() || join6(homedir4(), ".config");
  return join6(configHome, "chaching", "config.json");
}
async function serverConfig() {
  try {
    const raw = await readFile2(configPath(), "utf8");
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null && "server" in parsed && typeof parsed.server === "object" && parsed.server !== null ? parsed.server : {};
  } catch {
    return {};
  }
}
function packageRoot() {
  const here = typeof __dirname !== "undefined" ? __dirname : dirname2(fileURLToPath2(import.meta.url));
  return join6(here, "..", "..");
}
async function runServe() {
  const rootDir = packageRoot();
  const buildEntry = join6(rootDir, "build", "index.js");
  if (!existsSync(buildEntry)) {
    console.error("chaching: build artifact missing. Run `npm run build` before `chaching serve`.");
    process.exit(1);
  }
  const server = await serverConfig();
  const configHost = typeof server.host === "string" && server.host.length > 0 ? server.host : "0.0.0.0";
  const configPort = typeof server.port === "number" && server.port > 0 ? String(server.port) : "5178";
  process.env.HOST ??= configHost;
  process.env.PORT ??= configPort;
  await import(buildEntry);
}

// src/cli/commands/init.ts
async function runWizard() {
  console.log("chaching init: wizard coming in wave 3.");
  console.log("");
  console.log("For now, create ~/.config/chaching/config.json manually.");
  console.log("See: https://github.com/rbutera/chaching#configuration");
}

// src/cli/commands/provider.ts
async function runProvider(args) {
  const [action, name] = args;
  if (!action) {
    console.log("chaching provider: sub-subcommands: add | enable | disable");
    console.log("");
    console.log("Provider management is coming in wave 3.");
    return;
  }
  if (action === "add" || action === "enable" || action === "disable") {
    console.log(`chaching provider ${action}${name ? ` ${name}` : ""}: coming in wave 3.`);
    return;
  }
  console.error(`chaching provider: unknown action '${action}' (must be add|enable|disable)`);
  process.exit(1);
}

// src/cli/help.ts
import { fileURLToPath as fileURLToPath3 } from "url";
import { join as join7, dirname as dirname3 } from "path";
import { readFileSync as readFileSync2 } from "fs";
function packageVersion() {
  try {
    const here = typeof __dirname !== "undefined" ? __dirname : dirname3(fileURLToPath3(import.meta.url));
    for (let depth = 0; depth <= 4; depth++) {
      const candidate = join7(here, ...Array(depth).fill(".."), "package.json");
      try {
        const raw = readFileSync2(candidate, "utf8");
        const parsed = JSON.parse(raw);
        if (parsed.version) return parsed.version;
      } catch {
      }
    }
  } catch {
  }
  return "0.0.0";
}
function printVersion() {
  console.log(packageVersion());
}
function printUsage() {
  console.log(`chaching \u2014 multi-provider AI token spend dashboard

Usage:
  chaching               Open the TUI dashboard (or run wizard on first launch)
  chaching stats         One-shot summary: totals, per-provider, per-model
  chaching serve         Start the web dashboard server
  chaching init          Run the setup wizard (re-runnable)
  chaching provider      Manage providers (add | enable | disable)

Flags (global):
  --version, -v          Print version and exit
  --help, -h             Print this help and exit

Flags for stats:
  --period day|week|month  Aggregate by period (default: all time)
  --provider <name>        Filter to provider(s); repeatable or comma-separated
  --json                   Output only the raw JSON snapshot to stdout

Examples:
  chaching stats --period week --provider codex
  chaching stats --json | jq .totals.cost
  chaching serve
`);
}

// src/cli/router.ts
import { existsSync as existsSync2 } from "fs";
async function run(argv) {
  if (argv.includes("--version") || argv.includes("-v")) {
    printVersion();
    return;
  }
  if (argv.includes("--help") || argv.includes("-h")) {
    printUsage();
    return;
  }
  const [subcommand, ...rest] = argv;
  switch (subcommand) {
    case void 0:
    case "":
      await runDefault(rest);
      return;
    case "stats":
      await runStats(parseStatsFlags(rest));
      return;
    case "serve":
      await runServe();
      return;
    case "init":
      await runWizard();
      return;
    case "provider":
      await runProvider(rest);
      return;
    default:
      console.error(`chaching: unknown subcommand '${subcommand}'
`);
      printUsage();
      process.exit(1);
  }
}
async function runDefault(_rest) {
  const cfgPath = configFilePath();
  const hasConfig = existsSync2(cfgPath);
  if (!hasConfig) {
    await runWizard();
  }
  await runStats({});
}
function parseStatsFlags(argv) {
  const flags = {};
  const providers = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") {
      flags.json = true;
    } else if (arg === "--period") {
      const p = argv[i + 1];
      if (!p || p.startsWith("--")) {
        console.error(`chaching stats: --period requires a value (day|week|month)`);
        process.exit(1);
      }
      i++;
      if (p === "day" || p === "week" || p === "month") {
        flags.period = p;
      } else {
        console.error(`chaching stats: unknown period '${p}' (must be day|week|month)`);
        process.exit(1);
      }
    } else if (arg.startsWith("--period=")) {
      const p = arg.slice("--period=".length);
      if (!p) {
        console.error(`chaching stats: --period requires a value (day|week|month)`);
        process.exit(1);
      }
      if (p === "day" || p === "week" || p === "month") {
        flags.period = p;
      } else {
        console.error(`chaching stats: unknown period '${p}' (must be day|week|month)`);
        process.exit(1);
      }
    } else if (arg === "--provider") {
      const raw = argv[i + 1];
      if (!raw || raw.startsWith("--")) {
        console.error(`chaching stats: --provider requires a value`);
        process.exit(1);
      }
      i++;
      providers.push(...raw.split(",").map((s) => s.trim()).filter(Boolean));
    } else if (arg.startsWith("--provider=")) {
      const raw = arg.slice("--provider=".length);
      if (!raw) {
        console.error(`chaching stats: --provider requires a value`);
        process.exit(1);
      }
      providers.push(...raw.split(",").map((s) => s.trim()).filter(Boolean));
    } else if (arg.startsWith("-")) {
      console.error(`chaching stats: unknown flag '${arg}'`);
      console.error(`Run \`chaching --help\` for usage.`);
      process.exit(1);
    }
  }
  if (providers.length > 0) flags.providers = providers;
  return flags;
}

// src/cli/index.ts
await run(process.argv.slice(2));
