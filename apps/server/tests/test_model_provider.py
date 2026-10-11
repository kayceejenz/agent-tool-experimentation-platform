import pytest
from core.settings import Settings
from integrations.agents.model_provider import GOOGLE_BASE_URL, configured_secrets, provider_for_model, provider_options
from integrations.agents.langchain_runtime import LangChainRuntime
from modules.tools.helpers.validation import redact, redact_text


def test_provider_credentials_are_isolated_and_missing_keys_do_not_fallback():
    settings = Settings(_env_file=None, openai_api_key="openai-fixture", google_api_key="google-fixture")
    assert provider_options(settings, "google")["base_url"] == GOOGLE_BASE_URL
    assert provider_options(settings, "google")["api_key"].get_secret_value() == "google-fixture"
    assert "base_url" not in provider_options(settings, "openai")
    with pytest.raises(ValueError):
        provider_options(Settings(_env_file=None, openai_api_key="fixture"), "google")
    assert provider_for_model("gemini-2.5-flash") == "google"
    secrets = configured_secrets(settings)
    assert redact_text("openai-fixture google-fixture", secrets) == "[redacted] [redacted]"
    assert redact({"message": "google-fixture"}, secrets) == {"message": "[redacted]"}


def test_google_runtime_uses_compatibility_endpoint_and_google_key():
    settings = Settings(_env_file=None, google_api_key="google-fixture")
    model = LangChainRuntime(None, None, settings).model({
        "model_settings": {"provider": "google", "model": "gemini-2.5-flash", "temperature": None},
        "limits": {"max_output_tokens": 2048, "timeout_seconds": 60},
    })
    assert model.openai_api_base == GOOGLE_BASE_URL
    assert model.openai_api_key.get_secret_value() == "google-fixture"
    assert model.use_responses_api is False
    assert "parallel_tool_calls" not in model.model_kwargs
