"""Provider-neutral AI clients for the VITESTERTL operations copilot.

The panel deliberately speaks the native wire formats used by the major
provider families instead of depending on a vendor SDK:

* ``openai``     OpenAI, OpenRouter, Groq, DeepSeek, xAI, Mistral, vLLM,
                  LiteLLM, LM Studio and any other OpenAI-compatible gateway.
* ``anthropic``  Anthropic Messages API.
* ``google``     Google Gemini generateContent API.
* ``azure``      Azure OpenAI deployments (``api-key`` authentication).
* ``ollama``     Local Ollama models with no API key.

Only httpx is used. API keys never leave the backend except in outbound
provider requests; ``public_provider`` strips them from every response.
"""

from __future__ import annotations

import json
import re
from typing import Any, AsyncIterator
from urllib.parse import quote

import httpx

PANEL_USER_AGENT = "VITESTERTL-Panel/2.1"
AI_KINDS = ("openai", "anthropic", "google", "azure", "ollama")

AI_PRESETS: list[dict[str, Any]] = [
    {
        "id": "openai",
        "name": "OpenAI",
        "kind": "openai",
        "base_url": "https://api.openai.com/v1",
        "model": "gpt-4.1-mini",
        "note": "GPT-4.1, GPT-4o and reasoning models.",
    },
    {
        "id": "openrouter",
        "name": "OpenRouter",
        "kind": "openai",
        "base_url": "https://openrouter.ai/api/v1",
        "model": "anthropic/claude-sonnet-4",
        "note": "One key for hundreds of hosted models.",
    },
    {
        "id": "anthropic",
        "name": "Anthropic",
        "kind": "anthropic",
        "base_url": "https://api.anthropic.com/v1",
        "model": "claude-sonnet-4-20250514",
        "note": "Claude models through the native Messages API.",
    },
    {
        "id": "gemini",
        "name": "Google Gemini",
        "kind": "google",
        "base_url": "https://generativelanguage.googleapis.com/v1beta",
        "model": "gemini-2.5-flash",
        "note": "Gemini models with native streaming.",
    },
    {
        "id": "groq",
        "name": "Groq",
        "kind": "openai",
        "base_url": "https://api.groq.com/openai/v1",
        "model": "llama-3.3-70b-versatile",
        "note": "Low-latency open models.",
    },
    {
        "id": "deepseek",
        "name": "DeepSeek",
        "kind": "openai",
        "base_url": "https://api.deepseek.com/v1",
        "model": "deepseek-chat",
        "note": "DeepSeek chat and reasoning models.",
    },
    {
        "id": "xai",
        "name": "xAI",
        "kind": "openai",
        "base_url": "https://api.x.ai/v1",
        "model": "grok-3-mini",
        "note": "Grok models through an OpenAI-compatible API.",
    },
    {
        "id": "mistral",
        "name": "Mistral",
        "kind": "openai",
        "base_url": "https://api.mistral.ai/v1",
        "model": "mistral-large-latest",
        "note": "Mistral and Codestral models.",
    },
    {
        "id": "ollama",
        "name": "Ollama",
        "kind": "ollama",
        "base_url": "http://127.0.0.1:11434",
        "model": "qwen2.5-coder:7b",
        "note": "Local models with no API key.",
    },
    {
        "id": "azure",
        "name": "Azure OpenAI",
        "kind": "azure",
        "base_url": "https://RESOURCE.openai.azure.com/openai/deployments/DEPLOYMENT",
        "model": "gpt-4.1-mini",
        "note": "Deployment URL. Append your own api-version query when required.",
    },
    {
        "id": "custom",
        "name": "Custom gateway",
        "kind": "openai",
        "base_url": "https://example.com/v1",
        "model": "",
        "note": "Any OpenAI-compatible gateway, including vLLM and LiteLLM.",
    },
]


