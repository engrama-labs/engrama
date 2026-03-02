import { z } from 'zod';

// Validation schemas
export const MemoryScopeSchema = z.object({
  type: z.enum(['user', 'task', 'session', 'agent']), // Updated: 'project' -> 'task', added 'agent'
  id: z.string().min(1, 'scope id is required'),
});

export const RememberRequestSchema = z.object({
  userId: z.string().min(1, 'userId is required'),
  text: z.string().min(1, 'text is required').max(10000, 'text is too long'),
  scope: MemoryScopeSchema, // MANDATORY: scope is required
  source: z.enum(['user', 'system', 'environment', 'ai']).optional(), // Optional: defaults to 'user'
  agentType: z.enum(['coding', 'healthcare', 'support', 'research', 'general']).optional(), // Optional: defaults to 'general'
  agentId: z.string().optional(), // Optional: specific agent identifier
  timestamp: z.string().datetime().optional(),
  metadata: z.record(z.any()).optional(),
  // Confirmation & promotion
  requiresConfirmation: z.boolean().optional(),
  confirmed: z.boolean().optional(),
  promote: z.boolean().optional(), // True to promote candidate to long-term
});

export const RecallRequestSchema = z.object({
  userId: z.string().min(1, 'userId is required'),
  query: z.string().min(1, 'query is required').max(1000, 'query is too long'),
  agentType: z.enum(['coding', 'healthcare', 'support', 'research', 'general']).optional(), // Optional: for recall tuning
  scope: MemoryScopeSchema.optional(), // Single scope for basic recall
  scopes: z.array(MemoryScopeSchema).optional(), // Multiple scopes for layered recall (priority: session > task > agent > user)
  k: z.number().int().positive().max(100).optional().default(10),
  tokenBudget: z.number().int().positive().max(10000).optional().default(2000),
  filters: z.object({
    types: z.array(z.enum(['preference', 'decision', 'constraint', 'fact', 'goal', 'context', 'history'])).optional(),
    sources: z.array(z.enum(['user', 'system', 'environment', 'ai'])).optional(), // Filter by source
    dateRange: z.object({
      start: z.string().datetime(),
      end: z.string().datetime(),
    }).optional(),
    tags: z.array(z.string()).optional(),
  }).optional(),
});

export const AssemblePromptRequestSchema = z.object({
  userId: z.string().min(1, 'userId is required'),
  agentInstructions: z.string().min(1, 'agentInstructions is required').max(5000),
  userInput: z.string().min(1, 'userInput is required').max(5000),
  tokenBudget: z.number().int().positive().max(10000).optional().default(2000),
});

export const ListMemoriesRequestSchema = z.object({
  userId: z.string().min(1, 'userId is required'),
  scope: MemoryScopeSchema.optional(), // Filter by scope
  limit: z.number().int().positive().max(100).optional().default(20),
  offset: z.number().int().min(0).optional().default(0),
  type: z.enum(['preference', 'decision', 'constraint', 'fact', 'goal', 'context', 'history']).optional(),
  sortBy: z.enum(['createdAt', 'updatedAt', 'confidence']).optional().default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
});

export const MergeMemoriesRequestSchema = z.object({
  memoryIdA: z.string().min(1, 'memoryIdA is required'),
  memoryIdB: z.string().min(1, 'memoryIdB is required'),
  userId: z.string().min(1, 'userId is required'),
});

export const DeleteMemoryRequestSchema = z.object({
  memoryId: z.string().min(1, 'memoryId is required'),
  userId: z.string().min(1, 'userId is required'),
});

// Validation helper
export function validateRequest<T>(schema: z.ZodSchema<T>, data: unknown): T {
  return schema.parse(data);
}
















