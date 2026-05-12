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
import os
import re
import json
from typing import Any, AsyncIterator
from openai import AsyncOpenAI, APIStatusError, APIConnectionError

from app.services.providers.base import ProviderError

DEFAULT_MODEL = "deepseek-chat"
DEEPSEEK_BASE_URL = "https://api.deepseek.com"


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

        chosen_model = model or DEFAULT_MODEL
        if chosen_model == "deepseek-reasoner":
            raise ProviderError(
                "deepseek-reasoner does not support json_object mode; use deepseek-chat"
            )

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

        # ── output log ──
        usage = resp.usage
        print(
            f"\n{'='*60}\n"
            f"[deepseek emit_graph] model={chosen_model} finish={finish}\n"
            f"[deepseek emit_graph] tokens: prompt={usage.prompt_tokens if usage else '?'} "
            f"completion={usage.completion_tokens if usage else '?'}\n"
            f"[deepseek emit_graph] raw content ({len(raw)} chars):\n{raw}\n"
            f"{'='*60}",
            flush=True,
        )

        parsed = _extract_json(raw)
        if isinstance(parsed, dict):
            n_nodes = len(parsed.get("nodes", []))
            n_links = len(parsed.get("links", []))
            print(
                f"[deepseek emit_graph] parsed OK → {n_nodes} nodes, {n_links} links",
                flush=True,
            )
            return parsed

        # Fallback: content was not valid JSON.
        print(
            f"[deepseek emit_graph] could not parse JSON (finish_reason={finish}, len={len(raw)})",
            flush=True,
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

        chosen_model = model or DEFAULT_MODEL
        if chosen_model == "deepseek-reasoner":
            chosen_model = DEFAULT_MODEL

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
                print(
                    f"\n{'='*60}\n"
                    f"[deepseek stream_text] {len(full)} chars:\n"
                    f"{full[:800]}{'…' if len(full) > 800 else ''}\n"
                    f"{'='*60}\n",
                    flush=True,
                )


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