class ProviderError(Exception):
    """A provider request failed with a message safe to show to the user."""

    def __init__(self, message: str, status_code: int = 502) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def normalize_headers(value: Any) -> dict[str, str]:
    """Accept a dict, JSON object string, or nothing and return string headers."""

    if isinstance(value, dict):
        source = value
    elif isinstance(value, str) and value.strip():
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError as exc:
            raise ValueError("Custom headers must be a JSON object") from exc
        if not isinstance(parsed, dict):
            raise ValueError("Custom headers must be a JSON object")
        source = parsed
    else:
        source = {}
    result: dict[str, str] = {}
    for key, item in source.items():
        name = str(key).strip()
        if not name or item is None:
            continue
        if any(ch in name for ch in "\r\n:") or any(ch in str(item) for ch in "\r\n"):
            raise ValueError("Custom headers cannot contain line breaks")
        result[name[:80]] = str(item)[:2000]
    return result


def public_provider(row: dict[str, Any] | None) -> dict[str, Any] | None:
    """Return a provider row with the secret removed."""

    if not row:
        return None
    data = dict(row)
    key = str(data.pop("api_key", "") or "")
    try:
        data["headers"] = normalize_headers(data.get("headers"))
    except ValueError:
        data["headers"] = {}
    data["key_set"] = bool(key)
    data["enabled"] = bool(data.get("enabled"))
    data["is_default"] = bool(data.get("is_default"))
    return data


def _base(provider: dict[str, Any]) -> str:
    return str(provider.get("base_url") or "").strip().rstrip("/")


def _api_root(provider: dict[str, Any]) -> str:
    base = _base(provider)
    suffix = "/chat/completions"
    if base.endswith(suffix):
        return base[: -len(suffix)]
    return base


def _int(value: Any, default: int = 0) -> int:
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return default


def _float(value: Any, default: float = 0.4) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _model(provider: dict[str, Any]) -> str:
    model = str(provider.get("model") or "").strip()
    if not model:
        raise ProviderError("Choose a model for this provider before starting a chat")
    return model


def _timeout() -> httpx.Timeout:
    return httpx.Timeout(connect=15.0, read=240.0, write=30.0, pool=15.0)


def _headers(provider: dict[str, Any], *, stream: bool) -> dict[str, str]:
    headers = {
        "Accept": "text/event-stream" if stream else "application/json",
        "Content-Type": "application/json",
        "User-Agent": PANEL_USER_AGENT,
    }
    try:
        headers.update(normalize_headers(provider.get("headers")))
    except ValueError:
        pass
    key = str(provider.get("api_key") or "").strip()
    kind = str(provider.get("kind") or "openai").lower()
    if kind == "anthropic":
        if key:
            headers["x-api-key"] = key
        headers["anthropic-version"] = "2023-06-01"
    elif kind == "google":
        if key:
            headers["x-goog-api-key"] = key
    elif kind == "azure":
        if key:
            headers["api-key"] = key
    elif kind != "ollama" and key:
        headers["Authorization"] = f"Bearer {key}"
    return headers


def _error_message(text: str, status_code: int) -> str:
    text = (text or "").strip()
    message = ""
    try:
        payload = json.loads(text)
        if isinstance(payload, dict):
            error = payload.get("error")
            if isinstance(error, dict):
                message = str(error.get("message") or error.get("status") or "")
            elif isinstance(error, str):
                message = error
            if not message:
                message = str(payload.get("message") or payload.get("detail") or "")
    except json.JSONDecodeError:
        message = text
    message = re.sub(r"\s+", " ", message).strip()
    if not message:
        message = f"The provider returned HTTP {status_code}"
    if len(message) > 500:
        message = message[:497] + "..."
    return message


async def _check(response: httpx.Response) -> None:
    if response.status_code < 400:
        return
    body = await response.aread()
    raise ProviderError(
        _error_message(body.decode("utf-8", errors="replace"), response.status_code),
        status_code=response.status_code,
    )


def _chat_messages(messages: list[dict[str, Any]]) -> list[dict[str, str]]:
    merged: list[dict[str, str]] = []
    for item in messages:
        role = str(item.get("role") or "")
        content = str(item.get("content") or "").strip()
        if role not in ("user", "assistant") or not content:
            continue
        content = content[:16000]
        if merged and merged[-1]["role"] == role:
            merged[-1]["content"] = (merged[-1]["content"] + "\n\n" + content)[:24000]
        else:
            merged.append({"role": role, "content": content})
    if not merged:
        merged.append({"role": "user", "content": "Hello"})
    if merged[0]["role"] == "assistant":
        merged.insert(0, {"role": "user", "content": "Continue the conversation."})
    return merged


