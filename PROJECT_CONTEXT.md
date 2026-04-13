# Engrama Repo Context

Last updated: 2026-04-11
Repository: engrama

## Role In Workspace
This repository is the open-source umbrella project (docs, examples, legacy server, and legacy SDK docs). It is important for self-hosting and reference usage, but production cloud behavior is primarily in engrama-cloud.

## Top-Level Structure
- README.md: Product overview and OSS quick start.
- docs/self-hosting.md: Deployment guidance for self-hosting.
- docker-compose.yml and docker/docker-compose.yml: Compose stacks for server + Qdrant.
- server/: Legacy backend implementation (separate from engrama-cloud backend).
- sdk/: Legacy SDK docs.
- examples/: Demo usage (chatbot and LangChain).

## Runtime Stack (server/)
- Node.js 18+
- Express + TypeScript
- Supabase + Qdrant + OpenAI
- JWT/API key auth model (register/login in this repo's server)

## Legacy Server Entry Flow
- Entry: server/src/index.ts
- Middleware: CORS, JSON body parser, general rate limit
- Routes: auth, remember, recall, assemble_prompt, memories, graph, analytics, chat
- Health check: GET /health

## Important Difference vs engrama-cloud
This repo's server auth routes include register/login flows, while engrama-cloud uses Supabase JWT verification + provision flow. Do not assume route parity between the two backends.

## Commands (server/)
- npm run dev
- npm run build
- npm start
- npm test
- npm run lint
- npm run format

## Docker / Self-Hosting Notes
- docker-compose.yml runs server and Qdrant.
- Qdrant is expected at http://qdrant:6333 in compose networking.
- Environment is sourced from .env at repo root.

## Key Environment Variables
From .env.example:
- OPENAI_API_KEY
- SUPABASE_URL
- SUPABASE_KEY
- QDRANT_URL
- JWT_SECRET
- API_KEY
- CORS_ORIGIN
- RATE_LIMIT_WINDOW_MS
- RATE_LIMIT_MAX_REQUESTS

## Risks and Drift Areas
- README/API examples in this repo sometimes use older request field shapes and naming.
- Legacy SDK docs in engrama/sdk may not match current engrama-sdk package implementation.
- If editing shared logic concepts, verify equivalent behavior in engrama-cloud before assuming compatibility.

## Safe Edit Checklist
1. Confirm whether change belongs in this legacy server or engrama-cloud.
2. If API contract changes, test examples/ files for breakage.
3. Run npm run build and npm test under server/.
4. If touching self-hosting docs, validate compose and env names against current code.
