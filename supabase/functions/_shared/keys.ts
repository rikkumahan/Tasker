// ─────────────────────────────────────────────
// 4-Key Round-Robin LLM Pool (120 RPM)
// Each key belongs to a separate Groq organization.
// 4 keys × 30 RPM = 120 RPM aggregate capacity.
// ─────────────────────────────────────────────
let keyIndex = 0;

export const getNextKey = (): string => {
  const keys = [
    Deno.env.get("GROQ_API_KEY") || "",
    Deno.env.get("GROQ_API_KEY_B") || Deno.env.get("GROQ_API_KEY") || "",
    Deno.env.get("GROQ_API_KEY_C") || Deno.env.get("GROQ_API_KEY") || "",
    Deno.env.get("GROQ_API_KEY_D") || Deno.env.get("GROQ_API_KEY") || "",
  ];
  const key = keys[keyIndex % keys.length];
  keyIndex++;
  return key;
};

// Persona Evolution uses a dedicated key (isolated, low volume)
export const getPersonaKey = (): string =>
  Deno.env.get("GROQ_API_KEY_D") || Deno.env.get("GROQ_API_KEY_B") || Deno.env.get("GROQ_API_KEY") || "";
