# Setup

## Install

```bash
openclaw plugins install openclaw-hrr-memory
```

Restart the gateway:

```bash
systemctl --user restart openclaw-gateway
```

## Configuration

In `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "entries": {
      "hrr-memory": {
        "enabled": true,
        "config": {
          "memoryFiles": ["~/.openclaw/workspace/MEMORY.md"],
          "watchInterval": 30000,
          "enableObservations": false
        }
      }
    }
  }
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `memoryFiles` | Workspace MEMORY.md | Paths to MEMORY.md files to index |
| `watchInterval` | `30000` | File watcher interval (ms). `0` to disable auto-rebuild. |
| `enableObservations` | `false` | Enable belief change tracking (requires `hrr-memory-obs`) |

## Enabling the Observation Layer

Install the optional dependency:

```bash
cd ~/.openclaw/extensions/hrr-memory
npm install hrr-memory-obs
```

Set `enableObservations: true` in config and restart the gateway. This adds 4 extra tools (`fact_history`, `fact_observations`, `fact_flags`, `fact_observe_write`) and records MEMORY.md changes in a timeline with automatic conflict detection.

## Multiple Agents

To index MEMORY.md from multiple agent workspaces:

```json
{
  "config": {
    "memoryFiles": [
      "~/.openclaw/workspace/MEMORY.md",
      "~/.openclaw/workspace-worker/MEMORY.md"
    ]
  }
}
```

## Verify

After restarting the gateway, your agent should have `fact_lookup` and `fact_ask` available. Test by asking a factual question that's in your MEMORY.md.
