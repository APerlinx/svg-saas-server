# Architecture

This document describes the production architecture of the ChatSVG backend.

## System diagram

```mermaid
flowchart TB
	User[Users / Clients] -->|HTTPS| Frontend[Frontend\nNext.js on Vercel\nhttps://chatsvg.dev]
	User -->|HTTPS (JWT, CSRF, cookies)| ApiDomain[Backend API\nhttps://api.chatsvg.dev]

	ApiDomain --> DNS[DNS\nCloudflare / Registrar]
	DNS --> EC2[AWS EC2\n(Ubuntu Linux)]

	subgraph K3S[Kubernetes (k3s) on EC2]
		Ingress[Ingress\nTraefik]
		Cert[cert-manager\nLet's Encrypt]
		ApiSvc[Service\nClusterIP\nchatsvg-api]
		API[API Pod(s)\nNode.js / Express\n- Auth (JWT, CSRF)\n- REST API\n- Enqueue jobs]
		Worker[Worker Pod(s)\nBullMQ\n- Process SVG jobs\n- Upload to S3]
	end

	EC2 --> Ingress
	Cert -.-> Ingress
	Ingress -->|HTTPS :443| ApiSvc
	ApiSvc --> API

	API -->|Prisma| Postgres[(PostgreSQL\nNeon)]
	API --> Redis[(Redis\nAWS ElastiCache\n- BullMQ queues\n- Cache / coordination)]
	Worker --> Redis
	Worker --> S3[(AWS S3\nGenerated SVG files)]
	API -->|Signed URL generation| S3

	subgraph CICD[CI/CD (GitHub Actions)]
		GH[Git push] --> Build[Build Docker images]
		Build --> ECR[AWS ECR\n- chatsvg-api:<sha>\n- chatsvg-worker:<sha>]
		ECR --> Runner[Self-hosted runner on EC2\nDeploy via kubectl]
	end
```

## Key components

- **Ingress (Traefik):** TLS termination, HTTP→HTTPS redirect, host-based routing for `api.chatsvg.dev`.
- **cert-manager:** Issues and renews Let’s Encrypt certificates.
- **API pods:** Handle HTTP requests, auth, job creation, and secure download URL generation.
- **Worker pods:** Consume BullMQ jobs, generate SVGs, upload artifacts to S3, and update metadata in PostgreSQL.
- **PostgreSQL (Neon):** Persistent data (users, job/generation metadata).
- **Redis (AWS ElastiCache):** BullMQ queues and coordination.
- **S3:** Durable storage for generated SVG assets; downloads use short-lived signed URLs.
