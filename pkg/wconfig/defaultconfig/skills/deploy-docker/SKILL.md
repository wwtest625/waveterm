---
name: deploy-docker
description: Deploy Docker containers with best practices, including image management, networking, and volume configuration
---

## Overview

This skill guides you through deploying Docker containers with production-ready configurations.

## Steps

1. **Pull the Docker image**
   ```bash
   docker pull <image-name>:<tag>
   ```

2. **Create a Docker network** (if needed)
   ```bash
   docker network create <network-name>
   ```

3. **Run the container**
   ```bash
   docker run -d \
     --name <container-name> \
     --network <network-name> \
     -p <host-port>:<container-port> \
     -v <host-path>:<container-path> \
     --restart unless-stopped \
     <image-name>:<tag>
   ```

4. **Verify the deployment**
   ```bash
   docker ps
   docker logs <container-name>
   ```

## Best Practices

- Always use specific tags instead of `latest`
- Set `--restart unless-stopped` for production
- Use named volumes for persistent data
- Limit container resources with `--memory` and `--cpus`
