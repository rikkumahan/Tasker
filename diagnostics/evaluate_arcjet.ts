import { redact } from "https://esm.sh/@arcjet/redact@0.1.5";

const text = "Hi my email is rikku@example.com and password is Password123!";

try {
  let [redacted, unredact] = await redact(text, {
    entities: ["email", "password"],
    contextWindowSize: 5,
    detect: (tokens) => {
      return tokens.map((token, i) => {
        const prevToken = i > 0 ? tokens[i - 1]?.toLowerCase() : "";
        if ((prevToken === "password" || prevToken === "password:") && token.length > 5) {
          return "password";
        }
        return undefined;
      });
    }
  });

  console.log("REDACTED:", redacted);
  console.log("UNREDACTED:", unredact(redacted));
} catch (e) {
  console.error("Redact failed", e);
}
