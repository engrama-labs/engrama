/**
 * Merge Engine Service
 * 
 * Handles memory deduplication and merging:
 * - Semantic duplicate detection
 * - Merge into canonical memory
 * - Provenance preservation
 * - Confidence boosting
 */

import { Memory, MergeOperationResult, Provenance } from '../../types';
import { db } from '../../db';
import { callLLMWithJSON, callLLM } from '../../utils/llm';
import { generateId } from '../../utils/helpers';

// Similarity threshold for automatic merging
const MERGE_SIMILARITY_THRESHOLD = 0.88;

class MergeEngine {
  /**
   * Merge a duplicate into existing memory
   * Boosts confidence and adds provenance
   */
  async mergeDuplicate(
    existingMemoryId: string,
    duplicateText: string,
    duplicateConfidence: number
  ): Promise<MergeOperationResult> {
    const existingMemory = await db.getMemoryById(existingMemoryId);
    
    if (!existingMemory) {
      return {
        success: false,
        mergedMemoryId: '',
        sourceMemoryIds: [],
        action: 'merged',
        confidenceBoost: 0,
      };
    }

    // Add to provenance
    const newProvenance: Provenance = {
      source: 'user',
      timestamp: new Date(),
      rawText: duplicateText,
      confidence: duplicateConfidence,
    };

    // Boost confidence (diminishing returns)
    const currentConfidence = existingMemory.confidence;
    const confidenceBoost = Math.min(0.1, (1 - currentConfidence) * 0.2);
    const newConfidence = Math.min(1, currentConfidence + confidenceBoost);

    // Update memory
    await db.updateMemory(existingMemoryId, {
      confidence: newConfidence,
      provenance: [...existingMemory.provenance, newProvenance],
      importanceScore: (existingMemory.importanceScore || 50) + 5,
      updatedAt: new Date(),
    });

    console.log('[MERGE_ENGINE] Merged duplicate into:', existingMemoryId, 'confidence boost:', confidenceBoost);

    return {
      success: true,
      mergedMemoryId: existingMemoryId,
      sourceMemoryIds: [existingMemoryId],
      action: 'deduped',
      confidenceBoost,
    };
  }

