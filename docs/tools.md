# Tools Reference

## Core Tools

Always available when the plugin is installed.

### fact_lookup

Structured subject+relation query. Use for direct factual questions.

```
fact_lookup subject="server" relation="port"
→ { result: "8080", confidence: 0.97 }

fact_lookup subject="jounes"
→ { facts: [{ relation: "timezone", object: "cet" }, { relation: "role", object: "developer" }] }
```

**Parameters:**
- `subject` (required) — entity to query
- `relation` (optional) — attribute to look up. Omit to list all facts about the subject.

### fact_ask

Natural language query with automatic stop word removal, possessive handling, and hyphen normalization.

```
fact_ask question="What is Jounes's timezone?"
→ { type: "direct", match: "cet", confident: true }

fact_ask question="Where does Alice work?"
→ { type: "direct", match: "acme", confident: true }
```

**Parameters:**
- `question` (required) — natural language question

### fact_forget

Remove a specific fact.

```
fact_forget subject="server" relation="port" object="8080"
→ { removed: true }
```

**Parameters:**
- `subject` (required)
- `relation` (required)
- `object` (required)

### fact_rebuild

Force reindex from all configured MEMORY.md files. Runs automatically via file watcher, but can be triggered manually.

```
fact_rebuild
→ "Index rebuilt: 42 facts."
```

## Observation Tools

Available when `enableObservations: true` and `hrr-memory-obs` is installed.

### fact_history

View the temporal changelog for a subject — every store and forget event.

```
fact_history subject="jounes"
→ { entries: [
    { ts: 1711234567890, subject: "jounes", relation: "timezone", object: "utc", op: "store" },
    { ts: 1711334567890, subject: "jounes", relation: "timezone", object: "cet", op: "store",
      conflict: { oldObject: "utc", similarity: 0.05 } }
  ] }
```

### fact_observations

Read synthesized beliefs about how knowledge has evolved.

```
fact_observations subject="jounes"
→ { observations: [
    { id: "obs_1", subject: "jounes", observation: "Timezone changed from UTC to CET",
      confidence: "high", createdAt: 1711434567890 }
  ] }
```

### fact_flags

Check for unflushed conflict flags — belief changes waiting to be consolidated.

```
fact_flags
→ { flags: [{ subject: "jounes", relation: "timezone", oldObject: "utc", newObject: "cet" }], count: 1 }
```

### fact_observe_write

Store a synthesized observation. Typically called by a consolidation agent after reviewing flags.

```
fact_observe_write subject="jounes" observation="Timezone changed from UTC to CET" evidence=[...] confidence="high"
→ { id: "obs_2", stored: true }
```
