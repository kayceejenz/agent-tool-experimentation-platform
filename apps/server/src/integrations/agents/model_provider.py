"""Provider routing shared by agent execution and evaluation."""

from pydantic import SecretStr

SUPPORTED_PROVIDERS = ("openai", "google", "anthropic", "ollama")
ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1/"

GOOGLE_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/"


def provider_for_model(model):
    if model.startswith("gemini-"):
        return "google"
    if model.startswith("claude-"):
        return "anthropic"
    if ":" in model:
        return "ollama"
    return "openai"


def provider_key(settings, provider):
    if provider == "google":
        return settings.google_api_key
    if provider == "openai":
        return settings.openai_api_key
    if provider == "anthropic":
        return settings.anthropic_api_key
    if provider == "ollama":
        # Local Ollama ignores this placeholder; never reuse a hosted provider key.
        return settings.ollama_api_key or SecretStr("ollama")
    return None


def provider_options(settings, provider):
    key = provider_key(settings, provider)
    if key is None:
        raise ValueError("provider_not_configured")
    options = {"api_key": key, "use_responses_api": False}
    if provider == "google":
        options["base_url"] = GOOGLE_BASE_URL
    elif provider == "anthropic":
        options["base_url"] = ANTHROPIC_BASE_URL
    elif provider == "ollama":
        options["base_url"] = settings.ollama_base_url
    return options


def configured_secrets(settings):
    return tuple(
        key.get_secret_value()
        for key in (
            settings.openai_api_key,
            settings.google_api_key,
            settings.anthropic_api_key,
            settings.ollama_api_key,
        )
        if key
    )
