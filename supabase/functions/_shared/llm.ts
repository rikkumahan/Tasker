import { getNextKey } from "./keys.ts";
import { sleep } from "./utils.ts";

export interface LLMOptions {
  model?: string;
  temperature?: number;
  maxAttempts?: number;
  jsonFormat?: boolean;
  reasoningEffort?: "low" | "medium" | "high";
}

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

/**
 * Invokes the Groq LLM API with built-in retry and 429 backoff logic.
 */
export async function callLLM(prompt: string, options: LLMOptions = {}): Promise<string> {
  const {
    model = "openai/gpt-oss-120b",
    temperature = 0.2,
    maxAttempts = 3,
    jsonFormat = false,
    reasoningEffort = "low",
  } = options;

  let attempts = maxAttempts;

  while (attempts > 0) {
    const key = getNextKey();
    try {
      const payload: any = {
        model,
        messages: [{ role: "user", content: prompt }],
        temperature,
        reasoning_effort: reasoningEffort,
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
        if (attempts === 0) {
          console.error(`[LLM] Rate limit exhausted after ${maxAttempts} attempts.`);
          break;
        }
        
        // Read Retry-After header (in seconds), fallback to exponential backoff
        const retryAfterStr = res.headers.get("retry-after");
        let delayMs = 1000;
        
        if (retryAfterStr && !isNaN(parseInt(retryAfterStr, 10))) {
          delayMs = parseInt(retryAfterStr, 10) * 1000;
        } else {
          // Exponential backoff: 2s, 4s, 8s...
          const attemptNum = maxAttempts - attempts;
          delayMs = Math.pow(2, attemptNum) * 1000;
        }
        
        console.warn(`[LLM] 429 Rate Limit hit. Backing off for ${delayMs}ms before retry ${maxAttempts - attempts}/${maxAttempts}...`);
        await sleep(delayMs);
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
