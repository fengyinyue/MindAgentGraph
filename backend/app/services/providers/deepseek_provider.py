"""DeepSeek provider — OpenAI-compatible endpoint.

emit_graph strategy:
  Uses `response_format={"type":"json_object"}` instead of tool_choice, because
  DeepSeek's tool calling with large schemas occasionally emits concatenated
  JSON (`{...}{...}`) which is fragile to parse.  json_object mode + the schema
  embedded in the system prompt has proven more reliable for structured output.

stream_text:
  Standard OpenAI streaming — delta.content chunks.
"""

from __future__ import annotations
import logging
import os
import re
import json
from typing import Any, AsyncIterator
from openai import AsyncOpenAI, APIStatusError, APIConnectionError

from app.services.providers.base import ProviderError

_log = logging.getLogger("mag.deepseek")

DEFAULT_MODEL = "deepseek-v4-flash"
DEEPSEEK_BASE_URL = "https://api.deepseek.com"


def _normalize_model(model: str | None) -> str:
    # Preserve compatibility with older saved UI/env values while keeping the
    # provider defaults and actual requests on the V4 model family.
    if model in {None, "", "deepseek-chat", "deepseek-reasoner"}:
        return DEFAULT_MODEL
    return model


class DeepSeekProvider:
    name = "deepseek"

    async def emit_graph(
        self,
        *,
        system_prompt: str,
        user_goal: str,
        tool_schema: dict[str, Any],
        model: str | None = None,
        api_key: str | None = None,
    ) -> dict[str, Any]:
        api_key = api_key or os.environ.get("DEEPSEEK_API_KEY")
        if not api_key:
            raise ProviderError("DEEPSEEK_API_KEY not set")

        chosen_model = _normalize_model(model)

        client = AsyncOpenAI(api_key=api_key, base_url=DEEPSEEK_BASE_URL)

        # Embed the expected JSON schema in the system prompt so the model
        # knows exactly what to return (json_object mode doesn't take a schema
        # parameter, unlike tool.function.parameters).
        schema_desc = json.dumps(tool_schema["input_schema"], ensure_ascii=False, indent=2)
        full_system = (
            system_prompt
            + f"\n\n---\n## Required JSON output\n\n"
            f"Respond with a single JSON object that matches this JSON Schema:\n```json\n{schema_desc}\n```\n"
            f"Call this tool: {tool_schema['name']}\n"
            f"Do NOT wrap the JSON in markdown code fences. Start directly with {{."
        )

        try:
            resp = await client.chat.completions.create(
                model=chosen_model,
                max_tokens=8192,
                messages=[
                    {"role": "system", "content": full_system},
                    {"role": "user", "content": f"目标：{user_goal}"},
                ],
                response_format={"type": "json_object"},
                temperature=0.1,  # lower temp → less stray text after JSON
            )
        except (APIStatusError, APIConnectionError) as e:
            raise ProviderError(f"deepseek API error: {e}") from e

        choice = resp.choices[0]
        raw = choice.message.content or ""
        finish = choice.finish_reason

        # ── debug log ──
        usage = resp.usage
        _log.debug(
            "emit_graph model=%s finish=%s prompt_tokens=%s completion_tokens=%s len=%s",
            chosen_model, finish,
            usage.prompt_tokens if usage else "?",
            usage.completion_tokens if usage else "?",
            len(raw),
        )

        parsed = _extract_json(raw)
        if isinstance(parsed, dict):
            n_nodes = len(parsed.get("nodes", []))
            n_links = len(parsed.get("links", []))
            _log.debug("emit_graph parsed OK → %s nodes, %s links", n_nodes, n_links)
            return parsed

        # Fallback: content was not valid JSON.
        _log.warning(
            "emit_graph could not parse JSON (finish_reason=%s, len=%s)",
            finish, len(raw),
        )
        raise ProviderError(
            f"DeepSeek returned unparseable JSON content "
            f"(finish_reason={finish}, len={len(raw)})"
        )

    async def stream_text(
        self,
        *,
        system_prompt: str,
        user_message: str,
        model: str | None = None,
        api_key: str | None = None,
        max_tokens: int = 2048,
    ) -> AsyncIterator[str]:
        api_key = api_key or os.environ.get("DEEPSEEK_API_KEY")
        if not api_key:
            raise ProviderError("DEEPSEEK_API_KEY not set")

        chosen_model = _normalize_model(model)

        client = AsyncOpenAI(api_key=api_key, base_url=DEEPSEEK_BASE_URL)
        acc: list[str] = []
        try:
            stream = await client.chat.completions.create(
                model=chosen_model,
                max_tokens=max_tokens,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_message},
                ],
                stream=True,
            )
            async for chunk in stream:
                delta = chunk.choices[0].delta if chunk.choices else None
                if delta and delta.content:
                    acc.append(delta.content)
                    yield delta.content
        except (APIStatusError, APIConnectionError) as e:
            raise ProviderError(f"deepseek API error: {e}") from e
        finally:
            full = "".join(acc)
            if full:
                _log.debug("stream_text %s chars", len(full))


# ── JSON extraction helpers ────────────────────────────────────────────

_MD_FENCE = re.compile(r"```(?:json)?\s*\n?(.*?)\n?```", re.DOTALL)


def _extract_json(text: str) -> Any | None:
    """Pull a JSON value out of a model response that may contain
    markdown fences, leading/trailing noise, or concatenated objects."""
    if not text:
        return None

    # 1. Try plain parse.
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # 2. Try stripping markdown fences.
    m = _MD_FENCE.search(text)
    if m:
        try:
            return json.loads(m.group(1))
        except json.JSONDecodeError:
            pass

    # 3. raw_decode: first complete JSON object (handles {...}{...} concat).
    try:
        decoder = json.JSONDecoder()
        idx = 0
        while idx < len(text) and text[idx].isspace():
            idx += 1
        obj, _end = decoder.raw_decode(text, idx)
        return obj
    except json.JSONDecodeError:
        pass

    # 4. Attempt to repair: find first {, find last }, slice.
    start = text.find("{")
    if start != -1:
        end = text.rfind("}")
        if end > start:
            try:
                return json.loads(text[start:end + 1])
            except json.JSONDecodeError:
                pass

    return None