def _estimate_tokens(text: str) -> int:
    return max(1, int(len(text) / 4))


def estimate_usage(prompt: str, completion: str) -> dict[str, int]:
    prompt_tokens = _estimate_tokens(prompt)
    completion_tokens = _estimate_tokens(completion) if completion else 0
    return {
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "total_tokens": prompt_tokens + completion_tokens,
    }


def _openai_chat_url(provider: dict[str, Any]) -> str:
    kind = str(provider.get("kind") or "openai").lower()
    base = _base(provider)
    if kind == "azure":
        url = base if base.endswith("/chat/completions") else f"{base}/chat/completions"
        if "api-version=" not in url:
            url += ("&" if "?" in url else "?") + "api-version=2024-10-21"
        return url
    if base.endswith("/chat/completions"):
        return base
    return f"{base}/chat/completions"


def _openai_payload(
    provider: dict[str, Any],
    messages: list[dict[str, str]],
    system: str,
    max_tokens: int,
    temperature: float,
    *,
    stream: bool,
) -> dict[str, Any]:
    model = _model(provider)
    merged = ([{"role": "system", "content": system}] if system else []) + messages
    payload: dict[str, Any] = {
        "model": model,
        "messages": merged,
        "stream": stream,
    }
    reasoning = bool(re.match(r"^(o\d|gpt-5)", model, re.IGNORECASE))
    if max_tokens > 0:
        payload["max_completion_tokens" if reasoning else "max_tokens"] = max_tokens
    if not reasoning:
        payload["temperature"] = temperature
    if stream:
        # Supported by OpenAI and most compatible gateways. Servers that do
        # not understand it simply omit usage metadata; the panel estimates.
        payload["stream_options"] = {"include_usage": True}
    return payload


def _openai_delta(payload: dict[str, Any]) -> str:
    choices = payload.get("choices")
    if not isinstance(choices, list) or not choices:
        return ""
    choice = choices[0] if isinstance(choices[0], dict) else {}
    delta = choice.get("delta")
    if isinstance(delta, dict):
        content = delta.get("content")
    else:
        content = choice.get("text")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for part in content:
            if isinstance(part, dict) and isinstance(part.get("text"), str):
                parts.append(part["text"])
        return "".join(parts)
    return ""


async def _stream_openai(
    provider: dict[str, Any],
    messages: list[dict[str, str]],
    system: str,
    max_tokens: int,
    temperature: float,
) -> AsyncIterator[dict[str, Any]]:
    payload = _openai_payload(
        provider, messages, system, max_tokens, temperature, stream=True
    )
    usage: dict[str, int] | None = None
    async with httpx.AsyncClient(timeout=_timeout(), follow_redirects=True) as client:
        async with client.stream(
            "POST",
            _openai_chat_url(provider),
            headers=_headers(provider, stream=True),
            json=payload,
        ) as response:
            await _check(response)
            async for line in response.aiter_lines():
                line = line.strip()
                if not line or line.startswith(":"):
                    continue
                if line.startswith("data:"):
                    line = line[5:].strip()
                if line == "[DONE]":
                    break
                try:
                    frame = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if isinstance(frame.get("error"), (dict, str)):
                    error = frame["error"]
                    message = error.get("message") if isinstance(error, dict) else error
                    raise ProviderError(str(message or "The provider reported an error"))
                text = _openai_delta(frame)
                if text:
                    yield {"type": "delta", "text": text}
                raw_usage = frame.get("usage")
                if isinstance(raw_usage, dict):
                    usage = {
                        "prompt_tokens": _int(raw_usage.get("prompt_tokens")),
                        "completion_tokens": _int(raw_usage.get("completion_tokens")),
                        "total_tokens": _int(raw_usage.get("total_tokens")),
                    }
    if usage:
        yield {"type": "usage", **usage}


