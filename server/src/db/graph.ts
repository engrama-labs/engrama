import { getSupabaseClient } from './index';
import {
  Entity,
  EntityType,
  MemoryEntity,
  MemoryRelationship,
  EntityRelationship,
  ExtractedEntity,
  DetectedRelationship,
  MemoryRelationshipType,
  KnowledgeGraph,
  GraphNode,
  GraphEdge,
  Memory,
} from '../types';
import { generateId } from '../utils/helpers';

/**
 * Graph Database Operations
 * Handles storage and querying of entities, relationships, and knowledge graphs
 */
export const graphDb = {
  // ========================================
  // Entity Operations
  // ========================================

  /**
   * Insert or get existing entity by name and type
   */
  async upsertEntity(entity: ExtractedEntity): Promise<Entity> {
    const client = getSupabaseClient();

    // Check if entity already exists
    const { data: existing } = await client
      .from('entities')
      .select('*')
      .ilike('name', entity.name)
      .eq('type', entity.type)
      .maybeSingle();

    if (existing) {
      // Update description if provided
      if (entity.description) {
        const { data: updated, error } = await client
          .from('entities')
          .update({
            description: entity.description,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.id)
          .select()
          .single();

        if (error) throw new Error(`Failed to update entity: ${error.message}`);
        return this.mapRowToEntity(updated);
      }

      return this.mapRowToEntity(existing);
    }

    // Insert new entity
    const { data, error } = await client
      .from('entities')
      .insert({
        id: generateId('entity'),
        name: entity.name,
        type: entity.type,
        description: entity.description || null,
        metadata: {},
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to insert entity: ${error.message}`);
    return this.mapRowToEntity(data);
  },

  /**
   * Link entity to memory
   */
  async linkEntityToMemory(
    entityId: string,
    memoryId: string,
    relevanceScore: number,
    context: string
  ): Promise<void> {
    const client = getSupabaseClient();

    // Use upsert to handle duplicates
    const { error } = await client
      .from('memory_entities')
      .upsert({
        id: generateId('mem-entity'),
        memory_id: memoryId,
        entity_id: entityId,
        relevance_score: relevanceScore,
        context: context,
      }, {
        onConflict: 'memory_id,entity_id',
      });

    if (error) throw new Error(`Failed to link entity to memory: ${error.message}`);
  },

  /**
   * Get entities for a memory
   */
  async getMemoryEntities(memoryId: string): Promise<Entity[]> {
    const client = getSupabaseClient();

    const { data, error } = await client
      .from('memory_entities')
      .select('entity_id, entities(*)')
      .eq('memory_id', memoryId);

    if (error) throw new Error(`Failed to get memory entities: ${error.message}`);

    return data.map((row: any) => this.mapRowToEntity(row.entities));
  },

  /**
   * Get memories for an entity
   */
  async getEntityMemories(entityId: string, userId: string): Promise<Memory[]> {
    const client = getSupabaseClient();

    const { data, error } = await client
      .from('memory_entities')
      .select('memory_id, memories(*)')
      .eq('entity_id', entityId)
      .eq('memories.user_id', userId);

    if (error) throw new Error(`Failed to get entity memories: ${error.message}`);

    return data.map((row: any) => this.mapRowToMemory(row.memories));
  },

  /**
   * Search entities by name
   */
  async searchEntities(
    query: string,
    type?: EntityType,
    limit: number = 20
  ): Promise<Entity[]> {
    const client = getSupabaseClient();

    let queryBuilder = client
      .from('entities')
      .select('*')
      .ilike('name', `%${query}%`)
      .limit(limit);

    if (type) {
      queryBuilder = queryBuilder.eq('type', type);
    }

    const { data, error } = await queryBuilder;

    if (error) throw new Error(`Failed to search entities: ${error.message}`);

    return data.map(row => this.mapRowToEntity(row));
  },

  /**
   * Get entity by ID
   */
  async getEntityById(entityId: string): Promise<Entity | null> {
    const client = getSupabaseClient();

    const { data, error } = await client
      .from('entities')
      .select('*')
      .eq('id', entityId)
      .maybeSingle();

    if (error) throw new Error(`Failed to get entity: ${error.message}`);
    if (!data) return null;

    return this.mapRowToEntity(data);
  },

  // ========================================
  // Memory Relationship Operations
  // ========================================

  /**
   * Create relationship between memories
   */
  async createMemoryRelationship(
    sourceMemoryId: string,
    relationship: DetectedRelationship
  ): Promise<void> {
    const client = getSupabaseClient();

    const { error } = await client
      .from('memory_relationships')
      .upsert({
        id: generateId('mem-rel'),
        source_memory_id: sourceMemoryId,
        target_memory_id: relationship.targetMemoryId,
        relationship_type: relationship.relationshipType,
        confidence: relationship.confidence,
        reason: relationship.reason,
      }, {
        onConflict: 'source_memory_id,target_memory_id,relationship_type',
      });

    if (error) throw new Error(`Failed to create memory relationship: ${error.message}`);
  },

  /**
   * Get relationships for a memory
   */
  async getMemoryRelationships(memoryId: string): Promise<MemoryRelationship[]> {
    const client = getSupabaseClient();

    // Get both outgoing and incoming relationships
    const { data: outgoing, error: outError } = await client
      .from('memory_relationships')
      .select('*')
      .eq('source_memory_id', memoryId);

    const { data: incoming, error: inError } = await client
      .from('memory_relationships')
      .select('*')
      .eq('target_memory_id', memoryId);

    if (outError) throw new Error(`Failed to get outgoing relationships: ${outError.message}`);
    if (inError) throw new Error(`Failed to get incoming relationships: ${inError.message}`);

    const all = [...(outgoing || []), ...(incoming || [])];
    return all.map(row => this.mapRowToMemoryRelationship(row));
  },

  /**
   * Get all memories related to a specific memory
   */
  async getRelatedMemories(memoryId: string, userId: string): Promise<Memory[]> {
    const client = getSupabaseClient();

    // Get relationships
    const relationships = await this.getMemoryRelationships(memoryId);

    // Get unique memory IDs
    const relatedIds = new Set<string>();
    for (const rel of relationships) {
      if (rel.sourceMemoryId !== memoryId) {
        relatedIds.add(rel.sourceMemoryId);
      }
      if (rel.targetMemoryId !== memoryId) {
        relatedIds.add(rel.targetMemoryId);
      }
    }

    if (relatedIds.size === 0) return [];

    // Fetch memories
    const { data, error } = await client
      .from('memories')
      .select('*')
      .in('id', Array.from(relatedIds))
      .eq('user_id', userId);

    if (error) throw new Error(`Failed to get related memories: ${error.message}`);

    return data.map(row => this.mapRowToMemory(row));
  },

  // ========================================
  // Knowledge Graph Operations
  // ========================================

  /**
   * Build knowledge graph for a user
   */
  async buildKnowledgeGraph(
    userId: string,
    options: {
      depth?: number;
      entityTypes?: EntityType[];
      relationshipTypes?: MemoryRelationshipType[];
      centerMemoryId?: string;
      limit?: number;
    } = {}
  ): Promise<KnowledgeGraph> {
    const client = getSupabaseClient();
    const { depth = 1, entityTypes, relationshipTypes, centerMemoryId, limit = 100 } = options;

    // Start with memories
    let memoryQuery = client
      .from('memories')
      .select('*')
      .eq('user_id', userId)
      .limit(limit);

    if (centerMemoryId) {
      // If centered on a specific memory, get that and its neighbors
      memoryQuery = memoryQuery.or(`id.eq.${centerMemoryId}`);
    }

    const { data: memories, error: memError } = await memoryQuery;
    if (memError) throw new Error(`Failed to fetch memories: ${memError.message}`);

    // Get relationships between these memories
    const memoryIds = memories.map((m: any) => m.id);
    let relQuery = client
      .from('memory_relationships')
      .select('*')
      .or(`source_memory_id.in.(${memoryIds.join(',')}),target_memory_id.in.(${memoryIds.join(',')})`);

    if (relationshipTypes && relationshipTypes.length > 0) {
      relQuery = relQuery.in('relationship_type', relationshipTypes);
    }

    const { data: relationships, error: relError } = await relQuery;
    if (relError) throw new Error(`Failed to fetch relationships: ${relError.message}`);

    // Get entities linked to these memories
    let entQuery = client
      .from('memory_entities')
      .select('*, entities(*)')
      .in('memory_id', memoryIds);

    const { data: memoryEntities, error: entError } = await entQuery;
    if (entError) throw new Error(`Failed to fetch entities: ${entError.message}`);

    // Build graph structure
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const entityCounts: Record<EntityType, number> = {} as any;
    const relationshipCounts: Record<string, number> = {};

    // Add memory nodes
    for (const memory of memories) {
      nodes.push({
        id: memory.id,
        label: memory.canonical_text.substring(0, 50) + (memory.canonical_text.length > 50 ? '...' : ''),
        type: 'memory',
        data: this.mapRowToMemory(memory),
        size: 10,
        color: this.getMemoryTypeColor(memory.type),
      });
    }

    // Add entity nodes
    const addedEntities = new Set<string>();
    for (const me of memoryEntities) {
      const entity = me.entities;
      if (!entity || addedEntities.has(entity.id)) continue;

      // Filter by entity type if specified
      if (entityTypes && !entityTypes.includes(entity.type as EntityType)) continue;

      addedEntities.add(entity.id);

      nodes.push({
        id: entity.id,
        label: entity.name,
        type: 'entity',
        data: this.mapRowToEntity(entity),
        size: 8,
        color: this.getEntityTypeColor(entity.type),
      });

      // Track entity type counts
      entityCounts[entity.type as EntityType] = (entityCounts[entity.type as EntityType] || 0) + 1;

      // Add edge between memory and entity
      edges.push({
        id: `${me.memory_id}-${entity.id}`,
        source: me.memory_id,
        target: entity.id,
        type: 'has_entity',
        label: 'mentions',
        confidence: me.relevance_score,
      });
    }

    // Add memory relationship edges
    for (const rel of relationships) {
      edges.push({
        id: rel.id,
        source: rel.source_memory_id,
        target: rel.target_memory_id,
        type: rel.relationship_type,
        label: rel.relationship_type.replace('_', ' '),
        confidence: rel.confidence,
        data: this.mapRowToMemoryRelationship(rel),
      });

      // Track relationship type counts
      relationshipCounts[rel.relationship_type] = (relationshipCounts[rel.relationship_type] || 0) + 1;
    }

    return {
      nodes,
      edges,
      metadata: {
        totalNodes: nodes.length,
        totalEdges: edges.length,
        entityTypes: entityCounts,
        relationshipTypes: relationshipCounts,
      },
    };
  },

  // ========================================
  // Helper Functions
  // ========================================

  mapRowToEntity(row: any): Entity {
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      description: row.description,
      metadata: row.metadata || {},
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  },

  mapRowToMemoryRelationship(row: any): MemoryRelationship {
    return {
      id: row.id,
      sourceMemoryId: row.source_memory_id,
      targetMemoryId: row.target_memory_id,
      relationshipType: row.relationship_type,
      confidence: row.confidence,
      reason: row.reason,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  },

  mapRowToMemory(row: any): Memory {
    return {
      id: row.id,
      userId: row.user_id,
      canonicalText: row.canonical_text,
      type: row.type,
      confidence: row.confidence,
      tags: row.tags || [],
      timestamp: new Date(row.timestamp),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      version: row.version,
      ttl: row.ttl ? new Date(row.ttl) : undefined,
      provenance: row.provenance || [],
      linkedMemories: row.linked_memories || [],
      conflictStatus: row.conflict_status,
      visibility: row.visibility,
      metadata: row.metadata || {},
    };
  },

  getMemoryTypeColor(type: string): string {
    const colors: Record<string, string> = {
      identity: '#FF6B6B',
      profile: '#4ECDC4',
      preference: '#45B7D1',
      goal: '#FFA07A',
      fact: '#98D8C8',
      document: '#F7B731',
      location: '#5F27CD',
    };
    return colors[type] || '#95A5A6';
  },

  getEntityTypeColor(type: string): string {
    const colors: Record<string, string> = {
      person: '#E74C3C',
      place: '#3498DB',
      organization: '#9B59B6',
      concept: '#1ABC9C',
      event: '#F39C12',
      product: '#34495E',
      technology: '#16A085',
      skill: '#27AE60',
    };
    return colors[type] || '#95A5A6';
  },
};


















