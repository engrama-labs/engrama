import { Router, Request, Response } from 'express';
import OpenAI from 'openai';
import { config } from '../config';
import { recallMemories } from '../services/retriever';
import { memoryExtractor } from '../services/extractor';
import { generateEmbedding } from '../utils/llm';
import { db, vectorDb } from '../db';
import { generateId } from '../utils/helpers';

const router = Router();

interface StoredMemoryInfo {
  text: string;
  category: string;
  confidence: number;
}

/**
 * Store memories from user message
 * Returns array of stored memory texts for frontend display
 */
async function storeMemoryFromMessage(
  userId: string,
  text: string,
  scope: { type: string; id: string }
): Promise<StoredMemoryInfo[]> {
  const storedMemories: StoredMemoryInfo[] = [];
  
  try {
    console.log('[CHAT] Extracting memories from user message...');
    
    // Check if text is relevant for storage
    const relevanceCheck = await memoryExtractor.classifyRelevance(text, 'general');
    if (!relevanceCheck.should_store) {
      console.log('[CHAT] Message not relevant for memory storage:', relevanceCheck.reason);
      return storedMemories;
    }
    
    // Extract memory candidates
    const candidates = await memoryExtractor.extractMemoryCandidates(text, 'general', 'user');
    console.log('[CHAT] Extracted', candidates.length, 'memory candidates');
    
    if (candidates.length === 0) {
      return storedMemories;
    }
    
    // Process each candidate
    for (const candidate of candidates) {
      try {
        // Skip very low confidence candidates (0.3 minimum)
        if (candidate.confidence < 0.3) {
          console.log('[CHAT] Skipping low confidence candidate:', candidate.confidence);
          continue;
        }
        
        // Canonicalize the memory
        const canonical = await memoryExtractor.canonicalizeMemory(candidate.canonicalText);
        
        // Generate embedding
        const embedding = await generateEmbedding(canonical);
        
        // Create memory
        const memoryId = generateId();
        const now = new Date();
        
        const memory = {
          id: memoryId,
          userId,
          scope,
          category: candidate.category,
          canonicalText: canonical,
          type: candidate.category,
          source: 'user' as const,
          confidence: candidate.confidence,
          tags: candidate.tags,
          timestamp: now,
          createdAt: now,
          updatedAt: now,
          version: 1,
          ttl: undefined,
          provenance: [
            {
              source: 'user' as const,
              timestamp: now,
              rawText: text,
              confidence: candidate.confidence,
              agentType: 'general',
            },
          ],
          linkedMemories: [],
          conflictStatus: 'none' as const,
          visibility: 'private' as const,
          metadata: memoryExtractor.extractMetadata(text, candidate.category),
          requiresConfirmation: false,
          confirmed: true,
          promoted: false,
          agentType: 'general',
        };
        
        // Store in database
        await db.insertMemory(memory);
        console.log('[CHAT] Memory stored:', canonical.substring(0, 50) + '...');
        
        // Store vector embedding
        await vectorDb.insertVector(memoryId, embedding, {
          userId,
          type: candidate.type,
          timestamp: now.getTime(),
          confidence: candidate.confidence,
        });
        
        // Add to stored memories list
        storedMemories.push({
          text: canonical,
          category: candidate.category,
          confidence: candidate.confidence,
        });
        
      } catch (error) {
        console.error('[CHAT] Error storing memory candidate:', error);
      }
    }
    
    console.log('[CHAT] Memory extraction complete, stored', storedMemories.length, 'memories');
  } catch (error) {
    console.error('[CHAT] Error in memory storage:', error);
  }
  
  return storedMemories;
}

/**
 * POST /api/chat
 * Chat with AI using server-side OpenAI key
 * Memory is automatically recalled and stored for authenticated users
 * 
 * SECURITY: OpenAI API key is NEVER exposed to the client
 * All AI calls use the server's configured OPENAI_API_KEY
 */
