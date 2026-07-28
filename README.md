# Agent Action Inspector

See what your agent did, why, and **Approve / Deny** risky actions before they run.

Runs on **your machine only** — no account, no cloud, no database.

This project is **open source (MIT)**. Community contributions are welcome.

---

## Start here (recommended)

This support-desk example does **real work** on local files (read ticket → look up order → create portal link → send email → resolve ticket), then shows the run in the inspector.

### 0) One-time setup

```powershell
cd C:\Users\SYS\Desktop\agentinspector
pnpm install
pnpm --filter @agent-inspector/core build
pnpm --filter @agent-inspector/react build
```

### 1) Run the agent

```powershell
node examples/real-agent/run.mjs --scripted
```

### 2) Open the inspector

```powershell
pnpm --filter agent-inspector start -- --log examples/runs/support-desk-last.json --port 8811
```

Open **http://127.0.0.1:8811**

You should see the full timeline. Also check:

| Path | What changed |
|------|----------------|
| `examples/real-agent/outbox/` | Real portal + email files |
| `examples/real-agent/workspace/ticket-status.json` | Ticket marked `resolved` |

---

## Live Approve / Deny (real usage)

**Terminal A — start inspector**

```powershell
pnpm --filter agent-inspector start -- --live --port 8811
```

**Terminal B — run agent**

```powershell
$env:INSPECTOR_URL="http://127.0.0.1:8811"
node examples/real-agent/run.mjs --scripted --live
```

In the browser, when a risky tool appears (`create_portal_link`, `send_email`, `update_ticket_status`):

- **Approve** → agent continues and writes the file  
- **Deny** → agent stops; that side effect does not happen  

More detail: [`examples/real-agent/README.md`](examples/real-agent/README.md)

---

## What this product does

| Feature | Meaning |
|---------|---------|
| Trajectory timeline | Reasoning, tool calls, inputs/outputs |
| Replay | Open a past JSON run with `--log` |
| Live gate | Pause risky tools until a human decides |
| Embed | Drop `<AgentInspector />` into your React app |

---

## What it supports / what it doesn’t

### Built-in adapters (replay via `--log`)

| Adapter | Flag | Input shape |
|---------|------|-------------|
| **Auto-detect** | `--adapter auto` (default) | Sniffs the JSON and picks one below |
| **Generic** | `--adapter generic` | `{ "version": 1, "events": [...] }` |
| **LangGraph / LangChain** | `--adapter langgraph` | `{ "messages": [{ "type": "human\|ai\|tool", ... }] }` |
| **OpenAI Agents / Chat** | `--adapter openai` | `{ "messages": [{ "role", "tool_calls" }] }` or Responses `output` |
| **Vercel AI SDK** | `--adapter vercel-ai` | `{ "messages": [{ "parts": [...] }] }` or `{ "steps": [...] }` |

Try the samples:

```powershell
pnpm --filter agent-inspector start -- --log examples/openai-agents-run.json --port 8811
pnpm --filter agent-inspector start -- --log examples/vercel-ai-run.json --port 8812
pnpm --filter agent-inspector start -- --log examples/langgraph-messages.json --port 8813
```

### Also supported

| Area | Support |
|------|---------|
| **Custom Node / Python agents** | Yes — write generic events or POST `/api/ingest` |
| **Ollama tool-calling agents** | Yes — see `examples/real-agent` |
| **Live Approve / Deny** | Yes — `--live` + ingest API |
| **React embed** | Yes — `@agent-inspector/react` |
| **Offline localhost** | Yes — no account / cloud |

### Works with a thin export (no dedicated adapter yet)

| Stack | How |
|-------|-----|
| CrewAI, AutoGen, LlamaIndex, Semantic Kernel | Export to **generic** events or OpenAI-style messages |
| Any HTTP/CLI agent | Log file **or** `/api/ingest` |

### Not supported in v1

