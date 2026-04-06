import { pipeline, env } from "@huggingface/transformers";

// Disable local model loading (force download from Hugging Face Hub)
env.allowLocalModels = false;

const testInput = "John Doe lives at 123 Main St, New York. His email is john.doe@secret.com and his SSN is 000-11-2222.";

async function runTest(dtypeStr, config) {
  console.log(`\n========================================`);
  console.log(`🧪 Testing Quantization: ${dtypeStr}`);
  console.log(`========================================`);
  
  const startLoad = performance.now();
  try {
    const classifier = await pipeline(
      'token-classification', 
      'onnx-community/piiranha-v1-detect-personal-information-ONNX', 
      config
    );
    const loadTime = performance.now() - startLoad;
    console.log(`✅ Model Loaded in ${loadTime.toFixed(2)} ms.`);

    console.log(`⏳ Running inference...`);
    const startInf = performance.now();
    const results = await classifier(testInput, { aggregation_strategy: "simple" });
    const infTime = performance.now() - startInf;
    
    console.log(`✅ Inference completed in ${infTime.toFixed(2)} ms.`);
    console.log(`📊 Detected Entities:`);
    console.table(results);
    
  } catch (e) {
    console.error(`❌ Failed to load/run model with config: ${JSON.stringify(config)}`, e.message);
  }
}

async function main() {
  console.log("Starting Piiranha Quantization Deep Test...");
  console.log(`Input String: "${testInput}"`);
  
  // Test 1: 8-bit Quantized (Current Edge Function Setup)
  await runTest("q8 (8-bit integer)", { dtype: 'q8' });

  // Test 2: Unquantized (fp32)
  await runTest("fp32 (Unquantized floating point)", { dtype: 'fp32' });

  // Test 3: 4-bit Quantized
  await runTest("q4 (4-bit integer, max compression)", { dtype: 'q4' });
  
  console.log(`\nTest Complete.`);
}

main();
