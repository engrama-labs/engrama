import { Memory, MemoryType, RetrievalResult, RecallRequest, MemoryStatus } from '../../types';
import { memoryConfig } from '../../config';
import { db, vectorDb } from '../../db';
import { generateEmbedding } from '../../utils/llm';
import { calculateRecencyScore } from '../../utils/helpers';

// Memory statuses that should be excluded from recall by default
const EXCLUDED_STATUSES: MemoryStatus[] = ['archived', 'merged', 'outdated'];

// Importance score weight in final ranking
const IMPORTANCE_WEIGHT = 0.15;

/**
 * Memory Retrieval Engine
 * Handles vector search, scoring, ranking, and filtering
 */
export class MemoryRetriever {
  /**
   * Retrieve relevant memories for a query
   * Supports single scope or layered recall (multiple scopes with priority)
   */
  async retrieve(request: RecallRequest): Promise<RetrievalResult[]> {
    const {
      userId,
      query,
      scope,
      scopes,
      k = 10,
      filters,
    } = request;
    
    try {
      // Determine which scopes to search
      // Priority: scopes array > single scope > all user memories (backward compatibility)
      const targetScopes = scopes || (scope ? [scope] : null);
      
      // Generate query embedding
      const queryEmbedding = await generateEmbedding(query);
      
      // Vector search (no scope filter at vector level, we'll filter after)
      const vectorResults = await this.vectorSearch(
        queryEmbedding,
        userId,
        k * 3, // Get more results for re-ranking and scope filtering
        filters
      );
      
      // Get full memory objects
      const memories = await this.getMemoriesFromVectorResults(vectorResults, userId, targetScopes);
      
      // Apply additional filters
      const filtered = this.applyFilters(memories, filters);
      
      // Score and rank (with scope priority boost and coding memory priority)
      const scored = this.scoreAndRank(filtered, query, queryEmbedding, targetScopes);
      
      // Apply recency boost
      const boosted = this.applyRecencyBoost(scored);
      
      // Return top K
      return boosted.slice(0, k);
    } catch (error) {
      console.error('Error retrieving memories:', error);
      return [];
    }
  }
  
  /**
   * Vector similarity search
   */
  async vectorSearch(
    queryEmbedding: number[],
    userId: string,
    limit: number = 10,
    filters?: RecallRequest['filters']
  ): Promise<Array<{ id: string; score: number; metadata: any }>> {
    try {
      const vectorFilters: Record<string, any> = {};
      
      if (filters?.types && filters.types.length > 0) {
        vectorFilters.types = filters.types;
      }
      
      return await vectorDb.searchVectors(
        queryEmbedding,
        userId,
        limit,
        vectorFilters
      );
    } catch (error) {
      console.error('Error in vector search:', error);
      return [];
    }
  }
  
  /**
   * Get full memory objects from vector search results
   * Filters by scope if provided
   */
  private async getMemoriesFromVectorResults(
    vectorResults: Array<{ id: string; score: number; metadata: any }>,
    userId: string,
    targetScopes: Array<{ type: string; id: string }> | null
  ): Promise<Array<{ memory: Memory; similarityScore: number }>> {
    const results: Array<{ memory: Memory; similarityScore: number }> = [];
    
    for (const result of vectorResults) {
      const memory = await db.getMemoryById(result.id, userId);
      
      if (!memory) continue;
      
      // If scopes are specified, filter by scope
      if (targetScopes && targetScopes.length > 0) {
        const matchesScope = targetScopes.some(
          targetScope => {
            // For user scope, auto-correct scope.id to match authenticated userId
            if (targetScope.type === 'user' && memory.scope.type === 'user') {
              // Match if scope.id matches userId (backend uses authenticated userId)
              return memory.scope.id === userId;
            }
            // For other scopes, exact match required
            return memory.scope.type === targetScope.type && 
                   memory.scope.id === targetScope.id;
          }
        );
        
        if (!matchesScope) {
          continue; // Skip memories outside target scopes
        }
      }
      
      results.push({
        memory,
        similarityScore: result.score,
      });
    }
    
    return results;
  }
  
