#!/bin/bash
# Ghost Tasks Production Verification Test Runner
# This script runs comprehensive tests on the production Tasker app

echo "========================================"
echo "Ghost Tasks Production Verification"
echo "========================================"
echo ""
echo "Testing: https://tasker-kappa-flame.vercel.app"
echo "Timestamp: $(date)"
echo ""

# Run Playwright test
echo "Installing Playwright browsers (first run only)..."
npx playwright install

echo ""
echo "Starting comprehensive production tests..."
npx playwright test test-ghost-tasks-production.ts --reporter=list

echo ""
echo "========================================"
echo "Test Results"
echo "========================================"
echo ""

if [ -f "test-results/ghost-tasks-verification/detailed-report.json" ]; then
  echo "Detailed Report:"
  cat test-results/ghost-tasks-verification/detailed-report.json | jq '.'
  echo ""
  echo "Screenshots saved to: test-results/ghost-tasks-verification/"
  echo "HTML Report: test-results/report/index.html"
else
  echo "Test report not found. Check test output above for details."
fi

echo ""
echo "========================================"
echo "Done!"
echo "========================================"
