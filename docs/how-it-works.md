# How It Works

## MEMORY.md Parsing

The plugin parses structured markdown into `(subject, relation, object)` triples.

### Key-Value Pattern

The primary pattern: `##` headings become subjects, `- **key**: value` lines become facts.

```markdown
## server
- **port**: 8080
- **timezone**: CET
- **model**: zai/glm-5

## jounes
- **role**: developer
- **prefers**: concise answers, dark mode
```

Produces:
- `(server, port, 8080)`
- `(server, timezone, cet)`
- `(server, model, zai/glm-5)`
- `(jounes, role, developer)`
- `(jounes, prefers, concise_answers)`
- `(jounes, prefers, dark_mode)`

### Rules

- Subjects are `##` headings, lowercased, special chars replaced with `_`
- Relations are the key before `:`, lowercased
- Objects are values after `:`, lowercased, max 80 chars
- Comma-separated values in `prefers` lines produce multiple triples
- Lines starting with `#`, `{`, `"`, or `` ``` `` are skipped
- Session metadata (session keys, message IDs, timestamps) is filtered out

## Auto-Rebuild

A file watcher polls each configured MEMORY.md at the configured interval (default 30s). When a file changes, the index rebuilds automatically.

Additionally, each tool call checks if the index is older than 5 minutes and triggers a rebuild if needed.

## Diff-Based Observation Tracking

When `enableObservations` is on, rebuilds are diff-aware:

1. Collect current triples from MEMORY.md files
2. Compare against what's stored in the HRR index
3. New triples → `store` timeline events
4. Missing triples → `forget` timeline events
5. Changed values for same `(subject, relation)` → conflict flags

This feeds the observation pipeline without requiring agents to call specific tools.

## System Prompt Injection

The plugin injects a priority hint into the agent's system prompt:

```
MEMORY TOOL PRIORITY:
1. fact_lookup / fact_ask — USE FIRST for factual questions
2. memory_search — USE SECOND for fuzzy or contextual queries
```

This guides agents to try structured recall before falling back to RAG.

## Storage

| File | Location | Contents |
|------|----------|----------|
| `hrr-index.json` | Plugin state dir | HRR vectors, symbols, triples |
| `observations.json` | Plugin state dir | Timeline, conflict flags, synthesized observations |

Both files are updated atomically on rebuild and tool calls that modify state.
