# Infrastructure & Deployment

This document describes the infrastructure and deployment setup for the ChatSVG backend.
It focuses on AWS, Kubernetes (k3s), networking, and runtime configuration.

## Overview

The backend runs on a single AWS EC2 instance (Ubuntu) hosting a k3s cluster. The cluster runs two deployments:

- `chatsvg-api`: HTTP API (Node.js/Express)
- `chatsvg-worker`: background job processor (BullMQ)

Stateful services are hosted outside the cluster:

- PostgreSQL (Neon)
- Redis (AWS ElastiCache)
- Object storage (AWS S3)

## High-level goals

- Fully containerized backend services
- Automated CI/CD (no manual SSH deploys)
- No stateful services inside the cluster
- HTTPS + real domain routing
- Clear separation between request handling and async workloads

## Domains & networking

- Frontend: `https://chatsvg.dev` (Vercel)
- Backend API: `https://api.chatsvg.dev`

DNS is managed via Cloudflare (or a registrar). `api.chatsvg.dev` points to the EC2 public IP.

## Ingress & TLS

- Ingress controller: Traefik
- TLS automation: cert-manager with Let’s Encrypt

Responsibilities at the edge:

- TLS termination (HTTPS)
- HTTP 4 HTTPS redirect
- Host-based routing for `api.chatsvg.dev`

## Compute & orchestration

### Kubernetes (k3s)

k3s runs on a single EC2 node and is responsible for:

- Running API and worker pods
- Rolling updates and restarts
- Injecting environment variables via Secrets/ConfigMaps
- Pulling images from AWS ECR via `imagePullSecret`

### Deployments

- `chatsvg-api`: serves REST API traffic and enqueues jobs
- `chatsvg-worker`: consumes BullMQ jobs and performs SVG generation + uploads

Workers are isolated from HTTP traffic so async load does not impact request latency.

## Containerization

- All services are Dockerized
- Images are immutable once pushed
- Images are tagged by git commit SHA

### Container registry (AWS ECR)

- `chatsvg-api:<tag>`
- `chatsvg-worker:<tag>`

Kubernetes pulls images directly from ECR.

### ECR auth refresh

ECR auth is provided via a Kubernetes `dockerconfigjson` secret. A Kubernetes CronJob refreshes credentials periodically to avoid image pull failures due to token expiration.

## CI/CD

GitHub Actions builds and pushes images to ECR. Deployment happens from a self-hosted GitHub Actions runner running on the EC2 instance.

Pipeline overview:

1. Build Docker images (API + worker)
2. Tag images with git SHA
3. Push images to AWS ECR
4. Trigger a k3s rollout via `kubectl set image`
5. Wait for rollout readiness

## Configuration & secrets

### Kubernetes Secrets

Sensitive values are stored in Kubernetes Secrets and injected at runtime:

- `DATABASE_URL`
- `REDIS_URL`
- JWT secrets
- OAuth credentials
- AWS credentials / region / bucket configuration

Secrets are not baked into images.

### ConfigMaps

Non-sensitive configuration:

- Environment flags (`NODE_ENV`)
- Runtime toggles
- Ports

## Data services

### PostgreSQL (Neon)

- Fully managed external database
- Accessed via Prisma
- No database runs inside Kubernetes

### Redis (AWS ElastiCache)

Used for:

- BullMQ queues
- Realtime signaling / coordination

Redis runs outside the cluster.

## Object storage (AWS S3)

Generated SVG files are stored in S3.

- Backend accesses S3 via AWS SDK credentials
- Buckets are not public
- Clients download via short-lived signed URLs

## Security & hardening

- HTTPS enforced at ingress
- Secure cookies + CSRF protection for authenticated flows
- Rate limiting at application layer (and can be complemented at ingress)
- No long-lived secrets inside container images

## Operational notes

- API exposes health/readiness endpoints for rollouts
- Rolling deployments are used to minimize downtime
- Workers can be scaled independently from the API

## Planned next steps

- Automate database migrations as part of deployments
- Improve observability (metrics + dashboards)
- Horizontal scaling (multiple workers / multi-node cluster)
- Tighter IAM scoping for S3 access
