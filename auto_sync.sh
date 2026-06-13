#!/bin/bash

# Navigate to the project directory
cd "/Users/rishabh/Eb-BB Sales Dashboard"

# Ensure standard bin paths are accessible
export PATH=/usr/bin:/usr/local/bin:/usr/sbin:/sbin:/bin:$PATH

# Create log entry
echo "=== Sync started at $(date) ===" >> sync.log

# Run Odoo synchronization
/usr/bin/python3 sync_odoo.py >> sync.log 2>&1

# Check if leads_data.json has changed
if /usr/bin/git status --porcelain | grep -q "leads_data.json"; then
    echo "Changes detected in leads_data.json, committing and pushing..." >> sync.log
    /usr/bin/git add leads_data.json >> sync.log 2>&1
    /usr/bin/git commit -m "data: automatic update from Odoo crm.lead" >> sync.log 2>&1
    /usr/bin/git push origin main >> sync.log 2>&1
    echo "Push completed successfully!" >> sync.log
else
    echo "No new changes detected in Odoo CRM data." >> sync.log
fi

echo "=== Sync ended at $(date) ===" >> sync.log
echo "" >> sync.log
