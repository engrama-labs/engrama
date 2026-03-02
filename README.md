<p align="center">
  <img src="https://engrama.ai/engrama-logo.png" alt="Engrama" width="60" />
</p>

<h3 align="center">Engrama</h3>

<p align="center">
  Open-source long-term memory infrastructure for AI agents.
  <br />
  <a href="https://engrama.ai/docs"><strong>Documentation</strong></a> ·
  <a href="https://github.com/engrama-labs/engrama/issues">Report Bug</a> ·
  <a href="https://github.com/engrama-labs/engrama/discussions">Discussions</a>
</p>

<p align="center">
  <a href="https://github.com/engrama-labs/engrama/blob/main/LICENSE">
    <img src="https://img.shields.io/badge/license-MIT-green.svg" alt="MIT License" />
  </a>
  <a href="https://github.com/engrama-labs/engrama/stargazers">
    <img src="https://img.shields.io/github/stars/engrama-labs/engrama?style=flat" alt="GitHub Stars" />
  </a>
  <a href="https://www.npmjs.com/package/@engrama-ai/sdk">
    <img src="https://img.shields.io/npm/v/@engrama-ai/sdk.svg?color=blue" alt="npm version" />
  </a>
  <img src="https://img.shields.io/badge/TypeScript-ready-blue" alt="TypeScript" />
</p>

---

## What is Engrama?

Engrama is **long-term memory infrastructure for AI agents**.

It gives your agents, chatbots, and LLM pipelines a persistent memory layer — so they can remember user preferences, past decisions, context from previous sessions, and more. Built on top of vector search (Qdrant) and structured storage (PostgreSQL), Engrama handles the full memory lifecycle: storing, retrieving, deduplicating, and ranking memories.

Think of it as the memory API your AI agent was always missing.

---

## Why Engrama Exists

Every LLM-powered product runs into the same wall:

| Problem | Without Engrama | With Engrama |
|---------|----------------|--------------|
| LLMs forget between sessions | User has to repeat themselves constantly | Agent remembers preferences and context persistently |
| Long-context prompts are expensive | Stuffing entire history costs 10-100x more tokens | Only relevant memories are injected — sub-1K tokens |
| Building memory is hard | Custom vector DBs, deduplication, ranking — weeks of work | One `POST /remember`, one `POST /recall` |
| Multi-agent memory sharing | Each agent starts fresh | Scoped memory across users, agents, sessions, tasks |

---

## Quick Start

**Option 1 — Docker (recommended, no setup required)**

```bash
git clone https://github.com/engrama-labs/engrama.git
cd engrama

# Copy env file and add your API keys
cp .env.example .env
# Edit .env: add OPENAI_API_KEY, SUPABASE_URL, SUPABASE_KEY, JWT_SECRET

# Start everything
docker compose up
```

Memory engine is running at **http://localhost:3000**.

---

**Option 2 — Manual**

```bash
# 1. Start Qdrant
docker run -p 6333:6333 qdrant/qdrant

# 2. Install and run the server
cd server
npm install
cp ../.env.example .env   # then edit .env
npm run dev
```

---

**Option 3 — Use the hosted API**

