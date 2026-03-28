/**
 * openclaw-hrr-memory — Structured fact recall for OpenClaw agents.
 *
 * Registers tools: fact_lookup, fact_ask, fact_forget, fact_rebuild
 * Optional observation layer: fact_history, fact_observations, fact_flags, fact_observe_write
 *
 * RAG handles 80% of memory queries. The other 20% — exact fact recall — is
 * where it struggles and HRR excels. Use both.
 */

import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { readFileSync, existsSync, watchFile } from "fs";
import { join, resolve } from "path";
import { HRRMemory } from "hrr-memory";

// Optional observation layer — loaded lazily in register()
import { createRequire } from "module";

// ── MEMORY.md Parser ──────────────────────────────────────────

function parseMemoryToTriples(content) {
  const triples = [];
  let section = "general";

  for (const line of content.split("\n")) {
    const t = line.trim();
    if (t.startsWith("## ")) {
      section = t.slice(3).trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
      continue;
    }
    if (t.startsWith("# ") || t.startsWith("{") || t.startsWith('"') || t.startsWith("```")) continue;
    if (/session.?key|session.?id|sender|message_id|timestamp/i.test(t)) continue;

    // Match "- **key**: value" or "- key: value" patterns
    const kvMatch = t.match(/^[-*]\s*(?:\*\*)?([^:*]+?)(?:\*\*)?\s*:\s*(.+)$/);
    if (kvMatch) {
      const key = kvMatch[1].trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
      const value = kvMatch[2].trim();
      if (key && value && value.length < 80 && value.length > 1) {
        triples.push({
          subject: section,
          relation: key,
          object: value.toLowerCase().replace(/[^a-z0-9_./:-]+/g, "_").replace(/^_|_$/g, ""),
        });
      }
      continue;
    }

    // Heuristic extraction for loose prose
    if (section && t.length > 10 && t.length < 200 && !t.startsWith("-")) {
      const inM = t.match(/(\w+)\s+in\s+(\w+)/i);
      if (inM && inM[1].length > 2 && inM[2].length > 2)
        triples.push({ subject: section, relation: "location", object: inM[2].toLowerCase() });
      const atM = t.match(/(?:at|for)\s+(\w+)/i);
      if (atM && atM[1].length > 2)
        triples.push({ subject: section, relation: "organization", object: atM[1].toLowerCase() });
      const prefM = t.match(/[Pp]refers?\s+(.+?)(?:\.|$)/);
      if (prefM) {
        for (const p of prefM[1].split(",").map((x) => x.trim().toLowerCase())) {
          if (p.length > 2 && p.length < 40)
            triples.push({ subject: section, relation: "prefers", object: p.replace(/[^a-z0-9_]+/g, "_") });
        }
      }
    }
  }
  return triples;
}

// ── Helpers ───────────────────────────────────────────────────

function tripleKey(t) {
  return `${t.subject}\0${t.relation}\0${t.object}`;
}

function resolveMemoryFiles(api) {
  const config = api.pluginConfig || {};
  if (config.memoryFiles && config.memoryFiles.length > 0) {
    return config.memoryFiles.map((f) => resolve(f));
  }
  // Default: workspace MEMORY.md files
  const workspaceDir = api.runtime?.agent?.workspaceDir;
  if (workspaceDir) {
    return [join(workspaceDir, "MEMORY.md")];
  }
  const home = process.env.HOME || "/root";
  return [join(home, ".openclaw/workspace/MEMORY.md")];
}

// ── Plugin Entry ──────────────────────────────────────────────

