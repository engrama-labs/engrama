import { MemoryConfig, MemoryType, MemorySource, AgentType } from '../types';
import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  
  openai: {
    apiKey: process.env.OPENAI_API_KEY || '',
    model: process.env.OPENAI_MODEL || 'gpt-4o', // Switched to GPT-4o for reliable multi-extraction
    fallbackModel: process.env.OPENAI_FALLBACK_MODEL || 'gpt-4-turbo', // Fallback to GPT-4-turbo
    embeddingModel: process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-large',
  },
  
  supabase: {
    url: process.env.SUPABASE_URL || '',
    key: process.env.SUPABASE_KEY || '',
  },
  
  database: {
    url: process.env.DATABASE_URL || '',
  },
  
  qdrant: {
    url: process.env.QDRANT_URL || 'http://localhost:6333',
    apiKey: process.env.QDRANT_API_KEY,
    collection: process.env.QDRANT_COLLECTION || 'memory_engine',
  },
  
  security: {
    apiKey: process.env.API_KEY || '',
    jwtSecret: process.env.JWT_SECRET || '',
    rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10),
    rateLimitMaxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
  },
  
  cors: {
    origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  },
  
  memory: {
    defaultTtlDays: parseInt(process.env.DEFAULT_MEMORY_TTL_DAYS || '365', 10),
    maxMemoriesPerUser: parseInt(process.env.MAX_MEMORIES_PER_USER || '100000', 10),
    embeddingDimension: parseInt(process.env.EMBEDDING_DIMENSION || '3072', 10), // Updated for text-embedding-3-large
  },
};

export const memoryConfig: MemoryConfig = {
  typePriorities: {
    // Universal memory type priorities (domain-agnostic)
    decision: 1.0,        // Highest priority: confirmed decisions
    constraint: 0.95,    // High priority: constraints and rules
    preference: 0.9,     // High priority: user preferences
    goal: 0.85,          // Medium-high: goals and objectives
    fact: 0.8,           // Medium: objective facts
    context: 0.75,       // Medium: contextual information
    history: 0.6,        // Lower: historical events (optional)
  },
  
  scoringWeights: {
    similarity: 0.4,
    recency: 0.25,
    confidence: 0.2,
    typePriority: 0.15,
  },
  
  defaultTtlDays: config.memory.defaultTtlDays,
  relevanceThreshold: 0.7,
  conflictThreshold: 0.85,
  maxMemoriesPerUser: config.memory.maxMemoriesPerUser,
  defaultAgentType: 'general',
  // Source priorities (higher = more trusted)
  sourcePriorities: {
    user: 1.0,           // Highest: user-provided
    environment: 0.9,    // High: environment/system signals
    system: 0.8,         // Medium: system-generated
    ai: 0.1,             // Very low: AI-generated (never promoted by default)
  },
};

// Validate critical environment variables
export function validateConfig(): void {
  const required = [
    'OPENAI_API_KEY',
    'SUPABASE_URL',
    'SUPABASE_KEY',
  ];
  
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}\n` +
      'Please check your .env file.'
    );
  }
}






