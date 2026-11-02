#!/bin/bash

# 1. Ensure the Docker daemon itself is running
if ! docker info >/dev/null 2>&1; then
    echo "🐳 Docker daemon is not running. Attempting to start Docker..."
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        sudo systemctl start docker
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        open -a Docker
    else
        echo "❌ Please start Docker Desktop manually."
        exit 1
    fi

    while ! docker info >/dev/null 2>&1; do sleep 1; done
    echo "✅ Docker daemon is ready."
fi

# 2. Get the status of your 3 specific containers
# This ensures it ignores any other unrelated dockers running on your machine
MONGODB_STATUS=$(docker ps -a --filter "name=local_mongodb" --format "{{.State}}")
BACKEND_STATUS=$(docker ps -a --filter "name=fastapi_backend" --format "{{.State}}")
FRONTEND_STATUS=$(docker ps -a --filter "name=vite_frontend" --format "{{.State}}")

# 3. Determine action based on existence and running states
if [ -z "$MONGODB_STATUS" ] || [ -z "$BACKEND_STATUS" ] || [ -z "$FRONTEND_STATUS" ]; then
    echo "🛠️ One or more containers do not exist. Building and starting the stack..."
    docker compose up -d --build

elif [ "$MONGODB_STATUS" = "running" ] && [ "$BACKEND_STATUS" = "running" ] && [ "$FRONTEND_STATUS" = "running" ]; then
    echo "🚀 All 3 services (MongoDB, Backend, Frontend) are already running."

else
    echo "⚠️ Stack exists but some containers are stopped. Starting them up..."
    # This wakes up stopped containers without triggering a heavy rebuild
    docker compose up -d
fi

