/**
 * Memory Manager Service
 * 
 * Handles intelligent memory lifecycle management including:
 * - Smart memory updates (detect updates vs new memories)
 * - Conflict detection and resolution
 * - Memory deduplication and merging
 * - Importance scoring
 * - Lifecycle status management
 */

import {
  Memory,
  MemoryStatus,
  MemoryType,
  MemorySource,
  MemoryScope,
  SimilarityCheckResult,
  MergeOperationResult,
  ConflictDetectionResult,
  ImportanceFactors,
  PIIType,
  Provenance,
} from '../../types';
import { db, vectorDb } from '../../db';
import { generateEmbedding, callLLMWithJSON } from '../../utils/llm';
import { generateId } from '../../utils/helpers';
import { importanceScorer } from '../importance-scorer';
import { conflictResolver } from '../conflict-resolver';
import { mergeEngine } from '../merge-engine';
import { piiDetector } from '../pii-detector';

// Similarity threshold for considering memories as duplicates
const SIMILARITY_THRESHOLD = 0.88;
// Similarity threshold for considering memories as related (potential update)
const UPDATE_THRESHOLD = 0.75;

/**
 * Default values for new memory fields
 */
function getDefaultMemoryFields(): Partial<Memory> {
  return {
    status: 'active',
    decayScore: 1.0,
    importanceScore: 50, // Start at neutral importance
    recallCount: 0,
    usedInPromptCount: 0,
    userExplicitRemember: false,
    piiTags: [],
    isEncrypted: false,
    isSensitive: false,
    mergedFromIds: [],
    derivedFromIds: [],
  };
}

/**
 * Memory Manager class
 */
class MemoryManager {
  /**
   * Store a new memory with intelligent processing
   * - Checks for duplicates
   * - Detects updates to existing memories
   * - Resolves conflicts
   * - Computes importance score
   */
  async storeMemory(
    userId: string,
    canonicalText: string,
    options: {
      scope: MemoryScope;
      category: MemoryType;
      source?: MemorySource;
      confidence?: number;
      tags?: string[];
      metadata?: Record<string, any>;
      userExplicitRemember?: boolean;
      provenance?: Provenance[];
      agentType?: string;
    }
  ): Promise<{ memory: Memory; action: 'created' | 'merged' | 'updated' | 'conflict' }> {
    console.log('[MEMORY_MANAGER] Storing memory:', canonicalText.substring(0, 50));

    // Generate embedding for similarity check
    const embedding = await generateEmbedding(canonicalText);

    // Check for similar existing memories
    const similarityCheck = await this.checkSimilarity(userId, canonicalText, embedding, options.scope);
    
    // Detect PII
    const piiTags = piiDetector.detect(canonicalText);
    const isSensitive = piiTags.length > 0;

    // Compute initial importance
    const importanceScore = importanceScorer.computeInitial({
      category: options.category,
      confidence: options.confidence || 0.8,
      userExplicitRemember: options.userExplicitRemember || false,
      source: options.source || 'user',
      piiTags,
    });

    // Handle based on similarity check result
    if (similarityCheck.isSemanticDuplicate) {
      // Deduplicate - boost existing memory confidence
      console.log('[MEMORY_MANAGER] Duplicate detected, merging...');
      const result = await mergeEngine.mergeDuplicate(
        similarityCheck.memoryId,
        canonicalText,
        options.confidence || 0.8
      );
      const existingMemory = await db.getMemoryById(similarityCheck.memoryId);
      return { memory: existingMemory!, action: 'merged' };
    }

    if (similarityCheck.suggestedAction === 'update') {
      // This is an update to existing memory
      console.log('[MEMORY_MANAGER] Update detected, marking old as outdated...');
      const newMemory = await this.createUpdateMemory(
        userId,
        canonicalText,
        embedding,
        similarityCheck.memoryId,
        {
          ...options,
          piiTags,
          isSensitive,
          importanceScore,
        }
      );
      return { memory: newMemory, action: 'updated' };
    }

    if (similarityCheck.suggestedAction === 'conflict') {
      // Conflict detected
      console.log('[MEMORY_MANAGER] Conflict detected, resolving...');
      const conflictResult = await conflictResolver.resolve(
        similarityCheck.memoryId,
        canonicalText,
        options.confidence || 0.8
      );
      
      if (conflictResult.resolution === 'auto_resolved' && conflictResult.resolvedMemoryId) {
        const resolvedMemory = await db.getMemoryById(conflictResult.resolvedMemoryId);
        return { memory: resolvedMemory!, action: 'conflict' };
      }
      
      // Create new memory with conflict group
      const existingMemory = await db.getMemoryById(similarityCheck.memoryId);
      const conflictGroupId = existingMemory?.conflictGroupId || generateId();
      
      const newMemory = await this.createNewMemory(userId, canonicalText, embedding, {
        ...options,
        piiTags,
        isSensitive,
        importanceScore,
        conflictGroupId,
        conflictStatus: 'conflict',
      });
      
      // Mark existing as conflicting too
      await db.updateMemory(similarityCheck.memoryId, {
        conflictGroupId,
        conflictStatus: 'conflict',
      });
      
      return { memory: newMemory, action: 'conflict' };
    }

    // No similarity issues - create new memory
    console.log('[MEMORY_MANAGER] Creating new memory...');
    const newMemory = await this.createNewMemory(userId, canonicalText, embedding, {
      ...options,
      piiTags,
      isSensitive,
      importanceScore,
    });
    
    return { memory: newMemory, action: 'created' };
  }

