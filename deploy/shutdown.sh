#!/bin/bash

# 1. Check if the Docker daemon is even running
if ! docker info >/dev/null 2>&1; then
    echo "🐳 Docker daemon is not running. Containers are already stopped."
    exit 0
fi

# 2. Check if any of your 3 specific containers are currently active
RUNNING_COUNT=$(docker compose ps --status running --services | wc -l)

if [ "$RUNNING_COUNT" -eq 0 ]; then
    echo "🛑 No active services found for this stack. Nothing to stop."
else
    echo "⬇️ Stopping and removing Frontend, Backend, and MongoDB containers..."
    
    # Stops containers and removes the internal network, but KEEPS your database volumes safe
    docker compose down
    
    echo "✅ Stack successfully shut down."
fi
