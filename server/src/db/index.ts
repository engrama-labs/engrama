import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { QdrantClient } from '@qdrant/js-client-rest';
import { config } from '../config';
import { Memory, MemoryType, MemoryStatus, MemoryRelationship } from '../types';

let supabaseClient: SupabaseClient | null = null;
let qdrantClient: QdrantClient | null = null;

// Initialize Supabase
export function getSupabaseClient(): SupabaseClient {
  if (!supabaseClient) {
    supabaseClient = createClient(config.supabase.url, config.supabase.key);
  }
  return supabaseClient;
}

// Initialize Qdrant
export function getQdrantClient(): QdrantClient {
  if (!qdrantClient) {
    qdrantClient = new QdrantClient({
      url: config.qdrant.url,
      apiKey: config.qdrant.apiKey,
    });
  }
  return qdrantClient;
}

// Initialize vector collection
export async function initializeVectorCollection(): Promise<void> {
  const client = getQdrantClient();
  
  try {
    // Check if collection exists
    const collections = await client.getCollections();
    const exists = collections.collections.some(c => c.name === config.qdrant.collection);
    
    if (!exists) {
      // Create collection
      await client.createCollection(config.qdrant.collection, {
        vectors: {
          size: config.memory.embeddingDimension,
          distance: 'Cosine',
        },
      });
      
      console.log(`Created Qdrant collection: ${config.qdrant.collection}`);
    }
  } catch (error) {
    console.error('Error initializing vector collection:', error);
    throw error;
  }
}

