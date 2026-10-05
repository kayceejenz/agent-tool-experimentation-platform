# Agent Tool Experiment Platform

A platform for connecting MCP servers, inspecting and testing tools, evaluating agent configurations, and promoting tested configurations into assistants.

## Get Started

### Server

In a separate terminal:

```sh
cd apps/server
uv sync --locked
cp -n .env.example .env

uv run --locked agent-platform-api
```

### Database migrations

From `apps/server`:

```sh
uv run --locked agent-platform-migrate --status
uv run --locked agent-platform-migrate
```

### Ecommerce MCP server

In a separate terminal, from the repository root:

```sh
cd apps/mcps/ecommerce
uv sync --locked
uv run --locked ecommerce-mcp
```

The MCP endpoint is `http://127.0.0.1:8012/mcp` (Streamable HTTP, no authentication for the local demo).

### Web client

```sh
cd apps/web-client
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm dev
```

Checks and production preview:

```sh
pnpm lint
pnpm typecheck
pnpm build
pnpm start
```

### Manual tool testing

1. Start the API, web client, and ecommerce MCP server above.
2. In a project, add the MCP endpoint under **MCP Servers**, then open **Manage → Discover**.
3. Enable the MCP server. Open **Tools** and enable the tool you want to test.
4. Choose **Manage**, enter inputs using the form or JSON editor, and select **Run tool**.

Discovery saves tool definitions and revisions. New or changed tools start disabled; rediscover after changing an endpoint or credential. Manual test history saves the revision, redacted inputs/results, status, and duration. A timeout can have an unknown remote outcome—check the history and remote records before repeating a write.

### Prompt management

Open **Prompts** within a project to create System, Agent, or Evaluation prompts. Use **Manage** to edit instructions or inspect revision history. A prompt's type is fixed; edits to its name, description, or instructions create a new immutable revision. Owners and editors can save changes; viewers can inspect prompts and history. Concurrent edits require reloading the latest revision before saving.

This increment manages prompt definitions. Selecting revisions for agents and running evaluations will be added in their respective milestones.

The ecommerce experiment starter prompts are maintained in `apps/mcps/ecommerce/prompts/`: `system.md` defines shared rules, `agent.md` describes the MCP workflows, and `evaluation.md` defines a trace-based assessment rubric. They are editable after being saved in the prompt library; evaluation execution belongs to the later evaluation milestone.

To add this set to a project, run from `apps/server` with the project's UUID and an owner/editor's user UUID:

```sh
uv run --locked python scripts/seed_ecommerce_prompts.py --project <project-uuid> --actor <user-uuid>
```

This explicit seed operation creates revision 1 once. Re-running it preserves existing prompts and edits; it does not automatically update saved prompts when the source files change.
