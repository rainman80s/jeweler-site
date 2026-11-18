#!/usr/bin/env bash
# Deploys the Worker. Treats the "free plan cron limit" error as a warning:
# the code is already live at that point, only the hourly schedule wasn't saved.
set -uo pipefail
out=$(npx wrangler deploy 2>&1); code=$?
echo "$out"
if [ $code -ne 0 ]; then
  if echo "$out" | grep -q "10072"; then
    echo "::warning title=Hourly schedule not saved::Cloudflare free plan cron limit reached (5 per account). Site is deployed; automations still run from the admin buttons. Free a cron slot or upgrade to Workers Paid."
    exit 0
  fi
  exit $code
fi
