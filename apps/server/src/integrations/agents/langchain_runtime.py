"""Build and run the LangChain agent using controlled tool middleware."""

import asyncio

from langchain.agents import create_agent
from langchain_core.tools import StructuredTool
from langchain_openai import ChatOpenAI
from langsmith import tracing_context
from modules.agents.models.error_model import AgentError

from integrations.agents.execution_middleware import ExecutionMiddleware
from integrations.agents.model_provider import configured_secrets, provider_options
from integrations.agents.runtime_errors import RuntimeStop
from integrations.agents.runtime_messages import runtime_instructions, visible_text


async def blocked_dispatch(**kwargs):
    raise RuntimeError("Tools must be dispatched through execution middleware")


class LangChainRuntime:
    def __init__(self, repository, executor, settings, model_factory=None):
        self.repository, self.executor, self.settings = repository, executor, settings
        self.model_factory = model_factory

    def model(self, snapshot):
        if self.model_factory:
            return self.model_factory(snapshot)
        config = snapshot["model_settings"]
        try:
            options = provider_options(self.settings, config["provider"].lower())
        except ValueError:
            raise RuntimeStop("provider_not_configured") from None
        kwargs = {
            "model": config["model"],
            **options,
            "max_tokens": snapshot["limits"]["max_output_tokens"],
            "max_retries": 0,
            "timeout": snapshot["limits"]["timeout_seconds"],
        }
        if config.get("temperature") is not None:
            kwargs["temperature"] = config["temperature"]
        return ChatOpenAI(
            **kwargs,
            model_kwargs={"parallel_tool_calls": False}
            if config["provider"].lower() == "openai"
            else {},
        )

    async def execute(self, run):
        status, reason, answer = "failed", "runtime_error", None
        try:
            snapshot = run["snapshot"]
            middleware = ExecutionMiddleware(
                run,
                self.repository,
                self.executor,
                configured_secrets(self.settings),
            )
            tools = [
                StructuredTool(
                    name=tool["alias"],
                    description=f"{tool['server_name']}: {tool['name']}. "
                    + (tool["definition"].get("description") or ""),
                    args_schema=tool["definition"]["input_schema"],
                    coroutine=blocked_dispatch,
                )
                for tool in snapshot["tools"]
            ]
            instructions = snapshot.get("runtime_instructions") or runtime_instructions(
                snapshot
            )
            agent = create_agent(
                self.model(snapshot),
                tools=tools,
                system_prompt=instructions,
                middleware=[middleware],
            )
            with tracing_context(enabled=False):
                async with asyncio.timeout(snapshot["limits"]["timeout_seconds"]):
                    result = await agent.ainvoke(
                        {"messages": [{"role": "user", "content": run["input"]}]},
                        config={
                            "recursion_limit": 2 * snapshot["limits"]["max_turns"] + 10
                        },
                    )
            await middleware.check()
            message = result["messages"][-1]
            answer = visible_text(message)
            status, reason = "completed", "final_answer"
        except RuntimeStop as error:
            reason = error.reason
            status = "cancelled" if reason == "cancelled" else "failed"
        except TimeoutError:
            reason = "timeout"
        except asyncio.CancelledError:
            reason = run.get("_worker_stop", "worker_interrupted")
            status = (
                "cancelled"
                if reason == "cancelled"
                else "failed"
                if reason == "access_revoked"
                else "interrupted"
            )
        except AgentError:
            reason = "access_revoked"
        except Exception:
            # Provider exceptions can contain request data or credentials.
            reason = "runtime_error"
        await self.repository.finish(run["id"], status, reason, answer)