async def _stream_anthropic(
    provider: dict[str, Any],
    messages: list[dict[str, str]],
    system: str,
    max_tokens: int,
    temperature: float,
) -> AsyncIterator[dict[str, Any]]:
    payload: dict[str, Any] = {
        "model": _model(provider),
        "max_tokens": max_tokens or 2048,
        "messages": messages,
        "stream": True,
    }
    if system:
        payload["system"] = system
    if temperature >= 0:
        payload["temperature"] = min(1.0, temperature)
    prompt_tokens = 0
    completion_tokens = 0
    async with httpx.AsyncClient(timeout=_timeout(), follow_redirects=True) as client:
        async with client.stream(
            "POST",
            f"{_base(provider)}/messages",
            headers=_headers(provider, stream=True),
            json=payload,
        ) as response:
            await _check(response)
            async for line in response.aiter_lines():
                line = line.strip()
                if not line.startswith("data:"):
                    continue
                raw = line[5:].strip()
                if not raw or raw == "[DONE]":
                    continue
                try:
                    frame = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                event = frame.get("type")
                if event == "error":
                    error = frame.get("error") or {}
                    raise ProviderError(
                        str(error.get("message") or "Anthropic reported an error")
                    )
                if event == "message_start":
                    usage = (frame.get("message") or {}).get("usage") or {}
                    prompt_tokens = _int(usage.get("input_tokens"), prompt_tokens)
                    completion_tokens = _int(
                        usage.get("output_tokens"), completion_tokens
                    )
                elif event == "content_block_delta":
                    delta = frame.get("delta") or {}
                    text = delta.get("text") if isinstance(delta, dict) else ""
                    if text:
                        yield {"type": "delta", "text": str(text)}
                elif event == "message_delta":
                    usage = frame.get("usage") or {}
                    completion_tokens = _int(
                        usage.get("output_tokens"), completion_tokens
                    )
    if prompt_tokens or completion_tokens:
        yield {
            "type": "usage",
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": prompt_tokens + completion_tokens,
        }


async def _stream_google(
    provider: dict[str, Any],
    messages: list[dict[str, str]],
    system: str,
    max_tokens: int,
    temperature: float,
) -> AsyncIterator[dict[str, Any]]:
    model = quote(_model(provider), safe="")
    payload: dict[str, Any] = {
        "contents": [
            {
                "role": "user" if item["role"] == "user" else "model",
                "parts": [{"text": item["content"]}],
            }
            for item in messages
        ],
        "generationConfig": {"temperature": temperature},
    }
    if max_tokens > 0:
        payload["generationConfig"]["maxOutputTokens"] = max_tokens
    if system:
        payload["systemInstruction"] = {"parts": [{"text": system}]}
    usage: dict[str, int] | None = None
    async with httpx.AsyncClient(timeout=_timeout(), follow_redirects=True) as client:
        async with client.stream(
            "POST",
            f"{_base(provider)}/models/{model}:streamGenerateContent?alt=sse",
            headers=_headers(provider, stream=True),
            json=payload,
        ) as response:
            await _check(response)
            async for line in response.aiter_lines():
                line = line.strip()
                if not line.startswith("data:"):
                    continue
                raw = line[5:].strip()
                if not raw:
                    continue
                try:
                    frame = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                if isinstance(frame.get("error"), dict):
                    raise ProviderError(
                        str(frame["error"].get("message") or "Gemini reported an error")
                    )
                feedback = frame.get("promptFeedback") or {}
                if feedback.get("blockReason"):
                    raise ProviderError(
                        f"Gemini blocked the request: {feedback['blockReason']}"
                    )
                candidates = frame.get("candidates") or []
                if candidates:
                    candidate = candidates[0] if isinstance(candidates[0], dict) else {}
                    content = candidate.get("content") or {}
                    for part in content.get("parts") or []:
                        if not isinstance(part, dict) or part.get("thought"):
                            continue
                        text = part.get("text")
                        if text:
                            yield {"type": "delta", "text": str(text)}
                raw_usage = frame.get("usageMetadata")
                if isinstance(raw_usage, dict):
                    prompt = _int(raw_usage.get("promptTokenCount"))
                    completion = _int(raw_usage.get("candidatesTokenCount"))
                    usage = {
                        "prompt_tokens": prompt,
                        "completion_tokens": completion,
                        "total_tokens": prompt + completion,
                    }
    if usage:
        yield {"type": "usage", **usage}


