# Ghost Tasks Production Verification Test Runner (Windows PowerShell)
# This script runs comprehensive tests on the production Tasker app

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Ghost Tasks Production Verification" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Testing: https://tasker-kappa-flame.vercel.app" -ForegroundColor Yellow
Write-Host "Timestamp: $(Get-Date)" -ForegroundColor Yellow
Write-Host ""

# Run Playwright test
Write-Host "Installing Playwright browsers (first run only)..." -ForegroundColor Green
npx playwright install

Write-Host ""
Write-Host "Starting comprehensive production tests..." -ForegroundColor Green
npx playwright test test-ghost-tasks-production.ts --reporter=list

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Test Results" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

if (Test-Path "test-results/ghost-tasks-verification/detailed-report.json") {
  Write-Host "Detailed Report:" -ForegroundColor Green
  $report = Get-Content "test-results/ghost-tasks-verification/detailed-report.json" | ConvertFrom-Json
  Write-Host ($report | ConvertTo-Json -Depth 10)
  Write-Host ""
  Write-Host "Screenshots saved to: test-results/ghost-tasks-verification/" -ForegroundColor Yellow
  Write-Host "HTML Report: test-results/report/index.html" -ForegroundColor Yellow
} else {
  Write-Host "Test report not found. Check test output above for details." -ForegroundColor Red
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Done!" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
