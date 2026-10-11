"""Provider routing shared by agent execution and evaluation."""

GOOGLE_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/"


def provider_for_model(model):
    return "google" if model.startswith("gemini-") else "openai"


def provider_key(settings, provider):
    if provider == "google":
        return settings.google_api_key
    if provider == "openai":
        return settings.openai_api_key
    return None


def provider_options(settings, provider):
    key = provider_key(settings, provider)
    if key is None:
        raise ValueError("provider_not_configured")
    options = {"api_key": key, "use_responses_api": False}
    if provider == "google":
        options["base_url"] = GOOGLE_BASE_URL
    return options


def configured_secrets(settings):
    return tuple(
        key.get_secret_value()
        for key in (settings.openai_api_key, settings.google_api_key)
        if key
    )
