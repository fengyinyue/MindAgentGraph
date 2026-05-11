"""DeepSeek provider — uses the OpenAI-compatible endpoint with forced tool_choice.

Notes:
- deepseek-chat (V3) supports OpenAI tool calling; deepseek-reasoner (R1) does NOT.
  We only ever route to deepseek-chat here.
- base_url is https://api.deepseek.com (no /v1 needed; the OpenAI SDK appends paths).
"""

from __future__ import annotations
import os
import json
from typing import Any
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
            # R1 doesn't support tools — fail loudly rather than silently degrade.
            raise ProviderError(
                "deepseek-reasoner does not support tool calling; use deepseek-chat for /plan"
            )

        client = AsyncOpenAI(api_key=api_key, base_url=DEEPSEEK_BASE_URL)

        # Convert Anthropic-style {name, description, input_schema} → OpenAI
        # {type:"function", function:{name, description, parameters}}.
        openai_tool = {
            "type": "function",
            "function": {
                "name": tool_schema["name"],
                "description": tool_schema.get("description", ""),
                "parameters": tool_schema["input_schema"],
            },
        }

        try:
            resp = await client.chat.completions.create(
                model=chosen_model,
                max_tokens=4096,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": f"目标：{user_goal}"},
                ],
                tools=[openai_tool],
                tool_choice={"type": "function", "function": {"name": tool_schema["name"]}},
            )
        except (APIStatusError, APIConnectionError) as e:
            raise ProviderError(f"deepseek API error: {e}") from e

        msg = resp.choices[0].message
        tool_calls = msg.tool_calls or []
        for tc in tool_calls:
            if tc.function.name == tool_schema["name"]:
                try:
                    return json.loads(tc.function.arguments)
                except json.JSONDecodeError as e:
                    raise ProviderError(
                        f"DeepSeek returned invalid JSON in tool args: {e}"
                    ) from e

        raise ProviderError(
            f"DeepSeek did not return {tool_schema['name']} tool_call (got: {msg.content!r})"
        )
