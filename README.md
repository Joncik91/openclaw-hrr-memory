# openclaw-hrr-memory

Structured fact recall for [OpenClaw](https://openclaw.ai) agents using [Holographic Reduced Representations](https://github.com/Joncik91/hrr-memory).

RAG handles 80% of memory queries. The other 20% — exact fact recall like "What is Alice's timezone?" — is where it struggles. This plugin fills that gap with instant <2ms structured lookups, zero dependencies, no embeddings API.

## Install

```bash
openclaw plugins install openclaw-hrr-memory
```

## What It Does

Parses your agent's MEMORY.md into `(subject, relation, object)` triples and stores them in an HRR index. Agents query facts instantly instead of searching through document chunks.

| Question type | Tool | Speed |
|---------------|------|-------|
| "What is Jounes's timezone?" | `fact_lookup` | <2ms |
| "Where does Alice work?" | `fact_ask` | <2ms |
| "What did we discuss about deployment?" | `memory_search` | ~200ms |

## Tools

| Tool | Description |
|------|-------------|
| `fact_lookup` | Structured subject+relation query. Use first for factual questions. |
| `fact_ask` | Natural language with stop word handling. |
| `fact_forget` | Remove outdated facts. |
| `fact_rebuild` | Force reindex from MEMORY.md. |

The plugin tells the agent to try `fact_lookup` before `memory_search` for direct questions via system prompt injection.

## Configuration

In your OpenClaw config (`~/.openclaw/openclaw.json`):

```json
{
  "plugins": {
    "entries": {
      "hrr-memory": {
        "config": {
          "memoryFiles": ["~/.openclaw/workspace/MEMORY.md"],
          "watchInterval": 30000
        }
      }
    }
  }
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `memoryFiles` | Workspace MEMORY.md | Paths to MEMORY.md files to index |
| `watchInterval` | `30000` | File watcher interval (ms). `0` to disable. |
| `enableObservations` | `false` | Enable belief change tracking (requires hrr-memory-obs) |

## Observation Layer (Optional)

Track how facts change over time with [hrr-memory-obs](https://github.com/Joncik91/hrr-memory-obs):

```bash
cd ~/.openclaw/extensions/openclaw-hrr-memory
npm install hrr-memory-obs
```

Then enable in config:

```json
{
  "plugins": {
    "entries": {
      "hrr-memory": {
        "config": {
          "enableObservations": true
        }
      }
    }
  }
}
```

This adds four tools:

| Tool | Description |
|------|-------------|
| `fact_history` | Temporal changelog for a subject |
| `fact_observations` | Synthesized beliefs about knowledge changes |
| `fact_flags` | Unflushed conflict flags |
| `fact_observe_write` | Store observation about belief changes |

Every MEMORY.md edit is diffed against the previous state. Changed facts are recorded in a timeline, and conflicting values (e.g., timezone changed from UTC to CET) are automatically flagged.

## How MEMORY.md Is Parsed

The parser extracts triples from markdown key-value patterns:

```markdown
## server
- **port**: 8080
- **timezone**: CET

## jounes
- **role**: developer
- **prefers**: concise answers, dark mode
```

Becomes:
- `(server, port, 8080)` — `fact_lookup subject="server" relation="port"` → `8080`
- `(jounes, role, developer)` — `fact_ask "What is Jounes's role?"` → `developer`

The `##` heading becomes the subject. Key-value lines become relations and objects.

## Links

- [hrr-memory](https://github.com/Joncik91/hrr-memory) — standalone HRR library
- [hrr-memory-obs](https://github.com/Joncik91/hrr-memory-obs) — observation layer
- [Architecture](https://github.com/Joncik91/hrr-memory/blob/main/docs/architecture.md) — how HRR works

## License

MIT
