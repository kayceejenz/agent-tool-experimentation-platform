# Agent Tool Experiment Platform

A platform for connecting MCP servers, inspecting and testing tools, evaluating agent configurations, and promoting tested configurations into assistants.

## Get Started

### Server

In a separate terminal:

```sh
cd apps/server
uv sync --locked
cp .env.example .env
uv run --locked agent-platform-api
```

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

Stop the development process before starting production preview on the same port.
