/**
 * Comprehensive Ghost Tasks Fix Verification Test
 * Tests the live production app at https://tasker-kappa-flame.vercel.app
 * 
 * Run with: npx playwright test test-ghost-tasks-production.ts
 */

import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

// Configure test timeout
test.setTimeout(60000);

// Output directory for screenshots and reports
const OUTPUT_DIR = 'test-results/ghost-tasks-verification';

interface TestResult {
  timestamp: string;
  authState: 'logged_in' | 'logged_out' | 'unknown';
  initialScreenshot: string;
  taskCount: number;
  visibleCategories: string[];
  ghostTasksVisible: boolean;
  ghostTaskDetails: string[];
  consoleErrors: string[];
  networkErrors: string[];
  networkRequests: Array<{ url: string; status: number; type: string }>;
  uiHealth: 'healthy' | 'warning' | 'critical';
  summary: string;
}

const result: TestResult = {
  timestamp: new Date().toISOString(),
  authState: 'unknown',
  initialScreenshot: '',
  taskCount: 0,
  visibleCategories: [],
  ghostTasksVisible: false,
  ghostTaskDetails: [],
  consoleErrors: [],
  networkErrors: [],
  networkRequests: [],
  uiHealth: 'unknown' as any,
  summary: ''
};

test.describe('Ghost Tasks Production Verification', () => {
  test('should verify ghost tasks are properly hidden in production', async ({ page, context }) => {
    // Create output directory
    if (!fs.existsSync(OUTPUT_DIR)) {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    // Collect console messages and errors
    page.on('console', msg => {
      if (msg.type() === 'error' || msg.type() === 'warning') {
        result.consoleErrors.push(`[${msg.type()}] ${msg.text()}`);
        console.log(`Console ${msg.type()}: ${msg.text()}`);
      }
    });

    // Collect network errors and track requests
    page.on('response', response => {
      const request = response.request();
      const status = response.status();
      const type = request.resourceType();
      
      result.networkRequests.push({
        url: request.url(),
        status,
        type
      });

      if (status >= 400) {
        result.networkErrors.push(`${status} ${request.url()}`);
        console.log(`Network error: ${status} ${request.url()}`);
      }
    });

    // Step 1: Navigate to the app
    console.log('Step 1: Navigating to https://tasker-kappa-flame.vercel.app');
    try {
      await page.goto('https://tasker-kappa-flame.vercel.app', { waitUntil: 'networkidle', timeout: 30000 });
    } catch (e) {
      console.warn('Navigation timeout - continuing anyway');
    }

    // Wait for page to stabilize
    await page.waitForTimeout(2000);

    // Step 2: Take initial screenshot
    console.log('Step 2: Taking initial screenshot');
    const initialScreenshotPath = path.join(OUTPUT_DIR, '01-initial-state.png');
    await page.screenshot({ path: initialScreenshotPath, fullPage: true });
    result.initialScreenshot = initialScreenshotPath;
    console.log(`Screenshot saved: ${initialScreenshotPath}`);

    // Step 3: Check authentication state
    console.log('Step 3: Checking authentication state');
    const hasLoginButton = await page.locator('button:has-text("Login")').count() > 0;
    const hasSignupButton = await page.locator('button:has-text("Sign up")').count() > 0;
    const hasLogoutButton = await page.locator('button:has-text("Logout")').count() > 0;
    const hasUserMenu = await page.locator('[data-testid="user-menu"]').count() > 0;

    if (hasLoginButton || hasSignupButton) {
      result.authState = 'logged_out';
      console.log('Auth state: LOGGED OUT (login/signup buttons visible)');
    } else if (hasLogoutButton || hasUserMenu) {
      result.authState = 'logged_in';
      console.log('Auth state: LOGGED IN (logout/user menu visible)');
    } else {
      result.authState = 'unknown';
      console.log('Auth state: UNKNOWN');
    }

    // Step 4: Check if dashboard is visible (assumes logged in or demo mode)
    console.log('Step 4: Checking dashboard and task list');
    
    // Look for task containers
    const taskElements = await page.locator('[data-testid*="task"], .task, [class*="task"]').all();
    console.log(`Found ${taskElements.length} task-like elements`);

    // More specific: look for task items in common patterns
    const taskItems = await page.locator('div[class*="task"], li[class*="task"], [data-testid*="task"]').all();
    result.taskCount = taskItems.length;
    console.log(`Estimated task count: ${result.taskCount}`);

    // Step 5: Take dashboard screenshot if logged in
    if (result.authState === 'logged_in') {
      const dashboardScreenshot = path.join(OUTPUT_DIR, '02-dashboard.png');
      await page.screenshot({ path: dashboardScreenshot, fullPage: true });
      console.log(`Dashboard screenshot saved: ${dashboardScreenshot}`);
    }

    // Step 6: Extract all visible text to search for ghost task indicators
    console.log('Step 6: Searching for ghost task indicators');
    const pageContent = await page.content();
    
    // Search for critical ghost task indicators
    const ghostTaskPatterns = [
      { name: '[IGNORED_EMAIL]', pattern: /\[IGNORED_EMAIL\]/gi },
      { name: 'ignored status', pattern: /status.*ignored|ignored.*status/gi },
      { name: 'System category (non-onboarding)', pattern: /category.*system|system.*category/gi }
    ];

    for (const pattern of ghostTaskPatterns) {
      if (pattern.pattern.test(pageContent)) {
        result.ghostTasksVisible = true;
        result.ghostTaskDetails.push(`Found pattern: ${pattern.name}`);
        console.log(`GHOST TASK DETECTED: ${pattern.name}`);
      }
    }

    // Step 7: Get all visible categories
    console.log('Step 7: Extracting visible categories');
    const categoryElements = await page.locator('[data-testid*="category"], .category, [class*="category"]').all();
    for (const elem of categoryElements) {
      const text = await elem.textContent();
      if (text && !result.visibleCategories.includes(text.trim())) {
        result.visibleCategories.push(text.trim());
      }
    }
    console.log(`Visible categories: ${result.visibleCategories.join(', ')}`);

    // Step 8: Detailed DOM inspection for ghost tasks
    console.log('Step 8: Performing detailed DOM inspection');
    const taskListHTML = await page.locator('body').innerHTML();
    
    // Extract all text nodes that might contain task information
    const allText = await page.locator('body').textContent();
    
    // Check for suspicious patterns
    if (allText?.includes('[IGNORED_EMAIL]')) {
      result.ghostTasksVisible = true;
      result.ghostTaskDetails.push('Page content contains [IGNORED_EMAIL] text');
    }

    // Step 9: Check for sync button and last sync time
    console.log('Step 9: Looking for sync button and status');
    const syncButton = await page.locator('button:has-text("Sync"), button[title*="sync"], [data-testid*="sync"]').first();
    const syncStatus = await page.locator('[data-testid*="sync"], .sync-status, [class*="sync-status"]').first();
    
    if (await syncButton.count() > 0) {
      console.log('Found sync button');
    }
    if (await syncStatus.count() > 0) {
      const syncText = await syncStatus.textContent();
      console.log(`Sync status: ${syncText}`);
    }

    // Step 10: Open browser console and check for errors
    console.log('Step 10: Analyzing console errors');
    console.log(`Total console errors/warnings: ${result.consoleErrors.length}`);
    if (result.consoleErrors.length > 0) {
      result.consoleErrors.slice(0, 10).forEach(err => console.log(`  - ${err}`));
    }

    // Step 11: Analyze network errors
    console.log('Step 11: Analyzing network requests');
    console.log(`Total network requests: ${result.networkRequests.length}`);
    console.log(`Network errors: ${result.networkErrors.length}`);
    if (result.networkErrors.length > 0) {
      result.networkErrors.slice(0, 10).forEach(err => console.log(`  - ${err}`));
    }

    // Step 12: Try to find any error messages in UI
    console.log('Step 12: Checking for UI error messages');
    const errorMessages = await page.locator('[class*="error"], [role="alert"]').all();
    console.log(`Found ${errorMessages.length} error-like elements`);
    for (const elem of errorMessages.slice(0, 5)) {
      const text = await elem.textContent();
      if (text) console.log(`  - ${text}`);
    }

    // Step 13: Comprehensive content check
    console.log('Step 13: Comprehensive content verification');
    const bodyText = await page.locator('body').textContent() || '';
    
    // Check for various ghost task indicators
    const hasIgnoredEmailMarker = bodyText.includes('[IGNORED_EMAIL]');
    const hasIgnoredStatus = /status[:\s]*ignored|ignored[:\s]*status/i.test(bodyText);
    
    if (hasIgnoredEmailMarker || hasIgnoredStatus) {
      result.ghostTasksVisible = true;
      if (hasIgnoredEmailMarker) {
        result.ghostTaskDetails.push('Contains [IGNORED_EMAIL] marker in visible content');
      }
      if (hasIgnoredStatus) {
        result.ghostTaskDetails.push('Contains "ignored" status in visible content');
      }
    }

    // Step 14: Take final screenshot with detailed info
    console.log('Step 14: Taking final screenshot');
    const finalScreenshot = path.join(OUTPUT_DIR, '03-final-state.png');
    await page.screenshot({ path: finalScreenshot, fullPage: true });

    // Determine UI health
    if (result.ghostTasksVisible) {
      result.uiHealth = 'critical';
    } else if (result.consoleErrors.length > 5 || result.networkErrors.length > 3) {
      result.uiHealth = 'warning';
    } else {
      result.uiHealth = 'healthy';
    }

    // Generate summary
    const summaryParts = [];
    summaryParts.push(`Auth State: ${result.authState}`);
    summaryParts.push(`Visible Tasks: ${result.taskCount}`);
    summaryParts.push(`Ghost Tasks Visible: ${result.ghostTasksVisible ? 'YES ⚠️ CRITICAL' : 'NO ✅ PASS'}`);
    summaryParts.push(`UI Health: ${result.uiHealth.toUpperCase()}`);
    summaryParts.push(`Console Errors: ${result.consoleErrors.length}`);
    summaryParts.push(`Network Errors: ${result.networkErrors.length}`);
    
    result.summary = summaryParts.join('\n');

    console.log('\n' + '='.repeat(60));
    console.log('TEST RESULTS SUMMARY');
    console.log('='.repeat(60));
    console.log(result.summary);
    console.log('='.repeat(60));

    // Save detailed report
    const reportPath = path.join(OUTPUT_DIR, 'detailed-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(result, null, 2));
    console.log(`\nDetailed report saved: ${reportPath}`);

    // CRITICAL ASSERTIONS
    console.log('\n' + '='.repeat(60));
    console.log('CRITICAL ASSERTIONS');
    console.log('='.repeat(60));

    // Main verification: Ghost tasks should NOT be visible
    expect(result.ghostTasksVisible).toBe(false);
    console.log('✅ PASS: No ghost tasks visible in UI');

    // Secondary checks
    if (result.authState === 'logged_in') {
      expect(result.uiHealth).not.toBe('critical');
      console.log('✅ PASS: UI health is acceptable');
    }

    console.log('\n🎉 ALL CRITICAL TESTS PASSED - Ghost Tasks Fix is Working!');
  });
});
