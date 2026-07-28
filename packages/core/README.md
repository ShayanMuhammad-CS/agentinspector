# @kashifmuhammad/agent-inspector-core

Event schema, LangGraph adapter, and approval helpers shared by the CLI and React package.

```ts
import {
  adaptLangGraphLog,
  classifyRisk,
  requiresApproval,
  MOCK_RUN,
} from "@kashifmuhammad/agent-inspector-core";

const log = adaptLangGraphLog({ messages: [...] });
```

