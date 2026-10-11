# Agent Tool Experiment Platform

An agent and tool experimentation and evaluation platform for exploring MCP tools, testing them manually, and building versioned agents with MCP connectors and language models.

The core workflow is to:

- Connect MCP servers and discover their available tools and input schemas.
- Test tools manually and inspect their inputs, outputs, and execution history.
- Build versioned agents with prompts, selected MCP tools, model settings, and execution limits.
- Run experiments and inspect execution traces to understand tool use and agent behavior.
- Evaluate agent configurations and use the findings to refine subsequent versions.

## Get Started

### Server

In a separate terminal:

```sh
cd apps/server
uv sync --locked
cp -n .env.example .env

uv run --locked agent-platform-api
```

### Execution worker

In a separate terminal, from the repository root:

```sh
cd apps/server
uv sync --locked
uv run --locked agent-platform-worker
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
