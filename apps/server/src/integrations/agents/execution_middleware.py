"""Record model/tool steps and enforce execution budgets."""

import asyncio
from uuid import UUID, uuid5

from langchain.agents.middleware import AgentMiddleware
from langchain_core.messages import AIMessage, ToolMessage
from modules.mcp_servers.models.error_model import McpConnectionError
from modules.tools.dtos.tool_request_dto import ExecuteToolRequest
from pydantic import ValidationError

from integrations.agents.runtime_errors import RuntimeStop, model_failure
from integrations.agents.runtime_messages import (
    compact_json,
    model_tool_result,
    visible_text,
)

# Character ceilings bound payload growth; these are not token estimates.
MAX_TOOL_CONTEXT_CHARS = 24_000
MAX_MESSAGE_CONTEXT_CHARS = 100_000


class ExecutionMiddleware(AgentMiddleware):
    def __init__(self, run, repository, executor, secret=None):
        self.secret = secret
        self.run, self.repository, self.executor = run, repository, executor
        self.limits = run["snapshot"]["limits"]
        self.allowed_tools = {tool["alias"]: tool for tool in run["snapshot"]["tools"]}
        self.schema_context_chars = sum(
            len(compact_json(tool["definition"]))
            + len(tool["alias"])
            + len(tool["server_name"])
            + len(tool["name"])
            for tool in run["snapshot"]["tools"]
        )
        self.turns = self.calls = 0
        self.model_span = None
        self.context_spans = []
        self.seen_calls = set()
        self.stop_reason = None
        self.tool_lock = asyncio.Lock()

    async def check(self):
        if self.stop_reason:
            raise RuntimeStop(self.stop_reason)
        if await self.repository.check(self.run):
            raise RuntimeStop("cancelled")

    async def awrap_model_call(self, request, handler):
        await self.check()
        if self.turns >= self.limits["max_turns"]:
            raise RuntimeStop("max_turns")
        # Preserve complete tool-call pairs and lineage; never silently trim evidence.
        context_size = self.schema_context_chars + sum(
            len(compact_json(message.model_dump())) for message in request.messages
        )
        system = getattr(request, "system_message", None)
        if system is not None:
            context_size += len(compact_json(system.model_dump()))
        if context_size > MAX_MESSAGE_CONTEXT_CHARS:
            raise RuntimeStop("context_limit")
        self.turns += 1
        self.model_context = list(self.context_spans)
        span = await self.repository.begin_span(
            self.run["id"],
            kind="model",
            name=f"Model turn {self.turns}",
            context_span_ids=self.model_context,
            inputs={
                "message_count": len(request.messages),
                "strategy": "react",
                "remaining_model_turns": self.limits["max_turns"] - self.turns,
                "remaining_tool_calls": self.limits["max_tool_calls"] - self.calls,
                "model_settings": self.run["snapshot"]["model_settings"],
            },
        )
        self.model_span = span
        try:
            response = await handler(request)
            messages = [
                message for message in response.result if isinstance(message, AIMessage)
            ]
            # Usage is stored separately from general redaction so token counters survive.
            outputs = [
                {
                    "text": visible_text(m),
                    "tool_calls": m.tool_calls,
                    "usage": {
                        "input_count": (m.usage_metadata or {}).get("input_tokens"),
                        "output_count": (m.usage_metadata or {}).get("output_tokens"),
                    },
                }
                for m in messages
            ]
            await self.repository.end_span(span, "success", outputs)
            return response
        except asyncio.CancelledError:
            await self.repository.end_span(span, "unknown", error_code="interrupted")
            raise
        except Exception as error:
            category, details = model_failure(error)
            await self.repository.end_span(
                span, "error", outputs=details, error_code=category
            )
            raise RuntimeStop(category) from None

    async def awrap_tool_call(self, request, handler):
        # LangChain may dispatch a batch concurrently; serialize admission and execution.
        async with self.tool_lock:
            await self.check()
            call = request.tool_call
            if self.calls >= self.limits["max_tool_calls"]:
                raise RuntimeStop("max_tool_calls")
            if call["id"] in self.seen_calls:
                raise RuntimeStop("duplicate_call_id")
            self.seen_calls.add(call["id"])
            self.calls += 1
            tool = self.allowed_tools.get(call["name"])
            span = await self.repository.begin_span(
                self.run["id"],
                kind="tool",
                parent_id=self.model_span,
                name=(tool["server_name"] + " / " + tool["name"])
                if tool
                else call["name"],
                call_id=call["id"],
                executor_request_id=uuid5(self.run["id"], call["id"]) if tool else None,
                tool_id=UUID(tool["id"]) if tool else None,
                tool_revision=tool["revision"] if tool else None,
                context_span_ids=self.model_context,
                inputs=call["args"],
            )
            try:
                if not tool:
                    result = {"status": "invalid", "error_code": "tool_not_allowed"}
                else:
                    body = ExecuteToolRequest(
                        revision=tool["revision"],
                        arguments=call["args"],
                        request_id=uuid5(self.run["id"], call["id"]),
                    )
                    execution = await self.executor.execute(
                        self.run["user_id"],
                        self.run["project_id"],
                        UUID(tool["id"]),
                        body,
                    )
                    result = {
                        "status": execution["status"],
                        "result": execution.get("result"),
                        "error_code": execution.get("error_code"),
                    }
                    await self.repository.end_span(
                        span,
                        execution["status"],
                        result,
                        execution.get("error_code"),
                        execution["id"],
                    )
                    self.context_spans.append(span)
                    if execution["status"] in ("unknown", "running"):
                        self.stop_reason = "unknown_tool_outcome"
                        raise RuntimeStop("unknown_tool_outcome")
                    content = model_tool_result(result, self.secret)
                    if len(content) > MAX_TOOL_CONTEXT_CHARS:
                        self.stop_reason = "tool_result_too_large"
                        raise RuntimeStop(self.stop_reason)
                    if hasattr(self.repository, "record_observation"):
                        await self.repository.record_observation(span, content)
                    return ToolMessage(
                        content=content,
                        tool_call_id=call["id"],
                        status="success"
                        if execution["status"] == "success"
                        else "error",
                    )
            except McpConnectionError as error:
                result = {
                    "status": "invalid" if error.status == 422 else "blocked",
                    "error_code": "invalid_arguments"
                    if error.status == 422
                    else "tool_unavailable",
                }
                if error.status != 422:
                    self.stop_reason = "tool_unavailable"
                    await self.repository.end_span(
                        span, "blocked", result, result["error_code"]
                    )
                    raise RuntimeStop("tool_unavailable") from None
            except ValidationError:
                result = {"status": "invalid", "error_code": "invalid_arguments"}
            except RuntimeStop:
                raise
            except asyncio.CancelledError:
                self.stop_reason = "interrupted"
                await self.repository.end_span(
                    span, "unknown", error_code="interrupted"
                )
                raise
            except Exception:
                await self.repository.end_span(
                    span, "error", error_code="executor_error"
                )
                raise
            await self.repository.end_span(
                span, result["status"], result, result["error_code"]
            )
            self.context_spans.append(span)
            content = model_tool_result(result, self.secret)
            if hasattr(self.repository, "record_observation"):
                await self.repository.record_observation(span, content)
            return ToolMessage(
                content=content,
                tool_call_id=call["id"],
                status="error",
            )