  /**
   * Apply filters to memories
   */
  private applyFilters(
    memories: Array<{ memory: Memory; similarityScore: number }>,
    filters?: RecallRequest['filters'],
    includeExpired = false
  ): Array<{ memory: Memory; similarityScore: number }> {
    let filtered = memories;
    
    // Filter out archived/merged/outdated memories by default
    filtered = filtered.filter(({ memory }) => {
      const status = memory.status || 'active';
      if (EXCLUDED_STATUSES.includes(status)) return false;
      // Include expired only if explicitly requested
      if (status === 'expired' && !includeExpired) return false;
      return true;
    });
    
    // Filter by types
    if (filters?.types && filters.types.length > 0) {
      filtered = filtered.filter(({ memory }) => 
        filters.types!.includes(memory.type)
      );
    }
    
    // Filter by sources
    if (filters?.sources && filters.sources.length > 0) {
      filtered = filtered.filter(({ memory }) => 
        filters.sources!.includes(memory.source)
      );
    }
    
    // Filter by date range
    if (filters?.dateRange) {
      const start = new Date(filters.dateRange.start);
      const end = new Date(filters.dateRange.end);
      
      filtered = filtered.filter(({ memory }) => 
        memory.timestamp >= start && memory.timestamp <= end
      );
    }
    
    // Filter by tags
    if (filters?.tags && filters.tags.length > 0) {
      filtered = filtered.filter(({ memory }) => 
        filters.tags!.some(tag => memory.tags.includes(tag))
      );
    }
    
    // Filter out conflicts (unless specifically requested)
    filtered = filtered.filter(({ memory }) => 
      memory.conflictStatus !== 'conflict'
    );
    
    return filtered;
  }
  
  /**
   * Score and rank memories
   * Applies scope priority boost: session > project > user
   */
  scoreAndRank(
    memories: Array<{ memory: Memory; similarityScore: number }>,
    _query: string,
    _queryEmbedding?: number[],
    targetScopes?: Array<{ type: string; id: string }> | null
  ): RetrievalResult[] {
    const results: RetrievalResult[] = [];
    
    // Define scope priority (higher = more important)
    // Universal priority: session > task > agent > user
    const scopePriority: Record<string, number> = {
      session: 4,
      task: 3,
      agent: 2,
      user: 1,
      // Backward compatibility: 'project' maps to 'task'
      project: 3,
    };
    
    for (const { memory, similarityScore } of memories) {
      // Calculate component scores
      const recencyScore = this.calculateRecencyScore(memory);
      const confidenceScore = memory.confidence;
      const typeScore = this.getTypePriority(memory.type);
      
      // Scope priority boost (if multiple scopes provided)
      let scopeBoost = 1.0;
      if (targetScopes && targetScopes.length > 1) {
        const memoryScopePriority = scopePriority[memory.scope.type] || 1;
        const maxScopePriority = Math.max(...targetScopes.map(s => scopePriority[s.type] || 1));
        
        // Boost memories from higher priority scopes
        if (memoryScopePriority === maxScopePriority) {
          scopeBoost = 1.2; // 20% boost for highest priority scope
        } else if (memoryScopePriority === maxScopePriority - 1) {
          scopeBoost = 1.1; // 10% boost for second priority
        }
      }
      
      // UNIVERSAL MEMORY ENGINE: Boost based on source priority
      const sourcePriority = memoryConfig.sourcePriorities[memory.source] || 0.5;
      const sourceBoost = 0.9 + (sourcePriority * 0.2); // Scale source priority to 0.9-1.1 range
      
      // UNIVERSAL MEMORY ENGINE: Boost task-scoped memories for task queries
      let taskBoost = 1.0;
      if (memory.scope.type === 'task' && targetScopes?.some(s => s.type === 'task' || s.type === 'project')) {
        taskBoost = 1.2; // 20% boost for task memories in task queries
      }
      
      // Backward compatibility: 'project' scope
      if (memory.scope.type === 'project' && targetScopes?.some(s => s.type === 'project' || s.type === 'task')) {
        taskBoost = 1.2;
      }
      
      // Get importance score (normalized to 0-1)
      const importanceScore = (memory.importanceScore || 50) / 100;
      
      // Apply decay score modifier
      const decayModifier = memory.decayScore || 1.0;
      
      // Weighted final score with importance
      const weights = memoryConfig.scoringWeights;
      const baseScore = (
        similarityScore * weights.similarity +
        recencyScore * weights.recency +
        confidenceScore * weights.confidence +
        typeScore * weights.typePriority +
        importanceScore * IMPORTANCE_WEIGHT
      );
      
      const finalScore = baseScore * scopeBoost * sourceBoost * taskBoost * decayModifier;
      
      results.push({
        memory,
        score: finalScore,
        similarityScore,
        recencyScore,
        confidenceScore,
        typeScore,
      });
    }
    
    // Sort by score descending
    results.sort((a, b) => b.score - a.score);
    
    return results;
  }
  
