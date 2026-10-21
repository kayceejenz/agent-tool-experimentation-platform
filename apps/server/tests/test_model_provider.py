import pytest
from core.settings import Settings
from integrations.agents.model_provider import (
    GOOGLE_BASE_URL,
    configured_secrets,
    provider_for_model,
    provider_options,
)
from integrations.agents.langchain_runtime import LangChainRuntime
from modules.tools.helpers.validation import redact, redact_text


def test_provider_credentials_are_isolated_and_missing_keys_do_not_fallback():
    settings = Settings(
        _env_file=None, openai_api_key="openai-fixture", google_api_key="google-fixture"
    )
    assert provider_options(settings, "google")["base_url"] == GOOGLE_BASE_URL
    assert (
        provider_options(settings, "google")["api_key"].get_secret_value()
        == "google-fixture"
    )
    assert "base_url" not in provider_options(settings, "openai")
    with pytest.raises(ValueError):
        provider_options(Settings(_env_file=None, openai_api_key="fixture"), "google")
    assert provider_for_model("gemini-2.5-flash") == "google"
    secrets = configured_secrets(settings)
    assert (
        redact_text("openai-fixture google-fixture", secrets) == "[redacted] [redacted]"
    )
    assert redact({"message": "google-fixture"}, secrets) == {"message": "[redacted]"}


def test_google_runtime_uses_native_adapter_and_google_key():
    settings = Settings(_env_file=None, google_api_key="google-fixture")
    model = LangChainRuntime(None, None, settings).model(
        {
            "model_settings": {
                "provider": "google",
                "model": "gemini-2.5-flash",
                "temperature": None,
            },
            "limits": {"max_output_tokens": 2048, "timeout_seconds": 60},
        }
    )
    from langchain_google_genai import ChatGoogleGenerativeAI

    assert isinstance(model, ChatGoogleGenerativeAI)
    assert model.google_api_key.get_secret_value() == "google-fixture"
    assert model.max_output_tokens == 2048
    assert model.timeout == 60
    assert model.max_retries == 0


@pytest.mark.parametrize(
    "provider,model_name,endpoint",
    [
        ("anthropic", "claude-haiku-4-5-20251001", "https://api.anthropic.com/v1/"),
        ("ollama", "qwen3:4b", "http://127.0.0.1:11434/v1/"),
    ],
)
def test_small_model_routes_and_tool_binding(provider, model_name, endpoint):
    settings = Settings(_env_file=None, anthropic_api_key="anthropic-fixture")
    model = LangChainRuntime(None, None, settings).model(
        {
            "model_settings": {
                "provider": provider,
                "model": model_name,
                "temperature": None,
            },
            "limits": {"max_output_tokens": 2048, "timeout_seconds": 60},
        }
    )
    assert model.openai_api_base == endpoint
    assert model.use_responses_api is False
    expected_key = "anthropic-fixture" if provider == "anthropic" else "ollama"
    assert model.openai_api_key.get_secret_value() == expected_key
    assert "parallel_tool_calls" not in model.model_kwargs
    bound = model.bind_tools(
        [
            {
                "name": "sales",
                "description": "Sales",
                "parameters": {
                    "type": "object",
                    "properties": {"month": {"type": "integer"}},
                },
            }
        ]
    )
    assert bound.kwargs["tools"][0]["function"]["name"] == "sales"
    assert provider_for_model(model_name) == provider


def test_anthropic_key_cannot_fall_back_to_openai_and_is_redacted():
    with pytest.raises(ValueError):
        provider_options(
            Settings(_env_file=None, openai_api_key="fixture"), "anthropic"
        )
    settings = Settings(
        _env_file=None,
        anthropic_api_key="anthropic-fixture",
        ollama_api_key="ollama-fixture",
        ollama_base_url="http://localhost:11434/v1/",
    )
    assert (
        provider_options(settings, "ollama")["api_key"].get_secret_value()
        == "ollama-fixture"
    )
    assert (
        provider_options(settings, "ollama")["base_url"] == "http://localhost:11434/v1/"
    )
    assert (
        redact_text("anthropic-fixture ollama-fixture", configured_secrets(settings))
        == "[redacted] [redacted]"
    )