// Database operations for memories
export const db = {
  // Insert a new memory
  async insertMemory(memory: Memory): Promise<Memory> {
    const client = getSupabaseClient();
    
    // Validate scope is present
    if (!memory.scope || !memory.scope.type || !memory.scope.id) {
      throw new Error('Memory must have a valid scope (type and id)');
    }
    
    const { data, error } = await client
      .from('memories')
      .insert({
        id: memory.id,
        user_id: memory.userId,
        agent_id: memory.agentId || null,
        scope_type: memory.scope.type,
        scope_id: memory.scope.id,
        category: memory.category || memory.type, // Use category if available, fallback to type
        canonical_text: memory.canonicalText,
        type: memory.type,
        source: memory.source || 'user', // Default to 'user' for safety
        confidence: memory.confidence,
        tags: memory.tags,
        timestamp: memory.timestamp.toISOString(),
        created_at: memory.createdAt.toISOString(),
        updated_at: memory.updatedAt.toISOString(),
        version: memory.version,
        ttl: memory.ttl?.toISOString(),
        provenance: memory.provenance,
        linked_memories: memory.linkedMemories,
        conflict_status: memory.conflictStatus,
        visibility: memory.visibility,
        metadata: {
          ...memory.metadata,
          // Store agent type and confirmation fields in metadata for now (will be columns after migration)
          agentType: memory.agentType,
          requiresConfirmation: memory.requiresConfirmation,
          confirmed: memory.confirmed,
          promoted: memory.promoted,
          supersedesMemoryId: memory.supersedesMemoryId,
        },
      })
      .select()
      .single();
    
    if (error) {
      throw new Error(`Failed to insert memory: ${error.message}`);
    }
    
    return this.mapRowToMemory(data);
  },
  
  // Get memory by ID
  async getMemoryById(memoryId: string, userId: string): Promise<Memory | null> {
    const client = getSupabaseClient();
    
    const { data, error } = await client
      .from('memories')
      .select('*')
      .eq('id', memoryId)
      .eq('user_id', userId)
      .single();
    
    if (error || !data) {
      return null;
    }
    
    return this.mapRowToMemory(data);
  },
  
  // Update memory
  async updateMemory(memory: Memory): Promise<Memory> {
    const client = getSupabaseClient();
    
    const { data, error } = await client
      .from('memories')
      .update({
        canonical_text: memory.canonicalText,
        type: memory.type,
        confidence: memory.confidence,
        tags: memory.tags,
        timestamp: memory.timestamp.toISOString(),
        updated_at: memory.updatedAt.toISOString(),
        version: memory.version,
        ttl: memory.ttl?.toISOString(),
        provenance: memory.provenance,
        linked_memories: memory.linkedMemories,
        conflict_status: memory.conflictStatus,
        visibility: memory.visibility,
        metadata: memory.metadata,
      })
      .eq('id', memory.id)
      .eq('user_id', memory.userId)
      .select()
      .single();
    
    if (error) {
      throw new Error(`Failed to update memory: ${error.message}`);
    }
    
    return this.mapRowToMemory(data);
  },
  
  // Delete memory
  async deleteMemory(memoryId: string, userId: string): Promise<boolean> {
    const client = getSupabaseClient();
    
    const { error } = await client
      .from('memories')
      .delete()
      .eq('id', memoryId)
      .eq('user_id', userId);
    
    if (error) {
      throw new Error(`Failed to delete memory: ${error.message}`);
    }
    
    return true;
  },
  
  // List memories with filters
  async listMemories(
    userId: string,
    limit: number = 20,
    offset: number = 0,
    type?: MemoryType,
    scope?: { type: string; id: string },
    sortBy: 'createdAt' | 'updatedAt' | 'confidence' = 'createdAt',
    sortOrder: 'asc' | 'desc' = 'desc'
  ): Promise<{ memories: Memory[]; total: number }> {
    const client = getSupabaseClient();
    
    let query = client
      .from('memories')
      .select('*', { count: 'exact' })
      .eq('user_id', userId);
    
    // Filter by scope if provided
    if (scope) {
      query = query
        .eq('scope_type', scope.type)
        .eq('scope_id', scope.id);
    }
    
    if (type) {
      query = query.eq('type', type);
    }
    
    const sortColumn = sortBy === 'createdAt' ? 'created_at' : 
                       sortBy === 'updatedAt' ? 'updated_at' : 'confidence';
    
    query = query
      .order(sortColumn, { ascending: sortOrder === 'asc' })
      .range(offset, offset + limit - 1);
    
    const { data, error, count } = await query;
    
    if (error) {
      throw new Error(`Failed to list memories: ${error.message}`);
    }
    
    return {
      memories: (data || []).map(row => this.mapRowToMemory(row)),
      total: count || 0,
    };
  },
  
  // Find similar memories by text hash (for deduplication)
  async findSimilarMemories(
    userId: string,
    canonicalText: string,
    threshold: number = 0.85
  ): Promise<Memory[]> {
    const client = getSupabaseClient();
    
    // Simple text-based search (in production, would use vector similarity)
    const { data, error } = await client
      .from('memories')
      .select('*')
      .eq('user_id', userId)
      .textSearch('canonical_text', canonicalText);
    
    if (error || !data) {
      return [];
    }
    
    return data.map(row => this.mapRowToMemory(row));
  },

  // ========================================
  // NEW LIFECYCLE METHODS (v2.0)
  // ========================================

  // Get memory by ID (without requiring userId)
  async getMemoryById(memoryId: string): Promise<Memory | null> {
    const client = getSupabaseClient();
    
    const { data, error } = await client
      .from('memories')
      .select('*')
      .eq('id', memoryId)
      .single();
    
    if (error || !data) {
      return null;
    }
    
    return this.mapRowToMemory(data);
  },

  // Partial update of memory fields
  async updateMemory(memoryId: string, updates: Partial<Memory>): Promise<void> {
    const client = getSupabaseClient();
    
    // Map Memory fields to database columns
    const dbUpdates: Record<string, any> = {};
    
    if (updates.canonicalText !== undefined) dbUpdates.canonical_text = updates.canonicalText;
    if (updates.type !== undefined) dbUpdates.type = updates.type;
    if (updates.category !== undefined) dbUpdates.category = updates.category;
    if (updates.confidence !== undefined) dbUpdates.confidence = updates.confidence;
    if (updates.tags !== undefined) dbUpdates.tags = updates.tags;
    if (updates.updatedAt !== undefined) dbUpdates.updated_at = updates.updatedAt.toISOString();
    if (updates.version !== undefined) dbUpdates.version = updates.version;
    if (updates.ttl !== undefined) dbUpdates.ttl = updates.ttl?.toISOString();
    if (updates.provenance !== undefined) dbUpdates.provenance = updates.provenance;
    if (updates.linkedMemories !== undefined) dbUpdates.linked_memories = updates.linkedMemories;
    if (updates.conflictStatus !== undefined) dbUpdates.conflict_status = updates.conflictStatus;
    if (updates.visibility !== undefined) dbUpdates.visibility = updates.visibility;
    
    // Store lifecycle fields in metadata (until proper migration)
    const metadata: Record<string, any> = {};
    if (updates.status !== undefined) metadata.status = updates.status;
    if (updates.lastVerifiedAt !== undefined) metadata.lastVerifiedAt = updates.lastVerifiedAt?.toISOString();
    if (updates.decayScore !== undefined) metadata.decayScore = updates.decayScore;
    if (updates.importanceScore !== undefined) metadata.importanceScore = updates.importanceScore;
    if (updates.recallCount !== undefined) metadata.recallCount = updates.recallCount;
    if (updates.lastRecalledAt !== undefined) metadata.lastRecalledAt = updates.lastRecalledAt?.toISOString();
    if (updates.usedInPromptCount !== undefined) metadata.usedInPromptCount = updates.usedInPromptCount;
    if (updates.userExplicitRemember !== undefined) metadata.userExplicitRemember = updates.userExplicitRemember;
    if (updates.updatedFromId !== undefined) metadata.updatedFromId = updates.updatedFromId;
    if (updates.mergedFromIds !== undefined) metadata.mergedFromIds = updates.mergedFromIds;
    if (updates.derivedFromIds !== undefined) metadata.derivedFromIds = updates.derivedFromIds;
    if (updates.conflictGroupId !== undefined) metadata.conflictGroupId = updates.conflictGroupId;
    if (updates.piiTags !== undefined) metadata.piiTags = updates.piiTags;
    if (updates.isEncrypted !== undefined) metadata.isEncrypted = updates.isEncrypted;
    if (updates.isSensitive !== undefined) metadata.isSensitive = updates.isSensitive;
    if (updates.supersedesMemoryId !== undefined) metadata.supersedesMemoryId = updates.supersedesMemoryId;

    // Merge with existing metadata
    if (Object.keys(metadata).length > 0) {
      const existing = await this.getMemoryById(memoryId);
      if (existing) {
        dbUpdates.metadata = { ...existing.metadata, ...metadata };
      }
    }
    
    const { error } = await client
      .from('memories')
      .update(dbUpdates)
      .eq('id', memoryId);
    
    if (error) {
      throw new Error(`Failed to update memory: ${error.message}`);
    }
  },

  // Get memories by status
  async getMemoriesByStatus(
    userId: string, 
    statuses: MemoryStatus[], 
    limit: number = 100
  ): Promise<Memory[]> {
    const client = getSupabaseClient();
    
    // Since status is in metadata, we need to filter post-query
    // In production, add status as a proper column
    const { data, error } = await client
      .from('memories')
      .select('*')
      .eq('user_id', userId)
      .limit(limit * 2); // Over-fetch to filter
    
    if (error || !data) {
      return [];
    }
    
    const memories = data.map(row => this.mapRowToMemory(row));
    return memories.filter(m => 
      statuses.includes(m.status || 'active')
    ).slice(0, limit);
  },

  // Get memories by conflict group
  async getMemoriesByConflictGroup(conflictGroupId: string): Promise<Memory[]> {
    const client = getSupabaseClient();
    
    // Since conflictGroupId is in metadata, filter post-query
    const { data, error } = await client
      .from('memories')
      .select('*')
      .limit(100);
    
    if (error || !data) {
      return [];
    }
    
    const memories = data.map(row => this.mapRowToMemory(row));
    return memories.filter(m => m.conflictGroupId === conflictGroupId);
  },

  // Get all active memories (for decay processing)
  async getAllActiveMemories(limit: number = 10000): Promise<Memory[]> {
    const client = getSupabaseClient();
    
    const { data, error } = await client
      .from('memories')
      .select('*')
      .limit(limit);
    
    if (error || !data) {
      return [];
    }
    
    const memories = data.map(row => this.mapRowToMemory(row));
    return memories.filter(m => 
      m.status === 'active' || m.status === undefined
    );
  },

  // Create memory relationship
  async createMemoryRelationship(relationship: MemoryRelationship): Promise<void> {
    const client = getSupabaseClient();
    
    try {
      await client
        .from('memory_relationships')
        .insert({
          id: relationship.id,
          source_memory_id: relationship.sourceMemoryId,
          target_memory_id: relationship.targetMemoryId,
          relationship_type: relationship.relationshipType,
          confidence: relationship.confidence,
          reason: relationship.reason,
          created_at: relationship.createdAt.toISOString(),
          updated_at: relationship.updatedAt.toISOString(),
        });
    } catch (error) {
      // Table might not exist yet - log and continue
      console.warn('[DB] Could not create memory relationship:', error);
    }
  },
  
  // Helper to map database row to Memory object
  mapRowToMemory(row: any): Memory {
    // Handle migration: if scope columns don't exist, default to user scope
    const scopeType = row.scope_type || 'user';
    const scopeId = row.scope_id || row.user_id || '';
    const metadata = row.metadata || {};
    
    return {
      id: row.id,
      userId: row.user_id,
      agentId: row.agent_id,
      scope: {
        type: scopeType as 'user' | 'project' | 'session' | 'task' | 'agent' | 'global',
        id: scopeId,
      },
      category: row.category || row.type,
      canonicalText: row.canonical_text,
      type: row.type,
      source: row.source || 'user',
      confidence: row.confidence,
      tags: row.tags || [],
      timestamp: new Date(row.timestamp),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      version: row.version,
      ttl: row.ttl ? new Date(row.ttl) : undefined,
      provenance: row.provenance || [],
      linkedMemories: row.linked_memories || [],
      conflictStatus: row.conflict_status || 'none',
      visibility: row.visibility || 'private',
      metadata,
      
      // Lifecycle fields (from metadata until proper migration)
      status: metadata.status || 'active',
      lastVerifiedAt: metadata.lastVerifiedAt ? new Date(metadata.lastVerifiedAt) : undefined,
      decayScore: metadata.decayScore ?? 1.0,
      
      // Importance & usage
      importanceScore: metadata.importanceScore ?? 50,
      recallCount: metadata.recallCount ?? 0,
      lastRecalledAt: metadata.lastRecalledAt ? new Date(metadata.lastRecalledAt) : undefined,
      usedInPromptCount: metadata.usedInPromptCount ?? 0,
      userExplicitRemember: metadata.userExplicitRemember ?? false,
      
      // Relationships
      updatedFromId: metadata.updatedFromId,
      mergedFromIds: metadata.mergedFromIds || [],
      derivedFromIds: metadata.derivedFromIds || [],
      conflictGroupId: metadata.conflictGroupId,
      
      // Safety
      piiTags: metadata.piiTags || [],
      isEncrypted: metadata.isEncrypted ?? false,
      isSensitive: metadata.isSensitive ?? false,
      
      // Confirmation
      requiresConfirmation: metadata.requiresConfirmation,
      confirmed: metadata.confirmed,
      promoted: metadata.promoted,
      candidateId: metadata.candidateId,
      supersedesMemoryId: metadata.supersedesMemoryId,
      
      // Agent type
      agentType: metadata.agentType,
    };
  },
};