  /**
   * Check similarity with existing memories
   */
  private async checkSimilarity(
    userId: string,
    text: string,
    embedding: number[],
    scope: MemoryScope
  ): Promise<SimilarityCheckResult> {
    // Search for similar vectors
    const similarVectors = await vectorDb.search(embedding, 5, {
      userId,
      minScore: UPDATE_THRESHOLD,
    });

    if (similarVectors.length === 0) {
      return {
        memoryId: '',
        similarity: 0,
        isSemanticDuplicate: false,
        isEntityMatch: false,
        suggestedAction: 'none',
        reason: 'No similar memories found',
      };
    }

    const topMatch = similarVectors[0];
    const topMemory = await db.getMemoryById(topMatch.memoryId);

    if (!topMemory) {
      return {
        memoryId: '',
        similarity: 0,
        isSemanticDuplicate: false,
        isEntityMatch: false,
        suggestedAction: 'none',
        reason: 'Top match memory not found in database',
      };
    }

    // High similarity = duplicate
    if (topMatch.score >= SIMILARITY_THRESHOLD) {
      return {
        memoryId: topMatch.memoryId,
        similarity: topMatch.score,
        isSemanticDuplicate: true,
        isEntityMatch: true,
        suggestedAction: 'merge',
        reason: `High semantic similarity (${(topMatch.score * 100).toFixed(1)}%)`,
      };
    }

    // Medium similarity = potential update or conflict
    if (topMatch.score >= UPDATE_THRESHOLD) {
      // Use LLM to determine if this is an update or conflict
      const relation = await this.detectRelationType(topMemory.canonicalText, text);
      
      return {
        memoryId: topMatch.memoryId,
        similarity: topMatch.score,
        isSemanticDuplicate: false,
        isEntityMatch: relation.sameEntity,
        suggestedAction: relation.type,
        reason: relation.reason,
      };
    }

    return {
      memoryId: '',
      similarity: topMatch.score,
      isSemanticDuplicate: false,
      isEntityMatch: false,
      suggestedAction: 'none',
      reason: 'Similarity below threshold',
    };
  }

  /**
   * Detect relation type between two memory texts using LLM
   */
  private async detectRelationType(
    existingText: string,
    newText: string
  ): Promise<{ type: 'update' | 'conflict' | 'none'; sameEntity: boolean; reason: string }> {
    try {
      const prompt = `Analyze these two memory statements and determine their relationship:

EXISTING: "${existingText}"
NEW: "${newText}"

Determine:
1. Do they refer to the same entity/subject?
2. Is the NEW statement an UPDATE to the EXISTING (e.g., changed job, new preference)?
3. Do they CONTRADICT each other (both claim to be currently true but can't both be true)?
4. Are they UNRELATED?

Respond in JSON:
{
  "sameEntity": true/false,
  "type": "update" | "conflict" | "none",
  "reason": "brief explanation"
}`;

      const result = await callLLMWithJSON<{
        sameEntity: boolean;
        type: 'update' | 'conflict' | 'none';
        reason: string;
      }>(prompt, undefined, { temperature: 0.1, maxTokens: 200 });

      return result;
    } catch (error) {
      console.error('[MEMORY_MANAGER] Error detecting relation type:', error);
      return { type: 'none', sameEntity: false, reason: 'Detection failed' };
    }
  }