router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      message,
      userId,
      model = 'gpt-4o-mini',
      useMemory = true,
      scope,
    } = req.body;

    console.log('[CHAT] POST /api/chat received');
    console.log('[CHAT] userId:', userId);
    console.log('[CHAT] message:', message?.substring(0, 50));
    console.log('[CHAT] useMemory:', useMemory);
    console.log('[CHAT] scope:', scope);

    // Validate required fields
    if (!message) {
      res.status(400).json({ error: 'Message is required' });
      return;
    }

    if (!userId) {
      res.status(400).json({ error: 'userId is required' });
      return;
    }

    // SECURITY: Use ONLY server-side OpenAI API key
    // Never accept API keys from client requests
    const apiKey = config.openai.apiKey;
    if (!apiKey) {
      console.error('Server OpenAI API key not configured');
      res.status(503).json({ 
        error: 'AI service temporarily unavailable. Please try again later.' 
      });
      return;
    }

    // Initialize OpenAI client with server key
    const openai = new OpenAI({ apiKey });

    // Build messages array
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

    // System message
    let systemMessage = 'You are a helpful AI assistant powered by Engrama memory.';

    // If memory is enabled, recall relevant memories
    if (useMemory) {
      try {
        console.log('[CHAT] Recalling memories for user:', userId, 'query:', message.substring(0, 50));
        const memories = await recallMemories(userId, message, {
          limit: 5,
          scope,
        });

        console.log('[CHAT] Recalled', memories?.length || 0, 'memories');

        if (memories && memories.length > 0) {
          const memoryContext = memories
            .map((m) => `- ${m.memory.canonicalText}`)
            .join('\n');

          console.log('[CHAT] Memory context:', memoryContext.substring(0, 200));
          systemMessage += `\n\nYou know the following about this user:\n${memoryContext}\n\nUse this information to personalize your response when relevant.`;
        } else {
          console.log('[CHAT] No memories found for this query');
        }
      } catch (error) {
        console.warn('[CHAT] Failed to recall memories:', error);
        // Continue without memory context
      }
    }

    messages.push({ role: 'system', content: systemMessage });
    messages.push({ role: 'user', content: message });

    // Call OpenAI
    const completion = await openai.chat.completions.create({
      model,
      messages,
      temperature: 0.7,
      max_tokens: 1000,
    });

    const assistantMessage = completion.choices[0]?.message?.content || '';

    // Store user message as memory and get what was stored
    let storedMemories: StoredMemoryInfo[] = [];
    if (useMemory) {
      try {
        const memoryScope = scope || { type: 'user', id: userId };
        storedMemories = await storeMemoryFromMessage(userId, message, memoryScope);
      } catch (err) {
        console.error('[CHAT] Memory storage failed:', err);
      }
    }

    res.status(200).json({
      response: assistantMessage,
      model,
      // Return what memories were stored (if any)
      memoriesStored: storedMemories,
    });
  } catch (error: any) {
    console.error('Chat error:', error);

    // Handle OpenAI specific errors without exposing internals
    if (error.code === 'invalid_api_key') {
      console.error('Invalid server OpenAI API key');
      res.status(503).json({ error: 'AI service temporarily unavailable' });
      return;
    }

    if (error.code === 'insufficient_quota') {
      console.error('OpenAI API quota exceeded');
      res.status(503).json({ error: 'AI service temporarily unavailable' });
      return;
    }

    if (error.code === 'rate_limit_exceeded') {
      res.status(429).json({ error: 'Too many requests. Please wait a moment.' });
      return;
    }

    // Generic error for client
    res.status(500).json({ 
      error: 'Something went wrong. Please try again.',
    });
  }
});

/**
 * POST /api/chat/stream
 * Stream chat response (Server-Sent Events)
 * Uses server-side OpenAI key only
 */
router.post('/stream', async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      message,
      userId,
      model = 'gpt-4o-mini',
      useMemory = true,
      scope,
    } = req.body;

    // Validate required fields
    if (!message || !userId) {
      res.status(400).json({ error: 'Message and userId are required' });
      return;
    }

    // SECURITY: Use ONLY server-side OpenAI API key
    const apiKey = config.openai.apiKey;
    if (!apiKey) {
      res.status(503).json({ error: 'AI service temporarily unavailable' });
      return;
    }

    const openai = new OpenAI({ apiKey });

    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Build messages
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    let systemMessage = 'You are a helpful AI assistant powered by Engrama memory.';

    if (useMemory) {
      try {
        const memories = await recallMemories(userId, message, {
          limit: 5,
          scope,
        });

        if (memories && memories.length > 0) {
          const memoryContext = memories
            .map((m) => `- ${m.memory.canonicalText}`)
            .join('\n');
          systemMessage += `\n\nYou know the following about this user:\n${memoryContext}\n\nUse this information to personalize your response when relevant.`;
        }
      } catch (error) {
        console.warn('Failed to recall memories for streaming:', error);
      }
    }

    messages.push({ role: 'system', content: systemMessage });
    messages.push({ role: 'user', content: message });

    // Stream response
    const stream = await openai.chat.completions.create({
      model,
      messages,
      temperature: 0.7,
      max_tokens: 1000,
      stream: true,
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      if (content) {
        res.write(`data: ${JSON.stringify({ content })}\n\n`);
      }
    }

    // Store user message as memory (background)
    if (useMemory) {
      const memoryScope = scope || { type: 'user', id: userId };
      storeMemoryFromMessage(userId, message, memoryScope).catch((err) => {
        console.error('[CHAT] Background memory storage failed:', err);
      });
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (error: any) {
    console.error('Stream chat error:', error);
    res.write(`data: ${JSON.stringify({ error: 'Stream failed' })}\n\n`);
    res.end();
  }
});

