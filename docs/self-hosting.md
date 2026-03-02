# Self-Hosting Engrama

This guide covers deploying Engrama on your own infrastructure.

## Prerequisites

- Docker and Docker Compose
- An OpenAI API key
- A Supabase project (or self-hosted PostgreSQL)
- 512 MB RAM minimum (1 GB recommended)

## Quick Start (Docker Compose)

```bash
git clone https://github.com/engrama-labs/engrama.git
cd engrama

cp .env.example .env
# Edit .env — fill in OPENAI_API_KEY, SUPABASE_URL, SUPABASE_KEY, JWT_SECRET

docker compose up
```

The server starts at **http://localhost:3000**.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | Yes | OpenAI API key for embeddings and extraction |
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_KEY` | Yes | Supabase service role key |
| `JWT_SECRET` | Yes | Secret for signing JWTs (min 32 chars) |
| `QDRANT_URL` | Yes | Qdrant URL (default: `http://localhost:6333`) |
| `PORT` | No | Server port (default: `3000`) |
| `CORS_ORIGIN` | No | Allowed CORS origin (default: `http://localhost:5173`) |
| `NODE_ENV` | No | `development` or `production` |

Generate a strong JWT secret:
```bash
openssl rand -hex 32
```

## Database Setup (Supabase)

1. Create a new Supabase project at [supabase.com](https://supabase.com)
2. Run the schema migrations in `server/src/db/`:

```bash
# In the Supabase SQL editor, run these in order:
server/src/db/schema.sql
server/src/db/schema-auth.sql
server/src/db/schema-graph.sql
```

3. Copy your project URL and `anon`/`service_role` key into `.env`

## Running Without Docker

```bash
# Start Qdrant separately
docker run -d -p 6333:6333 qdrant/qdrant

# Install and run the server
cd server
npm install
npm run build
npm start
```

## Production Hardening

- Set `NODE_ENV=production`
- Use a reverse proxy (nginx/Caddy) with TLS
- Set `CORS_ORIGIN` to your actual frontend domain
- Use a managed Qdrant instance (Qdrant Cloud free tier available)
- Enable Supabase Row Level Security on all tables
- Keep `JWT_SECRET` in a secrets manager, not in `.env`
- Set reasonable rate limits via `RATE_LIMIT_MAX_REQUESTS`

## Deployment Targets

Engrama has been deployed on:
- [Fly.io](https://fly.io) — Dockerfile included, works out of the box
- [Railway](https://railway.app) — link the repo, set env vars
- [Render](https://render.com) — Docker service
- Any VPS (DigitalOcean, Hetzner, etc.) with Docker installed