  /**
   * Create a new memory that updates an existing one
   */
  private async createUpdateMemory(
    userId: string,
    canonicalText: string,
    embedding: number[],
    oldMemoryId: string,
    options: {
      scope: MemoryScope;
      category: MemoryType;
      source?: MemorySource;
      confidence?: number;
      tags?: string[];
      metadata?: Record<string, any>;
      piiTags: PIIType[];
      isSensitive: boolean;
      importanceScore: number;
      provenance?: Provenance[];
      agentType?: string;
    }
  ): Promise<Memory> {
    // Mark old memory as outdated
    await db.updateMemory(oldMemoryId, {
      status: 'outdated',
      updatedAt: new Date(),
    });

    // Create new memory with link to old
    const newMemory = await this.createNewMemory(userId, canonicalText, embedding, {
      ...options,
      updatedFromId: oldMemoryId,
    });

    // Create relationship in graph
    await db.createMemoryRelationship({
      id: generateId(),
      sourceMemoryId: newMemory.id,
      targetMemoryId: oldMemoryId,
      relationshipType: 'updates',
      confidence: 0.95,
      reason: 'New memory updates previous version',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    return newMemory;
  }

  /**
   * Create a brand new memory
   */
  private async createNewMemory(
    userId: string,
    canonicalText: string,
    embedding: number[],
    options: {
      scope: MemoryScope;
      category: MemoryType;
      source?: MemorySource;
      confidence?: number;
      tags?: string[];
      metadata?: Record<string, any>;
      piiTags?: PIIType[];
      isSensitive?: boolean;
      importanceScore?: number;
      userExplicitRemember?: boolean;
      provenance?: Provenance[];
      agentType?: string;
      updatedFromId?: string;
      conflictGroupId?: string;
      conflictStatus?: 'none' | 'conflict' | 'resolved' | 'superseded';
    }
  ): Promise<Memory> {
    const now = new Date();
    const memoryId = generateId();

    const memory: Memory = {
      id: memoryId,
      userId,
      scope: options.scope,
      category: options.category,
      canonicalText,
      type: options.category,
      source: options.source || 'user',
      confidence: options.confidence || 0.8,
      tags: options.tags || [],
      timestamp: now,
      createdAt: now,
      updatedAt: now,
      version: 1,
      provenance: options.provenance || [{
        source: options.source || 'user',
        timestamp: now,
        rawText: canonicalText,
        confidence: options.confidence || 0.8,
        agentType: options.agentType as any,
      }],
      linkedMemories: [],
      conflictStatus: options.conflictStatus || 'none',
      visibility: 'private',
      metadata: options.metadata || {},
      agentType: options.agentType as any,

      // Lifecycle fields
      status: 'active',
      lastVerifiedAt: now,
      decayScore: 1.0,

      // Importance & usage
      importanceScore: options.importanceScore || 50,
      recallCount: 0,
      usedInPromptCount: 0,
      userExplicitRemember: options.userExplicitRemember || false,

      // Relationships
      updatedFromId: options.updatedFromId,
      mergedFromIds: [],
      derivedFromIds: [],
      conflictGroupId: options.conflictGroupId,

      // Safety
      piiTags: options.piiTags || [],
      isEncrypted: false,
      isSensitive: options.isSensitive || false,

      // Confirmation
      requiresConfirmation: false,
      confirmed: true,
      promoted: true,
    };

    // Store in database
    await db.insertMemory(memory);

    // Store vector
    await vectorDb.insertVector(memoryId, embedding, {
      userId,
      type: options.category,
      timestamp: now.getTime(),
      confidence: options.confidence || 0.8,
    });

    console.log('[MEMORY_MANAGER] Memory created:', memoryId);
    return memory;
  }

  /**
   * Record a recall event (for importance tracking)
   */
  async recordRecall(memoryId: string): Promise<void> {
    const memory = await db.getMemoryById(memoryId);
    if (!memory) return;

    const updates: Partial<Memory> = {
      recallCount: (memory.recallCount || 0) + 1,
      lastRecalledAt: new Date(),
      updatedAt: new Date(),
    };

    // If memory was expired, reactivate it
    if (memory.status === 'expired') {
      updates.status = 'active';
      updates.confidence = Math.min(1, memory.confidence + 0.1); // Boost confidence
      updates.decayScore = 0.8; // Reset decay partially
      console.log('[MEMORY_MANAGER] Reactivating expired memory:', memoryId);
    }

    // Recalculate importance
    updates.importanceScore = importanceScorer.compute({
      ...memory,
      ...updates,
    } as Memory);

    await db.updateMemory(memoryId, updates);
  }

  /**
   * Record prompt assembly usage
   */
  async recordPromptUsage(memoryIds: string[]): Promise<void> {
    for (const memoryId of memoryIds) {
      const memory = await db.getMemoryById(memoryId);
      if (!memory) continue;

      await db.updateMemory(memoryId, {
        usedInPromptCount: (memory.usedInPromptCount || 0) + 1,
        updatedAt: new Date(),
      });
    }
  }

  /**
   * Archive a memory (soft delete)
   */
  async archiveMemory(memoryId: string): Promise<void> {
    await db.updateMemory(memoryId, {
      status: 'archived',
      updatedAt: new Date(),
    });
    console.log('[MEMORY_MANAGER] Memory archived:', memoryId);
  }

  /**
   * Restore an archived memory
   */
  async restoreMemory(memoryId: string): Promise<void> {
    await db.updateMemory(memoryId, {
      status: 'active',
      updatedAt: new Date(),
    });
    console.log('[MEMORY_MANAGER] Memory restored:', memoryId);
  }

  /**
   * Get active memories for user (excludes archived/expired)
   */
  async getActiveMemories(userId: string, limit = 100): Promise<Memory[]> {
    return db.getMemoriesByStatus(userId, ['active'], limit);
  }

  /**
   * Verify a memory (update lastVerifiedAt)
   */
  async verifyMemory(memoryId: string): Promise<void> {
    await db.updateMemory(memoryId, {
      lastVerifiedAt: new Date(),
      confidence: 1.0,
      updatedAt: new Date(),
    });
  }
}

export const memoryManager = new MemoryManager();
export default memoryManager;