/**
 * Comprehensive Engrama knowledge base for documentation assistant
 */
const ENGRAMA_DOCS_KNOWLEDGE = `You are an expert AI assistant specializing in Engrama, a production-ready long-term memory infrastructure for AI agents. Your role is to help developers integrate Engrama into their applications with clear, accurate, and practical guidance.

# Engrama Overview
Engrama provides persistent memory storage, semantic recall, knowledge graphs, and prompt assembly for AI applications. It's designed for production use with proper authentication, rate limiting, and plan-based feature gating.

# API Base URL
Production: https://api.engrama.io
Development: http://localhost:3000

# Authentication
All API requests require authentication via one of:
1. JWT Token: Include in Authorization header as "Bearer <token>"
2. API Key: Include in X-API-Key header

Get API keys from: Dashboard → Settings → API Keys

# Core API Endpoints

## POST /api/remember
Store new memories with automatic embedding, deduplication, and contradiction detection.

Request Body:
{
  "userId": "string (required) - Unique user identifier",
  "text": "string (required) - Content to remember",
  "source": "string (optional) - Origin identifier (e.g., 'chat', 'settings')",
  "scope": {
    "type": "string (optional) - 'user' | 'session' | 'project' | 'global'",
    "id": "string (optional) - Scope identifier"
  },
  "tags": ["string"] (optional),
  "metadata": {} (optional)
}

Response:
{
  "success": true,
  "count": number,
  "memories": [{
    "id": "string",
    "canonicalText": "string",
    "type": "string",
    "confidence": number
  }]
}

## POST /api/recall
Retrieve relevant memories using semantic vector search.

Request Body:
{
  "userId": "string (required)",
  "query": "string (required) - Search query",
  "limit": number (optional, default: 10),
  "scope": {
    "type": "string (optional)",
    "id": "string (optional)"
  },
  "filters": {
    "types": ["string"] (optional),
    "tags": ["string"] (optional),
    "dateRange": {
      "start": "ISO date string",
      "end": "ISO date string"
    }
  }
}

Response:
{
  "success": true,
  "memories": [{
    "memory": {
      "id": "string",
      "canonicalText": "string",
      "type": "string",
      "confidence": number,
      "timestamp": "ISO date",
      "scope": {}
    },
    "score": number,
    "similarity": number
  }]
}

## POST /api/assemble-prompt
Build a prompt with relevant memory context, respecting token budget.

Request Body:
{
  "userId": "string (required)",
  "query": "string (required) - User input/query",
  "agentInstructions": "string (optional) - System instructions",
  "tokenBudget": number (optional, default: 2000),
  "scope": {} (optional)
}

Response:
{
  "success": true,
  "prompt": "string - Complete prompt with memory context",
  "memoriesUsed": number,
  "tokensUsed": number
}

## GET /api/graph
Query the knowledge graph (requires Builder plan or higher).

Query Parameters:
- userId (required)
- depth (optional, default: 2)
- entityTypes (optional, comma-separated)
- relationshipTypes (optional, comma-separated)
- centerMemoryId (optional)
- limit (optional, default: 50)

Response:
{
  "success": true,
  "nodes": [{
    "id": "string",
    "type": "person | place | concept | tool | event",
    "name": "string",
    "importance": number
  }],
  "edges": [{
    "source": "string",
    "target": "string",
    "type": "related_to | contradicts | supports | caused_by",
    "strength": number
  }]
}

## GET /api/analytics/metrics
Get comprehensive memory analytics (requires Builder plan or higher).

Query Parameters:
- userId (required)

Response:
{
  "success": true,
  "metrics": {
    "totalMemories": number,
    "activeMemories": number,
    "recallCount": number,
    "averageImportance": number,
    "healthScore": number,
    "typeDistribution": {},
    "activityTimeline": []
  }
}

# SDK Installation & Usage

## TypeScript/Node.js
\`\`\`bash
npm install @engrama-ai/sdk
\`\`\`

\`\`\`typescript
import { createClient } from '@engrama-ai/sdk';

const client = createClient({
  baseURL: 'https://api.engrama.io',
  apiKey: 'YOUR_API_KEY'
});

// Store memory
await client.remember({
  userId: 'user-123',
  text: 'User prefers dark mode and Python',
  source: 'settings'
});

// Recall memories
const result = await client.recall({
  userId: 'user-123',
  query: 'What are user preferences?',
  limit: 5
});

// Assemble prompt
const { prompt } = await client.assemblePrompt({
  userId: 'user-123',
  query: 'Help me write code',
  tokenBudget: 2000
});
\`\`\`

## Python
\`\`\`bash
pip install engrama
\`\`\`

\`\`\`python
from engrama import create_client

client = create_client(
    base_url='https://api.engrama.io',
    api_key='YOUR_API_KEY'
)

# Store memory
client.remember(
    user_id='user-123',
    text='User prefers dark mode and Python',
    source='settings'
)

# Recall memories
result = client.recall(
    user_id='user-123',
    query='What are user preferences?',
    limit=5
)

# Assemble prompt
result = client.assemble_prompt(
    user_id='user-123',
    query='Help me write code',
    token_budget=2000
)
\`\`\`

## LangChain Integration
\`\`\`typescript
import { EngramaMemory } from '@engrama-ai/sdk/langchain';

const memory = new EngramaMemory({
  userId: 'user-123',
  apiKey: 'YOUR_API_KEY',
  baseURL: 'https://api.engrama.io'
});

// Use with LangChain chains
const chain = new ConversationChain({
  llm: model,
  memory: memory
});
\`\`\`

# Core Concepts

## Memory
A structured unit storing context with:
- canonicalText: Normalized, deduplicated text
- type: Classification (fact, preference, event, etc.)
- confidence: Quality score (0-1)
- scope: Isolation context (user, session, project, global)
- importance: Long-term relevance score
- status: active, outdated, merged, expired, archived

## Scopes
Memory isolation levels:
- **user**: Persists across all sessions (long-term preferences, profile)
- **session**: Single conversation context (task-specific)
- **project**: Shared within a project (team collaboration)
- **global**: Available to all users (system-wide facts)

Always specify scope when storing memories for proper isolation.

## Embeddings
- Model: OpenAI text-embedding-3-small
- Dimensions: 1536
- Vector DB: Qdrant (cosine similarity search)
- Automatic generation on memory storage

## Knowledge Graph
Extracts entities and relationships:
- Entity Types: person, place, concept, tool, event
- Relationship Types: related_to, contradicts, supports, caused_by
- Automatically built from memories
- Available on Builder plan and higher

# Pricing Plans & Limits

## Explorer (Free)
- 100 memories/month
- 500 recalls/month
- 1 project
- Basic features only

## Builder ($29/month)
- 10,000 memories/month
- 50,000 recalls/month
- 10 projects
- Knowledge Graph access
- Analytics dashboard

## Scale ($149/month)
- 100,000 memories/month
- 500,000 recalls/month
- Unlimited projects
- Priority support
- Advanced analytics

## Enterprise (Custom)
- Unlimited usage
- Custom features
- Dedicated support
- SLA guarantees

# Error Handling

Common errors and solutions:

**401 Unauthorized**
- Check API key in X-API-Key header
- Verify JWT token in Authorization header
- Ensure token hasn't expired

**403 Forbidden**
- Plan limit exceeded (check usage in dashboard)
- Feature locked (upgrade plan)
- Invalid permissions

**429 Rate Limited**
- Too many requests
- Implement exponential backoff
- Check rate limit headers

**400 Bad Request**
- Missing required fields (userId, text, query)
- Invalid parameter format
- Check request body structure

# Best Practices

1. **Consistent User IDs**: Use the same userId across all calls for a user
2. **Scope Appropriately**: Use 'user' for long-term data, 'session' for temporary context
3. **Token Budgets**: Set reasonable token budgets (1000-4000) for prompt assembly
4. **Error Handling**: Always handle 401, 403, 429 errors gracefully
5. **API Key Security**: Never expose API keys in frontend code; use environment variables
6. **Memory Quality**: Store meaningful, canonicalized text for better recall
7. **Rate Limiting**: Implement retry logic with exponential backoff

# Integration Examples

## Next.js API Route
\`\`\`typescript
import { createClient } from '@engrama-ai/sdk';

export default async function handler(req, res) {
  const client = createClient({
    baseURL: process.env.ENGRAMA_API_URL,
    apiKey: process.env.ENGRAMA_API_KEY
  });

  if (req.method === 'POST') {
    const { userId, text } = req.body;
    const result = await client.remember({ userId, text });
    res.json(result);
  }
}
\`\`\`

## Express.js Middleware
\`\`\`typescript
app.post('/chat', async (req, res) => {
  const { userId, message } = req.body;
  
  // Get context from Engrama
  const { prompt } = await client.assemblePrompt({
    userId,
    query: message,
    tokenBudget: 2000
  });
  
  // Use with your LLM
  const response = await openai.chat.completions.create({
    messages: [{ role: 'system', content: prompt }]
  });
  
  // Store conversation
  await client.remember({
    userId,
    text: message,
    source: 'chat'
  });
  
  res.json({ response: response.choices[0].message.content });
});
\`\`\`

# Response Guidelines

When answering questions:
1. Be specific and accurate - use exact endpoint paths, parameter names, and response formats
2. Provide copy-paste ready code examples
3. Explain the "why" behind recommendations
4. Reference specific plan limits when relevant
5. Include error handling in examples
6. Keep responses concise but complete
7. Use code blocks with proper syntax highlighting
8. Link to relevant concepts (scopes, memory types, etc.)

Remember: You are helping developers build production applications. Accuracy and clarity are paramount.`;

