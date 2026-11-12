// Server-only AI helper. The AI reads messy text and writes words; code does numbers and dates.
import { generateResponse, GatewayError } from "@lovable.dev/ai-gateway";

type JsonSchema = Record<string, unknown>;

export async function aiJson<T>(opts: {
  instructions: string;
  input: string;
  name: string;
  schema: JsonSchema;
}): Promise<T> {
  try {
    const res = await generateResponse({
      model: "openai/gpt-6-astra",
      instructions: opts.instructions,
      input: [{ role: "user", content: `${opts.input}\n\nReturn JSON only.` }],
      text: { format: { type: "json_schema", name: opts.name, schema: opts.schema, strict: true } },
    });
    const text = extractText(res);
    if (!text) throw new Error("The AI returned an empty answer.");
    const cleaned = text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
    return JSON.parse(cleaned) as T;
  } catch (e) {
    if (e instanceof GatewayError) {
      console.error("AI gateway error", e.code, e.httpStatus, e.message);
      if (e.httpStatus === 402)
        throw new Error("AI credits ran out. Add credits in your workspace, then try again.");
      if (e.httpStatus === 429)
        throw new Error("The AI is busy right now. Wait a moment and try again.");
      throw new Error("The AI couldn't finish that. Please try again.");
    }
    if (e instanceof SyntaxError)
      throw new Error("The AI answer came back garbled. Please try again.");
    throw e;
  }
}

function extractText(res: unknown): string {
  const r = res as {
    output_text?: string;
    output?: { type?: string; content?: { type?: string; text?: string }[] }[];
  };
  if (typeof r.output_text === "string" && r.output_text) return r.output_text;
  const parts: string[] = [];
  for (const item of r.output ?? []) {
    if (item.type !== "message") continue;
    for (const c of item.content ?? []) if (c.type === "output_text" && c.text) parts.push(c.text);
  }
  return parts.join("");
}
