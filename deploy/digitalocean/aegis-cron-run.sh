#!/bin/sh
# Runs one imperium-api script inside the live API container. Called by
# /etc/cron.d/aegis-automation (installed from aegis-automation.cron by the
# deploy workflow) as: aegis-cron-run scripts/run_tender_automation.py
#
# Why not `docker compose exec`: the blue/green deploy leaves the API as
# container #2, #3, ... and `compose exec` defaults to container #1, so a
# plain exec failed whenever #1 had been drained. This picks the newest
# running imperium-api container instead (during a rollout that is the new
# one, which is not about to be stopped).
set -eu

SCRIPT="${1:?usage: aegis-cron-run scripts/<name>.py}"
NAME=$(basename "$SCRIPT" .py)
stamp() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# One run per script at a time (a tender discovery takes ~12 min).
exec 9>"/tmp/aegis-cron-$NAME.lock"
if ! flock -n 9; then
  echo "$(stamp) $NAME: previous run still going - skipped"
  exit 0
fi

cd /opt/aegis
IDS=$(docker compose -f deploy/digitalocean/docker-compose.yml --env-file deploy/digitalocean/.env \
  ps -q --status running imperium-api)
if [ -z "$IDS" ]; then
  echo "$(stamp) $NAME: no running imperium-api container"
  exit 1
fi
# shellcheck disable=SC2086 # one id per word
CONTAINER=$(docker inspect -f '{{.Created}} {{.Id}}' $IDS | sort -r | head -1 | cut -d' ' -f2)

echo "$(stamp) $NAME: start (container $(echo "$CONTAINER" | cut -c1-12))"
if docker exec "$CONTAINER" python3 "$SCRIPT"; then
  echo "$(stamp) $NAME: ok"
else
  status=$?
  echo "$(stamp) $NAME: FAILED (exit $status)"
  exit "$status"
fi
