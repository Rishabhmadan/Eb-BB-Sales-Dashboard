
#!/bin/bash
# Exit on error
set -e

echo "========================================="
echo "      STARTING EB-BB SALES APPLICATION      "
echo "========================================="
echo "Connecting local server..."

# Check if port 8000 is occupied, if so suggest running on another port or killing the process
if lsof -Pi :8000 -sTCP:LISTEN -t >/dev/null ; then
    echo "Port 8000 is already in use. Opening browser to the active server..."
    open "http://localhost:8000"
    exit 0
else
    # Start the server
    echo "Server starting at http://localhost:8000"
    # Automatically open the browser (macOS native command)
    open "http://localhost:8000"
    # Start the python HTTP server with cache busting
    python3 server.py
fi
