"""Controlled runtime stops and sanitized provider failure categories."""


class RuntimeStop(Exception):
    def __init__(self, reason):
        self.reason = reason
        super().__init__(reason)


def model_failure(error):
    """Expose actionable categories without persisting provider exception text."""
    status = getattr(error, "status_code", None)
    categories = {
        400: (
            "invalid_model_request",
            "The provider rejected the model settings or tool schemas.",
        ),
        401: (
            "provider_authentication",
            "Check the server's OpenAI API key and restart the worker.",
        ),
        403: (
            "provider_permission",
            "Check the API project's permissions for this model.",
        ),
        404: (
            "model_unavailable",
            "Check the model identifier and API project access.",
        ),
        429: (
            "provider_rate_limit",
            "Check OpenAI API billing, quota, and rate limits.",
        ),
    }
    category, hint = categories.get(
        status, ("model_error", "The model request failed.")
    )
    body = getattr(error, "body", None)
    detail = body.get("error", body) if isinstance(body, dict) else {}
    if isinstance(detail, dict) and detail.get("code") == "insufficient_quota":
        category, hint = (
            "provider_quota",
            "Check OpenAI API billing and the project's spending limit.",
        )
    if isinstance(status, int) and status >= 500:
        category, hint = (
            "provider_unavailable",
            "The model provider is temporarily unavailable.",
        )
    if type(error).__name__ == "APIConnectionError":
        category, hint = (
            "provider_connection",
            "Check the worker's connection to OpenAI.",
        )
    if type(error).__name__ == "APITimeoutError":
        category, hint = "provider_timeout", "The provider request timed out."
    return category, {
        "http_status": status if isinstance(status, int) else None,
        "hint": hint,
    }