No self-hosting required. Sign up at [engrama.ai](https://engrama.ai) and get an API key.

---

## API Example

```bash
# Store a memory
curl -X POST http://localhost:3000/api/remember \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user_abc",
    "agentId": "my-agent",
    "content": "The user prefers dark mode and uses Python.",
    "source": "user"
  }'

# Retrieve relevant memories
curl -X POST http://localhost:3000/api/recall \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user_abc",
    "agentId": "my-agent",
    "query": "What does the user prefer?",
    "limit": 5
  }'

# Build a context-aware LLM prompt
curl -X POST http://localhost:3000/api/assemble_prompt \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user_abc",
    "agentId": "my-agent",
    "currentInput": "Help me write a script."
  }'
```

---

## TypeScript SDK

```bash
npm install @engrama-ai/sdk
```

```typescript
import { createClient } from '@engrama-ai/sdk';

const engrama = createClient({
  baseURL: 'http://localhost:3000',  // or 'https://api.engrama.ai'
  // apiKey: 'your_api_key',         // required for hosted API
});

// Store a memory
await engrama.remember({
  userId:  'user_abc',
  agentId: 'my-agent',
  content: 'The user is building a customer support bot.',
});

// Recall relevant memories
const { memories } = await engrama.recall({
  userId:  'user_abc',
  agentId: 'my-agent',
  query:   'What is the user building?',
  limit:   5,
});

// Build a context-aware prompt
const { prompt } = await engrama.assemblePrompt({
  userId:       'user_abc',
  agentId:      'my-agent',
  currentInput: 'I need help designing the escalation flow.',
});
// → prompt now contains relevant memories injected as context
```

---

## Python SDK

```bash
pip install engrama-sdk
```

```python
from engrama import EngramaClient

client = EngramaClient(base_url="http://localhost:3000")

# Store a memory
client.remember(
    user_id="user_abc",
    agent_id="my-agent",
    content="User prefers concise answers.",
)

# Recall relevant memories
memories = client.recall(
    user_id="user_abc",
    agent_id="my-agent",
    query="How should I respond to this user?",
    limit=5,
)
```

---

## Architecture

```
Your Application
      │
      │  POST /api/remember          POST /api/recall
      │  POST /api/assemble_prompt   GET  /api/memories
      ▼
┌─────────────────────────────────────────────────────────┐
│                    Engrama API Server                    │
│                                                         │
│  ┌─────────────┐   ┌──────────────┐  ┌──────────────┐  │
│  │  Extractor  │   │   Retriever  │  │  Assembler   │  │
│  │             │   │              │  │              │  │
│  │ GPT-4o      │   │ Semantic     │  │ Injects top  │  │
│  │ extracts    │   │ search +     │  │ memories     │  │
│  │ structured  │   │ recency +    │  │ into prompts │  │
│  │ memories    │   │ importance   │  │              │  │
│  └──────┬──────┘   └──────┬───────┘  └──────────────┘  │
│         │                 │                             │
│  ┌──────▼──────┐   ┌──────▼───────┐                    │
│  │  Qdrant     │   │  Supabase    │                    │
│  │  (vectors)  │   │  (metadata)  │                    │
│  └─────────────┘   └──────────────┘                    │
└─────────────────────────────────────────────────────────┘
```

**Memory flow (remember):**
1. Raw content → GPT-4o extracts structured memory fragments (type, importance, entities)
2. Each fragment is embedded with `text-embedding-3-large` (3072 dims)
3. Conflict detection runs — duplicate or contradictory memories are merged
4. Memory is stored in Qdrant (vector) + Supabase (metadata, TTL, user scope)

**Memory flow (recall):**
1. Query is embedded
2. Qdrant returns top-K similar memories
3. Results are re-ranked by: similarity × recency × importance × type priority
4. Top N memories returned (or injected into your prompt)

---

## Memory Types

Engrama classifies every memory by type, which affects retrieval priority:

| Type | Priority | Example |
|------|----------|---------|
| `decision` | Highest | "User decided to use React for the frontend" |
| `constraint` | High | "Budget is limited to $500/month" |
| `preference` | High | "User prefers dark mode" |
| `goal` | Medium-high | "Building a customer support bot" |
| `fact` | Medium | "User is based in San Francisco" |
| `context` | Medium | "Current project: e-commerce platform" |
| `history` | Lower | "Previously used Vue.js" |

---

## Memory Scopes

Memories are scoped so agents don't cross-contaminate context:

```
userId    → per-user memories (shared across all agents)
agentId   → per-agent memories (isolated to one agent)
sessionId → per-session memories (temporary context)
taskId    → per-task memories (task-scoped context)
```

---

## API Reference

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/remember` | POST | Store and extract memories from content |
| `/api/recall` | POST | Retrieve relevant memories by semantic query |
| `/api/assemble_prompt` | POST | Build a context-aware prompt with injected memories |
| `/api/memories` | GET | List all memories for a user/agent |
| `/api/graph` | GET | Get the knowledge graph for a user |
| `/api/analytics` | GET | Usage and memory stats |
| `/api/auth/register` | POST | Create a user account |
| `/api/auth/login` | POST | Get a JWT token |
| `/health` | GET | Health check |

Full API reference: [engrama.ai/docs/api](https://engrama.ai/docs/api)

---

## Integrations

| Integration | Status | Package |
|-------------|--------|---------|
| TypeScript SDK | Stable | `npm install @engrama-ai/sdk` |
| Python SDK | Stable | `pip install engrama-sdk` |
| LangChain (JS) | Stable | `npm install @engrama-ai/langchain` |
| LangGraph | Beta | coming soon |
| CrewAI | Beta | coming soon |
| AutoGen | Beta | coming soon |

---

## Self-Hosting Guide

### Requirements

| Service | Purpose | Notes |
|---------|---------|-------|
| Qdrant | Vector database | Included in `docker-compose.yml` |
| Supabase / PostgreSQL | Memory metadata & auth | Free tier works for development |
| OpenAI API | Embeddings + extraction | Required |

### Production Deployment

For production self-hosting, see [`docs/self-hosting.md`](docs/self-hosting.md).

Key considerations:
- Set strong `JWT_SECRET` (min 32 chars)
- Use a managed Qdrant instance for scale
- Configure Supabase RLS policies
- Set `NODE_ENV=production`

---

## Examples

| Example | Description |
|---------|-------------|
| [`examples/chatbot-demo`](examples/chatbot-demo/) | Chatbot with persistent memory (TypeScript) |
| [`examples/langchain-example`](examples/langchain-example/) | LangChain agent with Engrama memory (Python) |

---

## Roadmap

- [ ] Memory visualization dashboard (self-hosted)
- [ ] Memory compression and summarization
- [ ] Fine-grained TTL per memory type
- [ ] Native LangGraph memory node
- [ ] Memory search over structured queries (SQL-style)
- [ ] Streaming recall for real-time agents
- [ ] WASM-based local memory (no external deps)

Track progress and vote on features in [GitHub Issues](https://github.com/engrama-labs/engrama/issues).

---

## vs. Other Memory Solutions

| | Engrama | Mem0 | Manual RAG |
|--|---------|------|-----------|
| Open source | ✅ MIT | ✅ Apache | ✅ |
| Memory extraction (not just storage) | ✅ | ✅ | ❌ |
| Knowledge graph | ✅ | ✅ | ❌ |
| Multi-agent / multi-scope | ✅ | ✅ | ❌ |
| Self-hostable | ✅ One command | ✅ | Manual |
| Hosted cloud option | ✅ engrama.ai | ✅ | ❌ |
| LangChain adapter | ✅ | ✅ | ❌ |
| Prompt assembly | ✅ | ❌ | ❌ |

---

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) to get started.

Top areas we need help with:
- More framework adapters (CrewAI, AutoGen, LlamaIndex)
- Test coverage
- Documentation and examples
- Performance benchmarks

## Community

- **GitHub Discussions** — questions, ideas, show-and-tell
- **Issues** — bugs and feature requests
- **Email** — [hello@engrama.ai](mailto:hello@engrama.ai)

---

## License

MIT — see [LICENSE](LICENSE).

---

<p align="center">
  Built by <a href="https://engrama.ai">Engrama Labs</a> · Star us on GitHub if you find this useful
</p>
