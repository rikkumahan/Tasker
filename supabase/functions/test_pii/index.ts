import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-ignore
import { OpenRedaction } from "npm:openredaction";

serve(async (req) => {
  try {
    const redactor = new OpenRedaction({
      includeNames: false,
      includeEmails: false,
      includeAddresses: false,
      includePhones: true,
      deterministic: true,
    });

    const sample = "My password is Sk8rBoi123 and AWS key is AKIA1234567890123456.";
    const result = await redactor.detect(sample);

    return new Response(
      JSON.stringify({
        success: true,
        redacted: result.redacted,
        detections: result.detections,
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        success: false,
        error: err.message,
        stack: err.stack,
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
