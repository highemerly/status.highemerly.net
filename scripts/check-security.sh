#!/bin/bash

# セキュリティチェックスクリプト
# デプロイ前に実行して、機密情報が含まれていないか確認

set -e

echo "=== Security Check ==="
echo ""

# カラーコード
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

ERRORS=0

# 1. services.json に機密情報が含まれていないかチェック
echo "1. Checking config/services.json..."

if grep -q '"auth"' config/services.json 2>/dev/null; then
  echo -e "${RED}✗ ERROR: 'auth' field found in services.json${NC}"
  ERRORS=$((ERRORS+1))
else
  echo -e "${GREEN}✓ OK: No 'auth' field${NC}"
fi

if grep -q '"username"' config/services.json 2>/dev/null; then
  echo -e "${RED}✗ ERROR: 'username' field found in services.json${NC}"
  ERRORS=$((ERRORS+1))
else
  echo -e "${GREEN}✓ OK: No 'username' field${NC}"
fi

if grep -q '"password"' config/services.json 2>/dev/null; then
  echo -e "${RED}✗ ERROR: 'password' field found in services.json${NC}"
  ERRORS=$((ERRORS+1))
else
  echo -e "${GREEN}✓ OK: No 'password' field${NC}"
fi

if grep -q '"webhookSecret"' config/services.json 2>/dev/null; then
  echo -e "${RED}✗ ERROR: 'webhookSecret' field found in services.json${NC}"
  ERRORS=$((ERRORS+1))
else
  echo -e "${GREEN}✓ OK: No 'webhookSecret' field${NC}"
fi

if grep -q '"discord"' config/services.json 2>/dev/null; then
  echo -e "${RED}✗ ERROR: 'discord' field found in services.json${NC}"
  ERRORS=$((ERRORS+1))
else
  echo -e "${GREEN}✓ OK: No 'discord' field${NC}"
fi

if grep -q '"prometheus"' config/services.json 2>/dev/null; then
  echo -e "${RED}✗ ERROR: 'prometheus' field found in services.json${NC}"
  ERRORS=$((ERRORS+1))
else
  echo -e "${GREEN}✓ OK: No 'prometheus' field${NC}"
fi

echo ""

# 2. .gitignore チェック
echo "2. Checking .gitignore..."

if ! grep -q "^/config/services.json" .gitignore; then
  echo -e "${GREEN}✓ OK: services.json is NOT in .gitignore (safe to commit)${NC}"
else
  echo -e "${YELLOW}⚠ WARNING: services.json should NOT be in .gitignore anymore${NC}"
fi

echo ""

# 3. 必要なファイルの存在確認
echo "3. Checking required files..."

if [ -f "config/services.json" ]; then
  echo -e "${GREEN}✓ OK: config/services.json exists${NC}"
else
  echo -e "${RED}✗ ERROR: config/services.json not found${NC}"
  ERRORS=$((ERRORS+1))
fi

echo ""

# 4. JSON 構文チェック
echo "4. Checking JSON syntax..."

if command -v jq &> /dev/null; then
  if jq empty config/services.json 2>/dev/null; then
    echo -e "${GREEN}✓ OK: services.json is valid JSON${NC}"
  else
    echo -e "${RED}✗ ERROR: services.json has invalid JSON syntax${NC}"
    ERRORS=$((ERRORS+1))
  fi
else
  echo -e "${YELLOW}⚠ WARNING: jq not installed, skipping JSON validation${NC}"
fi

echo ""

# 5. 必須フィールドの確認
echo "5. Checking required fields..."

if grep -q '"categories"' config/services.json; then
  echo -e "${GREEN}✓ OK: 'categories' field exists${NC}"
else
  echo -e "${RED}✗ ERROR: 'categories' field not found${NC}"
  ERRORS=$((ERRORS+1))
fi

if grep -q '"services"' config/services.json; then
  echo -e "${GREEN}✓ OK: 'services' field exists${NC}"
else
  echo -e "${RED}✗ ERROR: 'services' field not found${NC}"
  ERRORS=$((ERRORS+1))
fi

echo ""
echo "=== Security Check Completed ==="
echo ""

if [ $ERRORS -eq 0 ]; then
  echo -e "${GREEN}✓ All checks passed!${NC}"
  exit 0
else
  echo -e "${RED}✗ ${ERRORS} error(s) found. Please fix before deploying.${NC}"
  exit 1
fi