async def _stream_ollama(
    provider: dict[str, Any],
    messages: list[dict[str, str]],
    system: str,
    max_tokens: int,
    temperature: float,
) -> AsyncIterator[dict[str, Any]]:
    payload: dict[str, Any] = {
        "model": _model(provider),
        "messages": ([{"role": "system", "content": system}] if system else []) + messages,
        "stream": True,
        "options": {"temperature": temperature},
    }
    if max_tokens > 0:
        payload["options"]["num_predict"] = max_tokens
    prompt_tokens = 0
    completion_tokens = 0
    async with httpx.AsyncClient(timeout=_timeout(), follow_redirects=True) as client:
        async with client.stream(
            "POST",
            f"{_base(provider)}/api/chat",
            headers=_headers(provider, stream=True),
            json=payload,
        ) as response:
            await _check(response)
            async for line in response.aiter_lines():
                line = line.strip()
                if not line:
                    continue
                try:
                    frame = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if frame.get("error"):
                    raise ProviderError(str(frame["error"]))
                message = frame.get("message") or {}
                text = message.get("content") if isinstance(message, dict) else ""
                if text:
                    yield {"type": "delta", "text": str(text)}
                if frame.get("done"):
                    prompt_tokens = _int(frame.get("prompt_eval_count"), prompt_tokens)
                    completion_tokens = _int(frame.get("eval_count"), completion_tokens)
                    break
    if prompt_tokens or completion_tokens:
        yield {
            "type": "usage",
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": prompt_tokens + completion_tokens,
        }


async def stream_chat(
    provider: dict[str, Any],
    messages: list[dict[str, Any]],
    system: str,
    *,
    max_tokens: int = 0,
    temperature: float = 0.4,
) -> AsyncIterator[dict[str, Any]]:
    """Yield ``delta`` and ``usage`` events from a provider stream."""

    normalized = _chat_messages(messages)
    kind = str(provider.get("kind") or "openai").lower()
    limit = max_tokens or _int(provider.get("max_tokens"), 2048)
    limit = max(64, min(32000, limit))
    heat = _float(provider.get("temperature"), temperature)
    heat = max(0.0, min(2.0, heat))
    if kind == "anthropic":
        async for event in _stream_anthropic(
            provider, normalized, system, limit, heat
        ):
            yield event
    elif kind == "google":
        async for event in _stream_google(provider, normalized, system, limit, heat):
            yield event
    elif kind == "ollama":
        async for event in _stream_ollama(provider, normalized, system, limit, heat):
            yield event
    elif kind in ("openai", "azure"):
        async for event in _stream_openai(provider, normalized, system, limit, heat):
            yield event
    else:
        raise ProviderError(f"Unsupported provider kind: {kind}", status_code=400)


def _model_names(payload: Any, kind: str) -> list[str]:
    names: list[str] = []
    if kind == "ollama":
        source = payload.get("models") if isinstance(payload, dict) else None
        for item in source or []:
            if isinstance(item, dict):
                name = item.get("name") or item.get("model")
                if name:
                    names.append(str(name))
    elif kind == "google":
        source = payload.get("models") if isinstance(payload, dict) else None
        for item in source or []:
            if isinstance(item, dict):
                methods = item.get("supportedGenerationMethods") or []
                if methods and "generateContent" not in methods:
                    continue
                name = str(item.get("name") or "")
                if name.startswith("models/"):
                    name = name[len("models/") :]
                if name:
                    names.append(name)
    else:
        source = payload.get("data") if isinstance(payload, dict) else None
        for item in source or []:
            if isinstance(item, dict):
                name = item.get("id") or item.get("name")
                if name:
                    names.append(str(name))
    unique: list[str] = []
    seen: set[str] = set()
    for name in names:
        if name in seen:
            continue
        seen.add(name)
        unique.append(name)
    return sorted(unique, key=lambda value: value.lower())


