import { getNextKey } from "./keys.ts";
import { sleep } from "./utils.ts";

export interface LLMOptions {
  model?: string;
  temperature?: number;
  maxAttempts?: number;
  jsonFormat?: boolean;
}

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

/**
 * Invokes the Groq LLM API with built-in retry and 429 backoff logic.
 */
export async function callLLM(prompt: string, options: LLMOptions = {}): Promise<string> {
  const {
    model = "meta-llama/llama-4-scout-17b-16e-instruct",
    temperature = 0.2,
    maxAttempts = 3,
    jsonFormat = false,
  } = options;

  let attempts = maxAttempts;

  while (attempts > 0) {
    const key = getNextKey();
    try {
      const payload: any = {
        model,
        messages: [{ role: "user", content: prompt }],
        temperature,
      };

      if (jsonFormat) {
        payload.response_format = { type: "json_object" };
      }

      const res = await fetch(GROQ_API_URL, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${key}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      if (res.status === 429) {
        attempts--;
        await sleep(1000);
        continue;
      }

      if (res.ok) {
        const data = await res.json();
        return data.choices?.[0]?.message?.content || "";
      }

      console.error(`[LLM] HTTP ${res.status}: ${await res.text().catch(() => "")}`);
    } catch (err: any) {
      console.error(`[LLM] Error calling Groq: ${err.message}`);
    }
    
    attempts--;
  }

  return "";
}
