# Support-desk agent (start here)

Small agent that processes **TICKET-1001** using real local files — the same pattern you’d use in production with Agent Action Inspector.

## Steps it takes

1. Read ticket file  
2. Look up order in `orders.json`  
3. Create portal link → writes `outbox/`  
4. Send email → writes `outbox/`  
5. Mark ticket `resolved` → updates `ticket-status.json`  

Risky steps (3–5) need **Approve** in live mode.

---

## Quick test (replay)

```powershell
node examples/real-agent/run.mjs --scripted

pnpm --filter agent-inspector start -- --log examples/runs/support-desk-last.json --port 8811
```

Open http://127.0.0.1:8811

---

## Live Approve / Deny

**Terminal A**

```powershell
pnpm --filter agent-inspector start -- --live --port 8811
```

**Terminal B**

```powershell
$env:INSPECTOR_URL="http://127.0.0.1:8811"
node examples/real-agent/run.mjs --scripted --live
```

Click **Approve** or **Deny** in the UI when prompted.

---

## Flags

| Flag | Meaning |
|------|---------|
| `--scripted` | Fixed workflow (reliable — use this first) |
| `--live` | Stream to inspector + pause on risky tools |
| `--ticket=TICKET-1001` | Which ticket to process |

## Env

| Variable | Default |
|----------|---------|
| `INSPECTOR_URL` | `http://127.0.0.1:8811` |
| `OLLAMA_MODEL` | `llama3.2:1b` (only if you omit `--scripted`) |

---

## Wire this into your own agent

See `inspector-client.mjs`:

```js
const decision = await inspector.beforeTool(name, id, args);
if (decision === "deny") throw new Error("denied");
const result = await yourRealTool(args);
await inspector.afterTool(name, id, result);
```
