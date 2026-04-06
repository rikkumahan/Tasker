import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

// THE AUTOMATED OPTIMIZER
// This script identifies exactly where the PII shield is leaking and provides the next-step solution.
async function optimize() {
  console.log('\n🔍 Running Auto-Tuner Optimization Cycle...\n');

  try {
    // 1. Run the Evaluation Suite
    const rawResult = execSync('node run_deep_test.mjs', { cwd: 'diagnostics', encoding: 'utf8' });
    if (rawResult.includes('100% ACCURACY!')) {
      console.log('✅ SYSTEM VERIFIED: All shields holding at 100%.\n');
      return;
    }

    // 2. Identify Failures
    const lines = rawResult.split('\n');
    const failures = lines.filter(l => l.includes('FAIL'));

    if (failures.length > 0) {
      console.log('⚠️ SHIELD LEAK DETECTED: ' + failures.length + ' cases failing.\n');
      console.log('--- FAILURE SYNTHESIS ---');
      failures.forEach(f => console.log(' -> ' + f));
      console.log('\n💡 AUTOMATED ADVICE:');
      console.log('Add the failing patterns to your SECRET_REGEXES or increase Shannon Entropy thresholds.');
      console.log('Copy the failure report below to your AI assistant for a 1-click fix.');
      console.log('-------------------------\n');
      
      // Save for AI consumption
      fs.writeFileSync('diagnostics/tuning_report.log', rawResult, 'utf8');
    }
  } catch (err) {
    console.error('❌ Optimization Error:', err.message);
  }
}

optimize();