def _models_url(provider: dict[str, Any]) -> tuple[str, str]:
    kind = str(provider.get("kind") or "openai").lower()
    if kind == "ollama":
        return f"{_base(provider)}/api/tags", "ollama"
    if kind == "anthropic":
        return f"{_base(provider)}/models?limit=1000", "anthropic"
    if kind == "google":
        return f"{_base(provider)}/models?pageSize=1000", "google"
    return f"{_api_root(provider)}/models", "openai"


async def list_models(provider: dict[str, Any]) -> list[str]:
    if str(provider.get("kind") or "").lower() == "azure":
        return []
    url, shape = _models_url(provider)
    async with httpx.AsyncClient(timeout=httpx.Timeout(30.0), follow_redirects=True) as client:
        response = await client.get(url, headers=_headers(provider, stream=False))
        if response.status_code >= 400:
            raise ProviderError(
                _error_message(response.text, response.status_code),
                status_code=response.status_code,
            )
        try:
            payload = response.json()
        except ValueError as exc:
            raise ProviderError("The provider returned a non-JSON model list") from exc
    return _model_names(payload, shape)


async def _test_openai(provider: dict[str, Any]) -> tuple[str, int]:
    try:
        models = await list_models(provider)
    except ProviderError as exc:
        if exc.status_code not in (404, 405):
            raise
        models = []
    if models:
        return f"Key accepted · {len(models)} model{'s' if len(models) != 1 else ''} available", len(
            models
        )
    payload = _openai_payload(
        provider,
        [{"role": "user", "content": "Reply with READY."}],
        "",
        8,
        0.0,
        stream=False,
    )
    async with httpx.AsyncClient(timeout=httpx.Timeout(60.0), follow_redirects=True) as client:
        response = await client.post(
            _openai_chat_url(provider),
            headers=_headers(provider, stream=False),
            json=payload,
        )
        if response.status_code >= 400:
            raise ProviderError(
                _error_message(response.text, response.status_code),
                status_code=response.status_code,
            )
    return "Chat completion accepted", 0


async def _test_anthropic(provider: dict[str, Any]) -> tuple[str, int]:
    payload = {
        "model": _model(provider),
        "max_tokens": 8,
        "messages": [{"role": "user", "content": "Reply with READY."}],
    }
    async with httpx.AsyncClient(timeout=httpx.Timeout(60.0), follow_redirects=True) as client:
        response = await client.post(
            f"{_base(provider)}/messages",
            headers=_headers(provider, stream=False),
            json=payload,
        )
        if response.status_code >= 400:
            raise ProviderError(
                _error_message(response.text, response.status_code),
                status_code=response.status_code,
            )
    return "Messages API accepted", 0


async def _test_google(provider: dict[str, Any]) -> tuple[str, int]:
    models = await list_models(provider)
    return f"Key accepted · {len(models)} Gemini model{'s' if len(models) != 1 else ''}", len(
        models
    )


async def _test_ollama(provider: dict[str, Any]) -> tuple[str, int]:
    models = await list_models(provider)
    return f"Ollama reachable · {len(models)} local model{'s' if len(models) != 1 else ''}", len(
        models
    )


async def test_provider(provider: dict[str, Any]) -> dict[str, Any]:
    """Run a cheap, non-destructive request that proves the configuration."""

    import time

    kind = str(provider.get("kind") or "openai").lower()
    started = time.monotonic()
    if kind == "anthropic":
        message, count = await _test_anthropic(provider)
    elif kind == "google":
        message, count = await _test_google(provider)
    elif kind == "ollama":
        message, count = await _test_ollama(provider)
    elif kind in ("openai", "azure"):
        message, count = await _test_openai(provider)
    else:
        raise ProviderError(f"Unsupported provider kind: {kind}", status_code=400)
    return {
        "status": "ok",
        "message": message,
        "models": count,
        "latency_ms": int((time.monotonic() - started) * 1000),
    }
