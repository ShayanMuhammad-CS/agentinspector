# Contributing to Agent Action Inspector

Thanks for helping improve Agent Action Inspector.

## Project goals

- Keep the core fast and local-first.
- Keep the UX clear for trajectory replay + approval gating.
- Prefer small, focused pull requests.

## What to work on

Good first contributions:

- New adapters (`openai`, `vercel-ai`, `generic`, `langgraph` improvements)
- Tests for adapters and live approval flows
- Docs and examples for real agents
- UI polish for timeline readability and risk visibility

Please open an issue before large changes.

## Local setup

```powershell
pnpm install
pnpm -r run build
pnpm -r run typecheck
```

Run the real example:

```powershell
node examples/real-agent/run.mjs --scripted
pnpm --filter agent-inspector start -- --log examples/runs/support-desk-last.json --port 8811
```

## Development workflow

1. Fork and create a branch from `main`.
2. Make focused changes.
3. Run checks locally:

```powershell
pnpm -r run typecheck
pnpm -r run build
```

4. Update docs if behavior changes.
5. Open a PR with context and test notes.

## Code guidelines

- Use TypeScript strict types where possible.
- Reuse `@agent-inspector/core`; avoid duplicating adapter logic in CLI/UI.
- Keep backward compatibility for event schema and CLI flags when possible.
- Prefer explicit, readable code over clever abstractions.

## Commit style

Use clear, imperative messages, for example:

- `add openai adapter auto-detection tests`
- `fix cli adapter flag parsing with pnpm forwarding`

## Reporting bugs

When filing issues, include:

- OS + Node version
- command run
- log/input sample (redacted)
- expected vs actual result

Use the bug issue template for consistency.

## Security

Do not post secrets in issues or PRs.
If you find a serious vulnerability, open a private disclosure channel first (to be added in SECURITY.md).

## License

By contributing, you agree your contributions are licensed under the MIT License.