  /**
   * Apply recency boost to scores
   */
  applyRecencyBoost(results: RetrievalResult[]): RetrievalResult[] {
    // Recency boost is already included in scoreAndRank
    // This method exists for additional custom boosting
    
    const now = new Date();
    
    return results.map(result => {
      const memory = result.memory;
      
      // Extra boost for very recent memories (last 24 hours)
      const hoursSince = (now.getTime() - memory.timestamp.getTime()) / (1000 * 60 * 60);
      
      if (hoursSince < 24) {
        const boost = 1.2;
        return {
          ...result,
          score: result.score * boost,
        };
      }
      
      return result;
    });
  }
  
  /**
   * Calculate recency score for a memory
   */
  private calculateRecencyScore(memory: Memory): number {
    return calculateRecencyScore(memory.timestamp, 0.05);
  }
  
  /**
   * Get type priority score
   */
  private getTypePriority(type: MemoryType): number {
    return memoryConfig.typePriorities[type] || 0.5;
  }
  
  /**
   * Get memories by type
   */
  async getMemoriesByType(
    userId: string,
    type: MemoryType,
    limit: number = 10
  ): Promise<Memory[]> {
    const { memories } = await db.listMemories(
      userId,
      limit,
      0,
      type,
      undefined, // scope
      'updatedAt',
      'desc'
    );
    
    return memories;
  }
  
  /**
   * Get recent memories
   */
  async getRecentMemories(
    userId: string,
    limit: number = 10
  ): Promise<Memory[]> {
    const { memories } = await db.listMemories(
      userId,
      limit,
      0,
      undefined, // type
      undefined, // scope
      'createdAt',
      'desc'
    );
    
    return memories;
  }
  
  /**
   * Search memories by text (without vector search)
   */
  async textSearch(
    userId: string,
    searchText: string,
    limit: number = 10
  ): Promise<Memory[]> {
    // This would use full-text search in production
    // For now, get all and filter
    const { memories } = await db.listMemories(userId, 100, 0);
    
    const searchLower = searchText.toLowerCase();
    const filtered = memories.filter(m => 
      m.canonicalText.toLowerCase().includes(searchLower) ||
      m.tags.some(tag => tag.toLowerCase().includes(searchLower))
    );
    
    return filtered.slice(0, limit);
  }
}

// Export singleton instance
export const memoryRetriever = new MemoryRetriever();

/**
 * Helper function to recall memories
 * This is a convenience wrapper around the MemoryRetriever
 * 
 * v2.0: Now tracks recall events for importance scoring
 */
export async function recallMemories(
  userId: string,
  query: string,
  options?: {
    limit?: number;
    scope?: { type: string; id: string };
    trackRecall?: boolean; // Default true - track this recall for importance
    includeExpired?: boolean; // Include expired memories (will reactivate if recalled)
  }
): Promise<RetrievalResult[]> {
  console.log('[RETRIEVER] recallMemories called for user:', userId);
  console.log('[RETRIEVER] Query:', query.substring(0, 50));
  console.log('[RETRIEVER] Options:', options);
  
  try {
    const results = await memoryRetriever.retrieve({
      userId,
      query,
      scope: options?.scope,
      k: options?.limit || 5,
    });
    
    console.log('[RETRIEVER] Found', results.length, 'results');
    if (results.length > 0) {
      console.log('[RETRIEVER] Top result:', results[0]?.memory?.canonicalText?.substring(0, 50));
    }
    
    // Track recall events for importance scoring (async, non-blocking)
    if (options?.trackRecall !== false && results.length > 0) {
      // Fire and forget - don't wait for tracking to complete
      trackRecallEvents(results.map(r => r.memory.id)).catch(err => {
        console.warn('[RETRIEVER] Failed to track recall events:', err);
      });
    }
    
    return results;
  } catch (error) {
    console.error('[RETRIEVER] Error:', error);
    throw error;
  }
}

/**
 * Track recall events for importance scoring
 * Updates recallCount and lastRecalledAt for each memory
 */
async function trackRecallEvents(memoryIds: string[]): Promise<void> {
  for (const memoryId of memoryIds) {
    try {
      const memory = await db.getMemoryById(memoryId);
      if (!memory) continue;
      
      const updates: Partial<Memory> = {
        recallCount: (memory.recallCount || 0) + 1,
        lastRecalledAt: new Date(),
      };
      
      // Reactivate expired memories that are recalled
      if (memory.status === 'expired') {
        updates.status = 'active';
        updates.confidence = Math.min(1, memory.confidence + 0.1);
        updates.decayScore = 0.8;
        console.log('[RETRIEVER] Reactivating expired memory:', memoryId);
      }
      
      await db.updateMemory(memoryId, updates);
    } catch (error) {
      console.warn('[RETRIEVER] Failed to track recall for memory:', memoryId, error);
    }
  }
}
