@pytest.mark.parametrize(
    "provider,model_name",
    [("anthropic", "claude-haiku-4-5-20251001"), ("ollama", "qwen3:4b")],
)
def test_compatibility_tool_calls_and_usage_with_mocked_http(
    provider, model_name, monkeypatch
):
    import asyncio
    import json
    import httpx
    from langchain_openai import ChatOpenAI

    async def exercise():
        def respond(request):
            payload = json.loads(request.content)
            assert request.url.path == "/v1/chat/completions"
            assert payload["model"] == model_name
            assert payload["tools"][0]["function"]["name"] == "sales"
            assert request.headers["authorization"] == (
                "Bearer anthropic-fixture"
                if provider == "anthropic"
                else "Bearer ollama"
            )
            return httpx.Response(
                200,
                json={
                    "id": "chatcmpl-fixture",
                    "object": "chat.completion",
                    "created": 1,
                    "model": model_name,
                    "choices": [
                        {
                            "index": 0,
                            "finish_reason": "tool_calls",
                            "message": {
                                "role": "assistant",
                                "content": "",
                                "tool_calls": [
                                    {
                                        "id": "call-fixture",
                                        "type": "function",
                                        "function": {
                                            "name": "sales",
                                            "arguments": '{"month":10}',
                                        },
                                    }
                                ],
                            },
                        }
                    ],
                    "usage": {
                        "prompt_tokens": 12,
                        "completion_tokens": 4,
                        "total_tokens": 16,
                    },
                },
            )

        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            monkeypatch.setattr(
                "integrations.agents.langchain_runtime.ChatOpenAI",
                lambda **kwargs: ChatOpenAI(**kwargs, http_async_client=client),
            )
            model = LangChainRuntime(
                None,
                None,
                Settings(_env_file=None, anthropic_api_key="anthropic-fixture"),
            ).model(
                {
                    "model_settings": {"provider": provider, "model": model_name},
                    "limits": {"max_output_tokens": 2048, "timeout_seconds": 60},
                }
            )
            answer = await model.bind_tools(
                [
                    {
                        "name": "sales",
                        "description": "Sales",
                        "parameters": {
                            "type": "object",
                            "properties": {"month": {"type": "integer"}},
                        },
                    }
                ]
            ).ainvoke("Find October sales")
            assert answer.tool_calls[0]["args"] == {"month": 10}
            assert answer.usage_metadata["input_tokens"] == 12

    asyncio.run(exercise())


@pytest.mark.parametrize(
    "url", ["", "/v1", "ftp://localhost/v1", "http://user:password@localhost/v1"]
)
def test_invalid_ollama_urls_are_rejected(url):
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        Settings(_env_file=None, ollama_base_url=url)


def test_native_gemini_preserves_signature_in_agent_tool_loop(monkeypatch):
    import asyncio
    from google.genai import types
    from langchain.agents import create_agent
    from langchain_core.tools import StructuredTool

    settings = Settings(_env_file=None, google_api_key="google-fixture")
    model = LangChainRuntime(None, None, settings).model(
        {
            "model_settings": {"provider": "google", "model": "gemini-3.5-flash-lite"},
            "limits": {"max_output_tokens": 4096, "timeout_seconds": 60},
        }
    )
    requests = []
    signature = b"opaque-test-signature"

    async def generate(**request):
        requests.append(request)
        if len(requests) == 1:
            return types.GenerateContentResponse(
                candidates=[
                    types.Candidate(
                        content=types.Content(
                            role="model",
                            parts=[
                                types.Part(
                                    function_call=types.FunctionCall(
                                        name="search_products", args={"limit": 5}
                                    ),
                                    thought_signature=signature,
                                )
                            ],
                        ),
                        finish_reason="STOP",
                    )
                ],
                usage_metadata=types.GenerateContentResponseUsageMetadata(
                    prompt_token_count=10,
                    candidates_token_count=5,
                    total_token_count=15,
                ),
            )
        parts = [part for content in request["contents"] for part in content.parts]
        assert any(
            part.function_call and part.thought_signature == signature for part in parts
        )
        assert any(part.function_response for part in parts)
        return types.GenerateContentResponse(
            candidates=[
                types.Candidate(
                    content=types.Content(
                        role="model", parts=[types.Part(text="Products found.")]
                    ),
                    finish_reason="STOP",
                )
            ]
        )

    monkeypatch.setattr(model.async_client.models, "generate_content", generate)

    async def search_products(limit: int):
        """Search products."""
        return {"items": [], "limit": limit}

    agent = create_agent(
        model, tools=[StructuredTool.from_function(coroutine=search_products)]
    )
    result = asyncio.run(
        agent.ainvoke(
            {"messages": [{"role": "user", "content": "Find five products."}]}
        )
    )
    assert result["messages"][-1].content
    assert len(requests) == 2
    assert result["messages"][1].usage_metadata["input_tokens"] == 10


def test_native_google_failure_retains_safe_status_and_hides_provider_text():
    from google.genai.errors import ClientError
    from langchain_google_genai.chat_models import GoogleInvalidRequestError
    from integrations.agents.runtime_errors import model_failure

    cause = ClientError(400, {"error": {"message": "private request content"}})
    error = GoogleInvalidRequestError("private request content")
    error.__cause__ = cause
    category, details = model_failure(error)
    assert category == "invalid_model_request"
    assert details["http_status"] == 400
    assert "private" not in str(details)
