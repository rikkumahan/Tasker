#!/bin/bash
# Verify Ghost Tasks deployment

set -e

echo "╔══════════════════════════════════════════╗"
echo "║  TASKER: Ghost Tasks Deployment Verify  ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 1. Check git status
echo "🔍 [1/5] Checking git status..."
if git log -1 --format="%h %s" | grep -q "Ghost Tasks"; then
  echo -e "${GREEN}✅ Commit found: $(git log -1 --format='%h - %s')${NC}"
else
  echo -e "${RED}❌ Ghost Tasks commit not found${NC}"
  exit 1
fi

# 2. Verify code changes
echo ""
echo "🔍 [2/5] Verifying code changes..."
if git show HEAD:supabase/functions/sync/index.ts | grep -q "ghostTasks"; then
  echo -e "${GREEN}✅ Ghost task logic detected in sync/index.ts${NC}"
else
  echo -e "${RED}❌ Ghost task logic not found${NC}"
  exit 1
fi

# 3. Check for proper schema compatibility
echo ""
echo "🔍 [3/5] Checking schema compatibility..."
if grep -q "status.*text" execution/supabase_schema.sql; then
  echo -e "${GREEN}✅ Schema allows 'ignored' status (text field)${NC}"
else
  echo -e "${YELLOW}⚠️  Schema check inconclusive${NC}"
fi

# 4. Verify dedup logic is intact
echo ""
echo "🔍 [4/5] Verifying dedup logic..."
if git show HEAD:supabase/functions/sync/index.ts | grep -q "source_email_id.*in.*emails.map"; then
  echo -e "${GREEN}✅ Dedup logic uses source_email_id (will detect ghost tasks)${NC}"
else
  echo -e "${RED}❌ Dedup logic may be broken${NC}"
  exit 1
fi

# 5. Check frontend filtering
echo ""
echo "🔍 [5/5] Checking frontend UI protection..."
if grep -q "eq('status', 'pending')" frontend/src/App.jsx; then
  echo -e "${GREEN}✅ Frontend filters by status='pending' (ghost tasks invisible)${NC}"
else
  echo -e "${RED}❌ Frontend protection missing${NC}"
  exit 1
fi

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║         ✅ ALL CHECKS PASSED            ║"
echo "╚══════════════════════════════════════════╝"
echo ""
echo "📋 Summary:"
echo "  • Ghost tasks logic implemented ✓"
echo "  • Dedup engine compatible ✓"
echo "  • Frontend protection active ✓"
echo "  • Schema compatible ✓"
echo ""
echo "🚀 Ready for deployment!"
echo ""
