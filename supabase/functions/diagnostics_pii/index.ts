import { pipeline, env } from "https://esm.sh/@huggingface/transformers@3.0.0-alpha.19";

// Disable local file checks
env.allowLocalModels = false;

Deno.serve(async (req) => {
  const t0 = performance.now();
  try {
    console.log("Environment:", JSON.stringify(env));
    console.log("Loading Piiranha model via esm.sh...");
    
    // Explicitly set the host if needed, but transformers.js usually figures it out
    const classifier = await pipeline('token-classification', 'onnx-community/piiranha-v1-detect-personal-information-ONNX', { 
      dtype: 'q8',
      device: 'cpu' 
    });
    
    const t1 = performance.now();
    const id2label = classifier.model.config.id2label;
    
    const text = "Hi, my name is John Doe, email me at john.doe@gmail.com";
    const results = await classifier(text, { aggregation_strategy: "simple" });
    const t2 = performance.now();

    return new Response(JSON.stringify({
      status: "success",
      load_time_ms: t1 - t0,
      inference_time_ms: t2 - t1,
      id2label: id2label,
      results: results
    }), { headers: { "Content-Type": "application/json" } });
  } catch (err: any) {
    console.error("Diagnostic Error:", err);
    return new Response(JSON.stringify({
      status: "error",
      error: err.message,
      stack: err.stack
    }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