| Not included | Why |
|--------------|-----|
| Hosted / cloud SaaS | Local-only by design |
| Auth, users, teams | No accounts |
| Database / long-term storage | File-based replay |
| Analytics, cost tracking | Out of scope |
| Multi-agent graph visualization | Single-run timeline only |
| Mobile apps | Web / React only |

**Rule of thumb:** dump JSON your adapter understands, or emit the **generic** event schema — one UI for every stack.

---

## CLI flags

| Flag | What it does |
|------|----------------|
| `--log <file>` | Replay a run from JSON |
| `--adapter <name>` | `auto` (default) · `generic` · `langgraph` · `openai` · `vercel-ai` |
| `--live` | Accept live events + approval gate |
| `--port 8811` | Local port (change if busy) |
| `--no-open` | Don’t auto-open the browser |

If a port is busy (`EADDRINUSE`), pick another, e.g. `--port 8812`.

---

## Use with your own agent

### After a run (replay)

```powershell
pnpm --filter agent-inspector start -- --log .\my-run.json --adapter auto --port 8811
```

Or force a stack: `--adapter openai` / `--adapter vercel-ai` / `--adapter langgraph` / `--adapter generic`.

### During a run (live gate)

Start with `--live`, then from your tool wrapper:

```js
const res = await fetch("http://127.0.0.1:8811/api/ingest", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    event: "on_tool_start",
    data: { name: "send_email", id: "tc_1", input: { to: "a@b.co" } },
  }),
});
const { decision, paused } = await res.json();
if (paused && decision === "deny") throw new Error("Denied by operator");
```

Copy the helper used by the example: [`examples/real-agent/inspector-client.mjs`](examples/real-agent/inspector-client.mjs)

---

## Optional: Ollama LLM agent

Same tools, but the model chooses the steps:

```powershell
# needs: ollama serve + a model (e.g. llama3.2:1b)
$env:OLLAMA_MODEL="llama3.2:1b"
node examples/real-agent/run.mjs
```

Tiny models can skip steps. Prefer `--scripted` when you want a reliable demo.

Older invoice-only demo: `examples/ollama-agent/run.mjs`

---

## Embed in your React app

```bash
pnpm add @agent-inspector/react @agent-inspector/core
```

```tsx
import { AgentInspector } from "@agent-inspector/react";
import "@agent-inspector/react/styles.css";

<AgentInspector log={runLog} mode="replay" />
```

---

## Repo layout

```
packages/core     event schema + LangGraph adapter
packages/react    <AgentInspector /> UI
packages/cli      local dashboard (agent-inspector)
examples/real-agent   ← start here (support-desk agent)
examples/runs         saved trajectories
```

**Assumptions:** pnpm workspaces, package scope `@agent-inspector/*`, Node 18+.

---

## Community and contribution

- Contribution guide: [`CONTRIBUTING.md`](CONTRIBUTING.md)
- Code of Conduct: [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md)
- Issue templates: [`.github/ISSUE_TEMPLATE`](.github/ISSUE_TEMPLATE)
- PR template: [`.github/PULL_REQUEST_TEMPLATE.md`](.github/PULL_REQUEST_TEMPLATE.md)

If you want to help, a great first issue is:

- adapter improvements (`auto` detection, new framework mappings)
- tests for replay/live flows
- docs and starter integrations for real agents
- timeline UX polish

---

## Public roadmap (non-MVP direction)

### v1.1 (stability + adoption)

- expand adapter coverage (OpenAI/Vercel improvements, new stack exports)
- increase test coverage (adapter fixtures + live gate e2e)
- improve CLI config (`--adapter auto` behavior, better error messages)
- add more real integration examples (Python + JS)

### v1.2 (team workflows)

- richer approval policies (rule presets, per-tool/per-risk policies)
- approval metadata (who approved, reason/comment, timestamp UI polish)
- improved replay filtering/search and run comparisons

### v2.0 (team-ready platform surface)

- optional shared self-hosted service mode (still keep local-first mode)
- RBAC-style approval roles
- stronger audit exports and compliance-friendly reporting

---

## License

MIT
