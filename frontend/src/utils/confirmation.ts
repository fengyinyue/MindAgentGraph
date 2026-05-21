export interface ConfirmationQuestion {
  id: string;
  label: string;
  description?: string;
  placeholder?: string;
  options?: string[];
}

export interface ConfirmationRequest {
  title?: string;
  note?: string;
  questions: ConfirmationQuestion[];
}

export type ConfirmationAnswers = Record<string, string>;

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.map(asString).filter((item): item is string => Boolean(item));
  return items.length ? items : undefined;
}

function normalizeQuestion(value: unknown, index: number): ConfirmationQuestion | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const label = asString(raw.label) ?? asString(raw.question);
  if (!label) return null;

  return {
    id: asString(raw.id) ?? `question_${index + 1}`,
    label,
    description: asString(raw.description),
    placeholder: asString(raw.placeholder),
    options: asStringArray(raw.options),
  };
}

export function parseConfirmationRequest(output: string): ConfirmationRequest | null {
  const match = output.match(/```mag-confirmation\s*([\s\S]*?)```/i);
  if (!match) return null;

  try {
    const raw = JSON.parse(match[1]) as Record<string, unknown>;
    const questions = Array.isArray(raw.questions)
      ? raw.questions
          .map((question, index) => normalizeQuestion(question, index))
          .filter((question): question is ConfirmationQuestion => Boolean(question))
      : [];
    if (questions.length === 0) return null;

    return {
      title: asString(raw.title),
      note: asString(raw.note),
      questions,
    };
  } catch {
    return null;
  }
}

export function buildConfirmationPrompt(
  confirmation: ConfirmationRequest,
  answers: ConfirmationAnswers,
): string {
  const lines = confirmation.questions.map((question) => {
    const answer = answers[question.id]?.trim() || "(未填写)";
    return `- ${question.label} (${question.id}): ${answer}`;
  });

  return [
    "用户已确认以下内容，请基于这些确认继续完成当前节点。",
    "不要再次请求相同确认；如果仍有新的阻塞问题，才输出新的 mag-confirmation 块。",
    "",
    ...lines,
  ].join("\n");
}

