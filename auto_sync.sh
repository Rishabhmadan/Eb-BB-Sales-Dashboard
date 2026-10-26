#!/bin/bash

# Navigate to the project directory
cd "/Users/rishabh/Eb-BB Sales Dashboard" || exit 1

# Ensure standard bin paths are accessible
export PATH=/usr/bin:/usr/local/bin:/usr/sbin:/sbin:/bin:$PATH
export GIT_TERMINAL_PROMPT=0

# Prevent overlapping sync runs with a lockfile
PIDFILE="/tmp/elecbits_auto_sync.pid"
if [ -f "$PIDFILE" ]; then
    PID=$(cat "$PIDFILE" 2>/dev/null)
    if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
        echo "=== Sync skipped at $(date): Previous sync (PID $PID) still running ===" >> sync.log
        exit 0
    fi
fi
echo $$ > "$PIDFILE"
trap 'rm -f "$PIDFILE"' EXIT

# Prevent sync.log from growing unbounded (keep last 5000 lines if > 5MB)
if [ -f sync.log ]; then
    FILESIZE=$(wc -c < sync.log 2>/dev/null || echo 0)
    if [ "$FILESIZE" -gt 5242880 ]; then
        tail -n 5000 sync.log > sync.log.tmp && mv sync.log.tmp sync.log
    fi
fi

# Create log entry
echo "=== Sync started at $(date) ===" >> sync.log

# Run Odoo synchronization
if /usr/bin/python3 sync_odoo.py >> sync.log 2>&1; then
    # Check if leads_data.json has changed
    if /usr/bin/git status --porcelain | grep -q "leads_data.json"; then
        echo "Changes detected in leads_data.json, committing and pushing..." >> sync.log
        /usr/bin/git add leads_data.json >> sync.log 2>&1
        /usr/bin/git commit -m "data: automatic update from Odoo crm.lead" >> sync.log 2>&1
        if /usr/bin/git push origin main >> sync.log 2>&1; then
            echo "Push completed successfully!" >> sync.log
        else
            echo "[ERROR] Git push failed. Will retry on next sync interval." >> sync.log
        fi
    else
        echo "No new changes detected in Odoo CRM data." >> sync.log
    fi
else
    echo "[ERROR] Odoo sync script failed. Skipping git commit." >> sync.log
fi

echo "=== Sync ended at $(date) ===" >> sync.log
echo "" >> sync.log