export default definePluginEntry({
  id: "hrr-memory",
  name: "HRR Fact Memory",
  description: "Structured fact recall using Holographic Reduced Representations",

  register(api) {
    const config = api.pluginConfig || {};
    const watchInterval = config.watchInterval ?? 30000;
    const enableObs = config.enableObservations ?? false;

    const MEMORY_FILES = resolveMemoryFiles(api);
    const stateDir = api.runtime?.state?.dir
      ? resolve(api.runtime.state.dir)
      : resolve(process.env.HOME || "/root", ".openclaw/memory");
    const INDEX_PATH = join(stateDir, "hrr-index.json");
    const OBS_PATH = join(stateDir, "observations.json");

    let ObservationMemory = null;
    if (enableObs) {
      try {
        const require = createRequire(import.meta.url);
        const obs = require("hrr-memory-obs");
        ObservationMemory = obs.ObservationMemory;
        api.logger.info("Observation layer enabled");
      } catch {
        api.logger.warn("hrr-memory-obs not installed. Install with: npm install hrr-memory-obs");
      }
    }

    let mem = null;
    let lastBuild = 0;

    function initMem() {
      if (ObservationMemory && existsSync(INDEX_PATH) && existsSync(OBS_PATH)) {
        return ObservationMemory.load(INDEX_PATH, OBS_PATH);
      }
      if (existsSync(INDEX_PATH)) {
        const hrr = HRRMemory.load(INDEX_PATH);
        return ObservationMemory ? new ObservationMemory(hrr) : hrr;
      }
      const hrr = new HRRMemory();
      return ObservationMemory ? new ObservationMemory(hrr) : hrr;
    }

    function collectTriples() {
      const triples = [];
      for (const fp of MEMORY_FILES) {
        if (!existsSync(fp)) continue;
        triples.push(...parseMemoryToTriples(readFileSync(fp, "utf8")));
      }
      return triples;
    }

    function rebuildIndex() {
      const triples = collectTriples();
      const currentKeys = new Set(triples.map(tripleKey));

      // Diff against previous state for observation tracking
      const oldTriples = mem && typeof mem.search === "function" ? mem.search(null, null) : [];
      const oldKeys = new Set(oldTriples.map(tripleKey));
      const added = triples.filter((t) => !oldKeys.has(tripleKey(t)));
      const removed = oldTriples.filter((t) => !currentKeys.has(tripleKey(t)));

      // Rebuild HRR from scratch
      const newHrr = new HRRMemory();
      for (const { subject, relation, object } of triples) {
        newHrr.store(subject, relation, object);
      }

      // Preserve observations if available
      if (ObservationMemory) {
        const obsData = mem && typeof mem.toJSON === "function" ? mem.toJSON() : null;
        mem = obsData ? ObservationMemory.fromJSON(newHrr, obsData) : new ObservationMemory(newHrr);

        // Feed changes into timeline
        const ts = Date.now();
        for (const t of removed) {
          mem._timeline.append({ ts, subject: t.subject, relation: t.relation, object: t.object, op: "forget" });
          mem._meta.totalForgets++;
        }
        for (const { subject, relation, object } of added) {
          const flag = mem._conflict.check(subject, relation, object, ts);
          const entry = { ts, subject, relation, object, op: "store" };
          if (flag) {
            entry.conflict = { oldObject: flag.oldObject, similarity: flag.similarity };
            mem._flags.push(flag);
          }
          mem._timeline.append(entry);
          mem._conflict.track(subject, relation);
          mem._meta.totalStores++;
        }

        mem.save(INDEX_PATH, OBS_PATH);
      } else {
        mem = newHrr;
        mem.save(INDEX_PATH);
      }

      lastBuild = Date.now();
      return triples.length;
    }

    mem = initMem();
    rebuildIndex();

    // File watcher
    if (watchInterval > 0) {
      for (const f of MEMORY_FILES) {
        if (existsSync(f)) {
          watchFile(f, { interval: watchInterval }, () => {
            if (Date.now() - lastBuild > 10000) rebuildIndex();
          });
        }
      }
    }

    // ── Core Tools ──────────────────────────────────────────

    api.registerTool({
      name: "fact_lookup",
      description:
        "Look up structured facts from memory. Use FIRST for specific factual questions like 'What is X's Y?' Returns instant results (<2ms). For fuzzy/semantic search, use memory_search instead.",
      parameters: {
        type: "object",
        properties: {
          subject: { type: "string", description: "Entity to query (e.g., 'jounes', 'server', 'research')" },
          relation: {
            type: "string",
            description: "Attribute to look up (e.g., 'timezone', 'port'). Omit to list all facts about subject.",
          },
        },
        required: ["subject"],
      },
      async execute(_id, params) {
        if (Date.now() - lastBuild > 300000) rebuildIndex();
        const subject = (params.subject || "").toLowerCase().trim().replace(/\s+/g, "_");
        const relation = params.relation ? params.relation.toLowerCase().trim().replace(/\s+/g, "_") : null;

        if (relation) {
          const result = mem.query(subject, relation);
          const related = mem.querySubject(subject).slice(0, 8);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  { query: { subject, relation }, result: result.confident ? result.match : null, confidence: result.score, related_facts: related },
                  null,
                  2
                ),
              },
            ],
          };
        }
        const facts = mem.querySubject(subject);
        return { content: [{ type: "text", text: JSON.stringify({ query: { subject }, facts }, null, 2) }] };
      },
    });

    api.registerTool({
      name: "fact_ask",
      description:
        'Ask a natural language question against structured memory. Handles stop words, possessives, hyphens. Example: "What is Jounes\'s timezone?" Use when you don\'t know the exact subject/relation.',
      parameters: {
        type: "object",
        properties: {
          question: { type: "string", description: 'Natural language question (e.g., "What is alice\'s timezone?")' },
        },
        required: ["question"],
      },
      async execute(_id, params) {
        if (Date.now() - lastBuild > 300000) rebuildIndex();
        const result = mem.ask(params.question || "");
        return { content: [{ type: "text", text: JSON.stringify({ question: params.question, ...result }, null, 2) }] };
      },
    });

    api.registerTool({
      name: "fact_forget",
      description: "Remove a specific fact from memory. Use when a fact is wrong or outdated.",
      parameters: {
        type: "object",
        properties: {
          subject: { type: "string", description: "Entity" },
          relation: { type: "string", description: "Attribute" },
          object: { type: "string", description: "Value to remove" },
        },
        required: ["subject", "relation", "object"],
      },
      async execute(_id, params) {
        const removed = typeof mem.forget === "function"
          ? await mem.forget(params.subject, params.relation, params.object)
          : mem.forget(params.subject, params.relation, params.object);
        if (removed) {
          if (ObservationMemory) mem.save(INDEX_PATH, OBS_PATH);
          else mem.save(INDEX_PATH);
        }
        return { content: [{ type: "text", text: JSON.stringify({ removed, subject: params.subject, relation: params.relation, object: params.object }) }] };
      },
    });

    api.registerTool(
      {
        name: "fact_rebuild",
        description: "Force rebuild the fact index from MEMORY.md files.",
        parameters: { type: "object", properties: {}, required: [] },
        async execute() {
          const count = rebuildIndex();
          return { content: [{ type: "text", text: `Index rebuilt: ${count} facts.\n${JSON.stringify(mem.stats(), null, 2)}` }] };
        },
      },
      { optional: true }
    );

    // ── Observation Tools (only with hrr-memory-obs) ────────

    if (ObservationMemory) {
      api.registerTool({
        name: "fact_history",
        description: "View temporal history of stored/forgotten facts for a subject.",
        parameters: {
          type: "object",
          properties: {
            subject: { type: "string", description: "Entity to query" },
            relation: { type: "string", description: "Optional: filter to a specific relation" },
          },
          required: ["subject"],
        },
        async execute(_id, params) {
          const entries = mem.history(
            (params.subject || "").toLowerCase().trim().replace(/\s+/g, "_"),
            params.relation ? params.relation.toLowerCase().trim().replace(/\s+/g, "_") : undefined
          );
          return { content: [{ type: "text", text: JSON.stringify({ entries, count: entries.length }, null, 2) }] };
        },
      });

      api.registerTool({
        name: "fact_observations",
        description: "Read synthesized beliefs about how knowledge has evolved over time.",
        parameters: {
          type: "object",
          properties: {
            subject: { type: "string", description: "Optional: filter to a specific subject" },
          },
          required: [],
        },
        async execute(_id, params) {
          const subject = params.subject ? params.subject.toLowerCase().trim().replace(/\s+/g, "_") : undefined;
          const observations = mem.observations(subject);
          return { content: [{ type: "text", text: JSON.stringify({ observations, count: observations.length }, null, 2) }] };
        },
      });

      api.registerTool({
        name: "fact_flags",
        description: "Read unflushed conflict flags — belief changes waiting to be consolidated.",
        parameters: { type: "object", properties: {}, required: [] },
        async execute() {
          return { content: [{ type: "text", text: JSON.stringify({ flags: mem.flags(), count: mem.flags().length }, null, 2) }] };
        },
      });

      api.registerTool({
        name: "fact_observe_write",
        description: "Store a synthesized observation about belief changes.",
        parameters: {
          type: "object",
          properties: {
            subject: { type: "string", description: "Primary subject" },
            observation: { type: "string", description: "1-2 sentence synthesis of the change" },
            evidence: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  ts: { type: "number" },
                  triple: { type: "array", items: { type: "string" } },
                },
                required: ["ts", "triple"],
              },
            },
            confidence: { type: "string", enum: ["high", "medium", "low"] },
          },
          required: ["subject", "observation", "evidence", "confidence"],
        },
        async execute(_id, params) {
          const obs = mem.addObservation({
            subject: params.subject,
            observation: params.observation,
            evidence: params.evidence,
            confidence: params.confidence,
          });
          mem.clearFlags(obs.subject);
          mem.save(INDEX_PATH, OBS_PATH);
          return { content: [{ type: "text", text: JSON.stringify({ id: obs.id, stored: true, subject: obs.subject }) }] };
        },
      });
    }

    // ── System Prompt ───────────────────────────────────────

    api.on(
      "before_prompt_build",
      () => ({
        appendSystemContext: [
          "MEMORY TOOL PRIORITY:",
          "1. fact_lookup / fact_ask — USE FIRST for factual questions (who, what, where, which, when). Instant structured recall (<2ms).",
          "2. memory_search — USE SECOND for fuzzy, contextual, or open-ended queries.",
          "",
          "Available fact tools: fact_lookup, fact_ask, fact_forget" + (ObservationMemory ? ", fact_history, fact_observations" : ""),
        ].join("\n"),
      }),
      { priority: 5 }
    );
  },
});