// Vector database operations
export const vectorDb = {
  // Insert vector
  async insertVector(
    memoryId: string,
    vector: number[],
    metadata: {
      userId: string;
      type: MemoryType;
      timestamp: number;
      confidence: number;
    }
  ): Promise<void> {
    const client = getQdrantClient();
    
    await client.upsert(config.qdrant.collection, {
      points: [
        {
          id: memoryId,
          vector,
          payload: metadata,
        },
      ],
    });
  },
  
  // Get vector by memory ID
  async getVector(memoryId: string): Promise<number[] | null> {
    try {
      const client = getQdrantClient();
      
      const result = await client.retrieve(config.qdrant.collection, {
        ids: [memoryId],
        with_vector: true,
      });
      
      if (result && result.length > 0 && result[0].vector) {
        return result[0].vector as number[];
      }
      
      return null;
    } catch (error) {
      console.error('Error getting vector:', error);
      return null;
    }
  },
  
  // Search vectors
  async searchVectors(
    queryVector: number[],
    userId: string,
    limit: number = 10,
    filters?: Record<string, any>
  ): Promise<Array<{ id: string; score: number; metadata: any }>> {
    const client = getQdrantClient();
    
    const filter: any = {
      must: [
        {
          key: 'userId',
          match: { value: userId },
        },
      ],
    };
    
    if (filters?.types && filters.types.length > 0) {
      filter.must.push({
        key: 'type',
        match: { any: filters.types },
      });
    }
    
    const results = await client.search(config.qdrant.collection, {
      vector: queryVector,
      filter,
      limit,
    });
    
    return results.map(result => ({
      id: result.id as string,
      score: result.score,
      metadata: result.payload,
    }));
  },
  
  // Delete vector
  async deleteVector(memoryId: string): Promise<void> {
    const client = getQdrantClient();
    
    await client.delete(config.qdrant.collection, {
      points: [memoryId],
    });
  },

  // Search vectors with flexible options (v2.0)
  async search(
    vector: number[],
    limit: number = 10,
    options?: {
      userId?: string;
      minScore?: number;
      types?: string[];
    }
  ): Promise<Array<{ memoryId: string; score: number; metadata: any }>> {
    try {
      const client = getQdrantClient();
      
      const filter: any = { must: [] };
      
      if (options?.userId) {
        filter.must.push({
          key: 'userId',
          match: { value: options.userId },
        });
      }
      
      if (options?.types && options.types.length > 0) {
        filter.must.push({
          key: 'type',
          match: { any: options.types },
        });
      }
      
      const results = await client.search(config.qdrant.collection, {
        vector,
        filter: filter.must.length > 0 ? filter : undefined,
        limit,
        score_threshold: options?.minScore,
      });
      
      return results.map(result => ({
        memoryId: result.id as string,
        score: result.score,
        metadata: result.payload,
      }));
    } catch (error) {
      console.error('[VECTOR_DB] Search error:', error);
      return [];
    }
  },
};






