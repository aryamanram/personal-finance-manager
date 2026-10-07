#!/bin/bash
# Run `npm run sync` once a day, with launchd (macOS): at midnight, or at the
# first login after a day the Mac missed.
#
#   npm run sync:schedule -- install            # schedule it
#   npm run sync:schedule -- install --dry-run  # same, but the job only checks
#   npm run sync:schedule -- status             # last run, and the log tail
#   npm run sync:schedule -- remove
#
# Local and free: one SimpleFIN request on a normal day (one per 45-day
# window when catching up further), nothing else.
#
# launchd rather than cron because it does the right thing with a laptop.
# The job fires at midnight and at login; each time it syncs only if no sync
# has succeeded since the last midnight. So: asleep at midnight, it runs on
# waking; off, it runs at the next login; already synced today — by the job
# or by hand — and a login does nothing at all, not even start Docker.
#
# No retries within a run, deliberately: the bridge disables a token that
# keeps exceeding ~24 requests a day. A failed day is retried at the next
# login or midnight, and every sync re-fetches from five days before the last
# good one, so nothing is lost.
#
# The job's runner is written OUTSIDE the repo, so it works whatever branch
# is checked out at midnight. It only needs `npm run sync` to exist.
set -euo pipefail

LABEL=local.personal-finance-manager.sync
REPO="$(cd "$(dirname "$0")/.." && pwd)"
SUPPORT="$HOME/Library/Application Support/personal-finance-manager"
RUNNER="$SUPPORT/sync-nightly.sh"
# Touched after each scheduled sync that the bridge answered. Read before
# Docker is started, so a day already done costs nothing.
MARKER="$SUPPORT/last-sync"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/personal-finance-manager-sync.log"
DOMAIN="gui/$(id -u)"

need() {
  command -v "$1" >/dev/null 2>&1 || { echo "! $1 is not on PATH" >&2; exit 3; }
}

# A value for a plist <string>: escape what XML gives meaning to. sed rather
# than ${//}, whose '&' means "the match" under bash 5.2's patsub_replacement.
xml() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }

loaded() { launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; }