/**
 * POST /api/chat/docs
 * Documentation-specific chat endpoint with comprehensive Engrama knowledge
 * Does NOT use user memory - only provides documentation assistance
 */
router.post('/docs', async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      message,
      conversationHistory = [],
    } = req.body;

    console.log('[CHAT/DOCS] POST /api/chat/docs received');
    console.log('[CHAT/DOCS] message:', message?.substring(0, 50));

    // Validate required fields
    if (!message) {
      res.status(400).json({ error: 'Message is required' });
      return;
    }

    // SECURITY: Use ONLY server-side OpenAI API key
    const apiKey = config.openai.apiKey;
    if (!apiKey) {
      console.error('Server OpenAI API key not configured');
      res.status(503).json({ 
        error: 'AI service temporarily unavailable. Please try again later.' 
      });
      return;
    }

    // Initialize OpenAI client with server key
    const openai = new OpenAI({ apiKey });

    // Build messages array with comprehensive knowledge
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: ENGRAMA_DOCS_KNOWLEDGE },
    ];

    // Add conversation history if provided
    if (Array.isArray(conversationHistory) && conversationHistory.length > 0) {
      // Add last 10 messages for context (to avoid token limits)
      const recentHistory = conversationHistory.slice(-10);
      for (const msg of recentHistory) {
        if (msg.role && msg.content) {
          messages.push({
            role: msg.role as 'user' | 'assistant',
            content: msg.content,
          });
        }
      }
    }

    // Add current message
    messages.push({ role: 'user', content: message });

    // Call OpenAI with higher token limit for comprehensive responses
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      temperature: 0.7,
      max_tokens: 2000, // Higher limit for detailed documentation responses
    });

    const assistantMessage = completion.choices[0]?.message?.content || '';

    res.status(200).json({
      response: assistantMessage,
      model: 'gpt-4o-mini',
    });
  } catch (error: any) {
    console.error('[CHAT/DOCS] Error:', error);

    // Handle OpenAI specific errors
    if (error.code === 'invalid_api_key') {
      console.error('Invalid server OpenAI API key');
      res.status(503).json({ error: 'AI service temporarily unavailable' });
      return;
    }

    if (error.code === 'insufficient_quota') {
      console.error('OpenAI API quota exceeded');
      res.status(503).json({ error: 'AI service temporarily unavailable' });
      return;
    }

    if (error.code === 'rate_limit_exceeded') {
      res.status(429).json({ error: 'Too many requests. Please wait a moment.' });
      return;
    }

    // Generic error for client
    res.status(500).json({ 
      error: 'Something went wrong. Please try again.',
    });
  }
});

export default router;