  /**
   * Merge two distinct memories into a new canonical memory
   */
  async mergeMemories(
    memoryIdA: string,
    memoryIdB: string,
    userId: string
  ): Promise<MergeOperationResult> {
    const memoryA = await db.getMemoryById(memoryIdA);
    const memoryB = await db.getMemoryById(memoryIdB);

    if (!memoryA || !memoryB) {
      return {
        success: false,
        mergedMemoryId: '',
        sourceMemoryIds: [],
        action: 'merged',
        confidenceBoost: 0,
      };
    }

    // Use LLM to create merged canonical text
    const mergedText = await this.createMergedText(
      memoryA.canonicalText,
      memoryB.canonicalText
    );

    // Combined confidence (weighted average + boost)
    const combinedConfidence = Math.min(
      1,
      (memoryA.confidence + memoryB.confidence) / 2 + 0.1
    );

    // Combined importance
    const combinedImportance = Math.max(
      memoryA.importanceScore || 50,
      memoryB.importanceScore || 50
    ) + 10;

    // Merge provenance
    const mergedProvenance: Provenance[] = [
      ...memoryA.provenance,
      ...memoryB.provenance,
    ];

    // Merge tags
    const mergedTags = [...new Set([...memoryA.tags, ...memoryB.tags])];

    // Create new merged memory
    const mergedMemoryId = generateId();
    const now = new Date();

    const mergedMemory: Memory = {
      id: mergedMemoryId,
      userId,
      scope: memoryA.scope,
      category: memoryA.category,
      canonicalText: mergedText,
      type: memoryA.type,
      source: 'system',
      confidence: combinedConfidence,
      tags: mergedTags,
      timestamp: now,
      createdAt: now,
      updatedAt: now,
      version: 1,
      provenance: mergedProvenance,
      linkedMemories: [],
      conflictStatus: 'none',
      visibility: 'private',
      metadata: { ...memoryA.metadata, ...memoryB.metadata },
      
      // Lifecycle
      status: 'active',
      lastVerifiedAt: now,
      decayScore: 1.0,
      
      // Importance
      importanceScore: combinedImportance,
      recallCount: (memoryA.recallCount || 0) + (memoryB.recallCount || 0),
      usedInPromptCount: (memoryA.usedInPromptCount || 0) + (memoryB.usedInPromptCount || 0),
      userExplicitRemember: memoryA.userExplicitRemember || memoryB.userExplicitRemember,
      
      // Relationships
      mergedFromIds: [memoryIdA, memoryIdB],
      
      // Safety
      piiTags: [...new Set([...(memoryA.piiTags || []), ...(memoryB.piiTags || [])])],
      isEncrypted: memoryA.isEncrypted || memoryB.isEncrypted,
      isSensitive: memoryA.isSensitive || memoryB.isSensitive,
    };

    // Insert merged memory
    await db.insertMemory(mergedMemory);

    // Mark source memories as merged
    await db.updateMemory(memoryIdA, {
      status: 'merged',
      supersedesMemoryId: mergedMemoryId,
      updatedAt: now,
    });

    await db.updateMemory(memoryIdB, {
      status: 'merged',
      supersedesMemoryId: mergedMemoryId,
      updatedAt: now,
    });

    // Create relationships
    await db.createMemoryRelationship({
      id: generateId(),
      sourceMemoryId: mergedMemoryId,
      targetMemoryId: memoryIdA,
      relationshipType: 'supersedes',
      confidence: 1.0,
      reason: 'Merged from source memory',
      createdAt: now,
      updatedAt: now,
    });

    await db.createMemoryRelationship({
      id: generateId(),
      sourceMemoryId: mergedMemoryId,
      targetMemoryId: memoryIdB,
      relationshipType: 'supersedes',
      confidence: 1.0,
      reason: 'Merged from source memory',
      createdAt: now,
      updatedAt: now,
    });

    console.log('[MERGE_ENGINE] Created merged memory:', mergedMemoryId, 'from:', memoryIdA, memoryIdB);

    return {
      success: true,
      mergedMemoryId,
      sourceMemoryIds: [memoryIdA, memoryIdB],
      action: 'merged',
      confidenceBoost: 0.1,
    };
  }

  /**
   * Create merged canonical text using LLM
   */
  private async createMergedText(textA: string, textB: string): Promise<string> {
    try {
      const prompt = `Merge these two memory statements into ONE concise canonical statement:

MEMORY A: "${textA}"
MEMORY B: "${textB}"

Rules:
- Create ONE clear, factual sentence
- Preserve all unique information from both
- Use third-person ("User prefers...", "User has...")
- Maximum 30 words
- Remove redundancy

Output ONLY the merged statement, nothing else.`;

      const merged = await callLLM(prompt, undefined, { temperature: 0.3, maxTokens: 100 });
      return merged.trim();
    } catch (error) {
      console.error('[MERGE_ENGINE] Error creating merged text:', error);
      // Fallback: concatenate
      return `${textA}. ${textB}`;
    }
  }

  /**
   * Find merge candidates for a user's memories
   */
  async findMergeCandidates(userId: string): Promise<{
    pairs: { memoryA: Memory; memoryB: Memory; similarity: number }[];
    count: number;
  }> {
    // This would use vector similarity to find potential merges
    // For now, return empty - would be implemented with batch vector comparison
    return { pairs: [], count: 0 };
  }

  /**
   * Auto-merge highly similar memories
   */
  async autoMergeSimilar(userId: string, threshold = MERGE_SIMILARITY_THRESHOLD): Promise<{
    mergedCount: number;
    mergedMemoryIds: string[];
  }> {
    const candidates = await this.findMergeCandidates(userId);
    const mergedMemoryIds: string[] = [];

    for (const { memoryA, memoryB, similarity } of candidates.pairs) {
      if (similarity >= threshold) {
        const result = await this.mergeMemories(memoryA.id, memoryB.id, userId);
        if (result.success) {
          mergedMemoryIds.push(result.mergedMemoryId);
        }
      }
    }

    return {
      mergedCount: mergedMemoryIds.length,
      mergedMemoryIds,
    };
  }
}

export const mergeEngine = new MergeEngine();
export default mergeEngine;















