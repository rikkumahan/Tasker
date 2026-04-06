import { pipeline } from '@huggingface/transformers';

async function test() {
    console.log("Deep Testing Piiranha Model Labels...");
    try {
        const classifier = await pipeline('token-classification', 'onnx-community/piiranha-v1-detect-personal-information-ONNX', {
            dtype: 'q8'
        });
        
        const text = "Hi, I am Rikku Mahan, my email is rikku@example.com and my password is 'Secret123'. I live at 123 Main St, New York, NY 10001.";
        const results = await classifier(text, { aggregation_strategy: "simple" });
        
        console.log("DETECTED ENTITIES:");
        console.log(JSON.stringify(results, null, 2));
        
        console.log("\nMODEL ID2LABEL:");
        console.log(JSON.stringify(classifier.model.config.id2label, null, 2));
        
    } catch (e) {
        console.error("FAILURE:", e);
    }
}

test();
