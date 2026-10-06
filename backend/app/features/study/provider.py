"""The one place that talks to the AI provider (Groq's OpenAI-compatible API).

Failures become ProviderError with a SAFE message: no provider response text, no credentials.
Tests replace `complete`; the development simulator is selectable only outside production and is
always reported as simulated so it can never be mistaken for the real integration."""
import json
import logging
import time

import httpx

from app.config import settings

log = logging.getLogger("learnsync.ai")
cooldown_until = 0.0            # shared by every request in this process: after a 429 we stop asking for a while
DEFAULT_COOLDOWN, MAX_COOLDOWN = 20, 60
GROQ_URL = "https://api.groq.com/openai/v1"

SAFE_MESSAGES = {
    "not_configured": "AI help is not set up on this server yet.",
    "timeout": "The AI service took too long to answer. Please try again.",
    "rate_limited": "The AI service is busy right now. Please try again in a minute.",
    "unavailable": "The AI service is not available right now. Please try again later.",
    "not_authorized": "AI help is not available because the server's AI access needs attention.",
    "model_unavailable": "The configured AI model is not available to this account.",
    "bad_response": "The AI service returned something unusable. Please try again.",
}


class ProviderError(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.code = code
        self.message = SAFE_MESSAGES.get(code, SAFE_MESSAGES["unavailable"])


def simulated():
    return settings().ai_provider_mode == "fake" and settings().app_env == "development"


def configured():
    return simulated() or bool(settings().groq_api_key)


def status():
    s = settings()
    return {"configured": configured(), "simulated": simulated(),
            "chat_model": "simulator" if simulated() else s.groq_chat_model,
            "quiz_model": "simulator" if simulated() else s.groq_quiz_model}


def start_cooldown(response):
    """Honour the provider's own retry guidance (bounded), so waiting students do not make a busy minute worse."""
    global cooldown_until
    try:
        wait = float(response.headers.get("retry-after", DEFAULT_COOLDOWN))
    except ValueError:
        wait = DEFAULT_COOLDOWN
    cooldown_until = time.monotonic() + min(max(wait, 1.0), MAX_COOLDOWN)


def error_code(response):
    """The provider's short machine code for an error, if any. Only this code is read, never the message."""
    try:
        code = response.json().get("error", {}).get("code")
    except (ValueError, AttributeError):
        return None
    return code if isinstance(code, str) else None


def complete(messages, *, model, json_mode=False, max_tokens=800, temperature=0.3):
    """Return the assistant text for one chat request, or raise ProviderError."""
    if simulated():
        from . import fake
        return fake.complete(messages, json_mode=json_mode)
    key = settings().groq_api_key
    if not key:
        raise ProviderError("not_configured")
    if time.monotonic() < cooldown_until:
        raise ProviderError("rate_limited")          # do not hammer a provider that just said it is busy
    body = {"model": model, "messages": messages, "temperature": temperature,
            "max_completion_tokens": max_tokens}
    if model.startswith("openai/gpt-oss"):
        body["reasoning_effort"] = "low"   # bounded tasks; hidden reasoning also spends the token cap
    if json_mode:
        body["response_format"] = {"type": "json_object"}
    try:
        response = httpx.post(f"{GROQ_URL}/chat/completions", json=body, timeout=settings().ai_timeout_seconds,
                              headers={"Authorization": f"Bearer {key}", "User-Agent": "LearnSync/2"})
    except httpx.TimeoutException:
        raise ProviderError("timeout") from None
    except httpx.HTTPError:
        raise ProviderError("unavailable") from None
    if response.status_code != 200:
        log.warning("AI provider returned HTTP %s", response.status_code)   # status only, never the body
        if response.status_code == 429:
            start_cooldown(response)
            raise ProviderError("rate_limited")
        if response.status_code in (401, 403):
            raise ProviderError("not_authorized")
        if response.status_code == 400 and error_code(response) == "json_validate_failed":
            raise ProviderError("bad_response")      # JSON mode produced malformed JSON: a bad reply, not a bad model
        if response.status_code in (400, 404):
            raise ProviderError("model_unavailable")
        raise ProviderError("unavailable")
    try:
        choice = response.json()["choices"][0]
        content = choice["message"]["content"]
        if choice.get("finish_reason") == "length":   # cut off mid-answer: never trust half a reply
            raise ProviderError("bad_response")
    except (ValueError, KeyError, IndexError, TypeError):
        raise ProviderError("bad_response") from None
    if not isinstance(content, str) or not content.strip():
        raise ProviderError("bad_response")
    return content


def list_models():
    """Model ids the configured account can use (for the setup check)."""
    key = settings().groq_api_key
    if not key:
        raise ProviderError("not_configured")
    try:
        response = httpx.get(f"{GROQ_URL}/models", timeout=settings().ai_timeout_seconds,
                             headers={"Authorization": f"Bearer {key}"})
        response.raise_for_status()
        return sorted(m["id"] for m in response.json().get("data", []))
    except (httpx.HTTPError, ValueError, KeyError):
        raise ProviderError("unavailable") from None


def parse_json(text):
    """Model output -> dict. Tolerates a fenced block; anything else is a bad response."""
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`")
        cleaned = cleaned[cleaned.find("{"):] if "{" in cleaned else cleaned
    try:
        value = json.loads(cleaned)
    except ValueError:
        raise ProviderError("bad_response") from None
    if not isinstance(value, dict):
        raise ProviderError("bad_response")
    return value
