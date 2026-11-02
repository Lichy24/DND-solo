#!/bin/bash

# 1. Check if the Docker daemon is running
if ! docker info >/dev/null 2>&1; then
    echo "🐳 Docker daemon is not running. Containers are already stopped."
    exit 0
fi

# 2. Check if any of your 3 specific containers are currently active
RUNNING_COUNT=$(docker compose ps --status running --services | wc -l)

if [ "$RUNNING_COUNT" -eq 0 ]; then
    echo "🛑 All services are already turned off."
else
    echo "⏸️ Turning off Frontend, Backend, and MongoDB..."
    
    # Stops the running containers completely, freeing up all CPU and memory.
    # It leaves the containers intact so they can wake up instantly next time.
    docker compose stop
    
    echo "✅ All 3 containers have been turned off successfully."
fi
