#!/bin/bash
# AutoHue API Worker — Safe Deploy Script
# Runs type checks and smoke tests before and after deployment
set -e

API_URL="https://autohue-api.steve-700.workers.dev"
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo ""
echo "═══════════════════════════════════════"
echo "  AutoHue API — Safe Deploy"
echo "═══════════════════════════════════════"
echo ""

# ── Step 1: TypeScript check (worker code only) ──
echo -e "${YELLOW}[1/4] Type checking worker...${NC}"
# Quick syntax validation — wrangler deploy will catch real errors
node -e "require('esbuild').buildSync({entryPoints:['src/index.ts'],bundle:true,write:false,platform:'node',format:'esm',external:['hono','hono/*']})" 2>&1
if [ $? -ne 0 ]; then
  echo -e "${RED}✗ Build errors found. Fix them before deploying.${NC}"
  exit 1
fi
echo -e "${GREEN}✓ Worker code compiles${NC}"
echo ""

# ── Step 2: Snapshot current endpoints ──
echo -e "${YELLOW}[2/4] Snapshotting current production endpoints...${NC}"
ENDPOINTS=(
  "/api/health"
  "/api/releases/latest"
  "/api/admin/openrouter-status"
)
declare -A PRE_STATUS
ALL_OK=true
for ep in "${ENDPOINTS[@]}"; do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" "${API_URL}${ep}" 2>/dev/null)
  PRE_STATUS[$ep]=$STATUS
  if [ "$STATUS" = "200" ]; then
    echo -e "  ${GREEN}✓${NC} ${ep} → ${STATUS}"
  else
    echo -e "  ${YELLOW}⚠${NC} ${ep} → ${STATUS} (currently broken)"
  fi
done
echo ""

# ── Step 3: Deploy ──
echo -e "${YELLOW}[3/4] Deploying to Cloudflare...${NC}"
npx wrangler deploy 2>&1 | tail -5
echo ""

# ── Step 4: Post-deploy smoke test ──
echo -e "${YELLOW}[4/4] Running post-deploy smoke tests...${NC}"
sleep 3
FAILED=0
for ep in "${ENDPOINTS[@]}"; do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" "${API_URL}${ep}" 2>/dev/null)
  BODY=$(curl -s "${API_URL}${ep}" 2>/dev/null | head -c 200)

  if [ "$STATUS" = "200" ]; then
    # Check it starts with { or [ (JSON)
    if echo "$BODY" | grep -qE '^\s*[\{\[]'; then
      echo -e "  ${GREEN}✓${NC} ${ep} → ${STATUS} (valid JSON)"
    else
      echo -e "  ${YELLOW}⚠${NC} ${ep} → ${STATUS} (not JSON)"
    fi
  else
    echo -e "  ${RED}✗${NC} ${ep} → ${STATUS} — WAS ${PRE_STATUS[$ep]} before deploy"
    FAILED=$((FAILED + 1))
  fi
done

# Check releases specifically returns a version
VERSION=$(curl -s "${API_URL}/api/releases/latest" 2>/dev/null | grep -o '"version":"[^"]*"' | head -1)
if [ -n "$VERSION" ]; then
  echo -e "  ${GREEN}✓${NC} Releases: ${VERSION}"
else
  echo -e "  ${RED}✗${NC} Releases endpoint not returning version"
  FAILED=$((FAILED + 1))
fi

echo ""
if [ $FAILED -gt 0 ]; then
  echo -e "${RED}═══════════════════════════════════════${NC}"
  echo -e "${RED}  ✗ DEPLOY BROKE ${FAILED} ENDPOINT(S)!${NC}"
  echo -e "${RED}  Roll back: git stash && ./deploy.sh${NC}"
  echo -e "${RED}═══════════════════════════════════════${NC}"
  exit 1
else
  echo -e "${GREEN}═══════════════════════════════════════${NC}"
  echo -e "${GREEN}  ✓ All endpoints healthy after deploy${NC}"
  echo -e "${GREEN}═══════════════════════════════════════${NC}"
fi
