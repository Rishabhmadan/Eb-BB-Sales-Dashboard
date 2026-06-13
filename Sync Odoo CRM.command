#!/bin/bash
# Navigate to the dashboard directory
cd "/Users/rishabh/Eb-BB Sales Dashboard"

echo "========================================="
# Print starting header
echo "   MANUAL ODOO SYNC & GITHUB PUSH        "
echo "========================================="
echo ""

# Run the automation script
./auto_sync.sh

# Display the latest sync logs
echo "Latest log entries:"
echo "-----------------------------------------"
tail -n 15 sync.log
echo "-----------------------------------------"
echo ""

echo "Process completed! This window will close in 5 seconds..."
sleep 5

# Gracefully close the terminal window
osascript -e 'tell application "Terminal" to close first window' & exit