install() {
  local dry="${1:-}"
  need node; need npm; need docker
  # launchd starts jobs with a bare PATH, so carry the directories that hold
  # node, npm and docker into the runner.
  local path_dirs
  path_dirs="$(dirname "$(command -v node)"):$(dirname "$(command -v npm)"):$(dirname "$(command -v docker)"):/usr/bin:/bin:/usr/sbin:/sbin"

  mkdir -p "$SUPPORT" "$(dirname "$PLIST")" "$(dirname "$LOG")"

  # Baked into the runner as shell words, quoted, so a path with a space,
  # quote or '$' in it stays one literal argument.
  local repo_q path_q marker_q
  repo_q=$(printf '%q' "$REPO")
  path_q=$(printf '%q' "$path_dirs")
  marker_q=$(printf '%q' "$MARKER")

  cat > "$RUNNER" <<RUNNER
#!/bin/bash
# Written by scripts/sync-schedule.sh — re-run its install to change this.
export PATH=$path_q
echo "=== \$(date '+%Y-%m-%d %H:%M:%S %Z')"
cd $repo_q || { echo "! repo not found: "$repo_q; exit 3; }

dry=\${1:-}
marker=$marker_q
midnight=\$(date -j -v0H -v0M -v0S +%s)

# Once a day. Checked before Docker, so a login on a day already done starts
# nothing and calls no one. A rehearsal skips this to exercise the rest.
if [ "\$dry" != --dry-run ] && [ -f "\$marker" ] && [ "\$(stat -f %m "\$marker")" -ge "\$midnight" ]; then
  echo "· already synced today — nothing to do"
  exit 0
fi

# The ledger lives in Docker: start it if it is not running.
if ! docker info >/dev/null 2>&1; then
  echo "· starting Docker"
  open -a Docker
  for _ in \$(seq 1 90); do docker info >/dev/null 2>&1 && break; sleep 2; done
fi
docker compose up -d >/dev/null 2>&1 || true
ready=no
for _ in \$(seq 1 60); do
  if docker exec finance-db pg_isready -q -U finance -d finance 2>/dev/null; then ready=yes; break; fi
  sleep 2
done
if [ "\$ready" != yes ]; then echo "! database not reachable — skipped; the next run catches up"; exit 1; fi

# A sync run by hand counts too: sync_runs records every run, whoever started it.
last=\$(docker exec finance-db psql -U finance -d finance -At -c \\
  "SELECT coalesce(extract(epoch FROM max(started_at))::bigint, 0) FROM sync_runs WHERE status IN ('ok','partial')" 2>/dev/null)
if [ "\${last:-0}" -ge "\$midnight" ]; then
  [ "\$dry" = --dry-run ] || touch "\$marker"
  echo "· already synced today — nothing to do\${dry:+ (dry run)}"
  exit 0
fi

if [ "\$dry" = --dry-run ]; then
  echo "· dry run: database ready, npm \$(npm --version) found, a sync is due — would run npm run sync"
  exit 0
fi
npm run sync
code=\$?
# 0 ok; 2 partial — one connection needs attention, the rest synced. Either
# way the bridge answered, and today is done.
if [ "\$code" -eq 0 ] || [ "\$code" -eq 2 ]; then touch "\$marker"; fi
exit \$code
RUNNER
  chmod 700 "$RUNNER"

  local extra=""
  [ "$dry" = "--dry-run" ] && extra="<string>--dry-run</string>"
  cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>$(xml "$RUNNER")</string>$extra</array>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>0</integer><key>Minute</key><integer>0</integer></dict>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$(xml "$LOG")</string>
  <key>StandardErrorPath</key><string>$(xml "$LOG")</string>
</dict>
</plist>
PLIST
  plutil -lint "$PLIST" >/dev/null

  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
  launchctl bootstrap "$DOMAIN" "$PLIST"
  echo "✓ scheduled: once a day, at 00:00 or the first login after a missed day${dry:+ (dry run — the job only checks, it does not sync)}"
  echo "  log: $LOG"
}

remove() {
  if loaded; then
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    for _ in 1 2 3 4 5; do loaded || break; sleep 1; done
    # Deleting the runner under a job launchd still holds would leave it
    # firing at midnight at a file that is not there.
    if loaded; then
      echo "! launchd still has the job loaded; its files are left in place." >&2
      echo "  Try again, or: launchctl bootout $DOMAIN/$LABEL" >&2
      exit 1
    fi
  fi
  rm -f "$PLIST" "$RUNNER" "$MARKER"
  echo "✓ removed"
}

status() {
  if ! launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
    echo "not scheduled"
    return
  fi
  # Top-level fields only: they sit one tab in; nested sections repeat "state".
  launchctl print "$DOMAIN/$LABEL" | grep -E $'^\t(state|runs|last exit code) =' | sed $'s/^\t/  /'
  grep -q -- '--dry-run' "$PLIST" && echo "  mode = dry run" || echo "  mode = live"
  if [ -f "$MARKER" ]; then
    echo "  last scheduled sync = $(date -r "$(stat -f %m "$MARKER")" '+%Y-%m-%d %H:%M %Z')"
  fi
  if [ -f "$LOG" ]; then echo "  log ($LOG):"; tail -n 8 "$LOG" | sed 's/^/    /'; fi
}

case "${1:-}" in
  install)
    # A typo must not quietly install a LIVE job in place of a rehearsal.
    case "${2:-}" in
      ""|--dry-run) install "${2:-}" ;;
      *) echo "unknown install option: $2 (the only one is --dry-run)" >&2; exit 2 ;;
    esac ;;
  remove)  remove ;;
  status)  status ;;
  *) echo "usage: npm run sync:schedule -- install [--dry-run] | status | remove" >&2; exit 2 ;;
esac
