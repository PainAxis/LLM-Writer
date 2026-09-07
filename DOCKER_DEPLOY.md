# Docker Deployment Guide

[English](DOCKER_DEPLOY.md) | [简体中文](DOCKER_DEPLOY.zh-CN.md)

This project supports rapid deployment using Docker, including configurations for both development and production environments.

## Prerequisites

- Docker >= 20.10
- Docker Compose >= 2.0

## Quick Start

### Development Environment

```bash
# Start development environment
docker-compose --profile dev up -d

# View logs
docker-compose --profile dev logs -f app-dev

# Stop development environment
docker-compose --profile dev down
```

The development environment will run at http://localhost:3000 with hot-reload enabled.

### Production Environment

```bash
# Build and start production environment
docker-compose --profile prod up -d

# View logs
docker-compose --profile prod logs -f app-prod

# Stop production environment
docker-compose --profile prod down
```

The production environment will run at http://localhost (port 80).

### External Nginx Mode (Optional)

Suitable for scenarios where Nginx is already running on the host and only static hosting is needed: mounts the local `dist/` build output and `nginx.conf`, listening on port 8080. You must run `npm run build` first to generate `dist`:

```bash
npm run build
docker-compose --profile external-nginx up -d
# Access http://localhost:8080
```

## Detailed Configuration

### Using Dockerfile Directly

#### Development Environment
```bash
# Build development image
docker build --target development -t llm-writer:dev .

# Run development container
docker run -d -p 3000:3000 -v $(pwd):/app -v /app/node_modules --name llm-writer-dev llm-writer:dev
```

#### Production Environment
```bash
# Build production image
docker build --target production -t llm-writer:prod .

# Run production container
docker run -d -p 80:80 --name llm-writer-prod llm-writer:prod
```

## Troubleshooting

### Diagnostic Scripts

```bash
# Windows
scripts\debug.bat

# Linux/Mac
chmod +x scripts/debug.sh
./scripts/debug.sh
```

### Checking Error Logs

```bash
# Check build errors
docker-compose build --no-cache

# Check container startup logs
docker-compose logs

# Follow logs in real-time
docker-compose logs -f

# Start in foreground for verbose output
docker-compose --profile dev up
```

### Common Issues

1. **Port in use**
   ```bash
   # Check port usage
   netstat -tulpn | grep :3000
   # Modify port mapping in docker-compose.yml
   ```

2. **Build failure**
   ```bash
   # Prune builder cache
   docker builder prune
   # Rebuild
   docker-compose build --no-cache
   ```

3. **Container fails to start**
   ```bash
   # View detailed error logs
   docker-compose logs
   # Check container status
   docker-compose ps
   ```

4. **Permission issues (Linux)**
   ```bash
   # Add user to the docker group
   sudo usermod -aG docker $USER
   newgrp docker
   ```