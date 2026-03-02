/**
 * Conflict Resolver Service
 * 
 * Detects and resolves conflicts between memories:
 * - Contradiction detection (e.g., "wakes at 6am" vs "wakes at 9am")
 * - Auto-resolution (prefer recent + high confidence)
 * - Conflict grouping for user clarification
 */

import { Memory, ConflictDetectionResult, MemoryRelationship } from '../../types';
import { db } from '../../db';
import { callLLMWithJSON } from '../../utils/llm';
import { generateId } from '../../utils/helpers';

class ConflictResolver {
  /**
   * Resolve a potential conflict between existing memory and new text
   */
  async resolve(
    existingMemoryId: string,
    newText: string,
    newConfidence: number
  ): Promise<ConflictDetectionResult> {
    const existingMemory = await db.getMemoryById(existingMemoryId);
    
    if (!existingMemory) {
      return {
        hasConflict: false,
        conflictingMemoryIds: [],
        conflictType: 'none',
        resolution: 'kept_both',
        reason: 'Existing memory not found',
      };
    }

    // Use LLM to analyze conflict
    const analysis = await this.analyzeConflict(existingMemory.canonicalText, newText);

    if (!analysis.isConflict) {
      return {
        hasConflict: false,
        conflictingMemoryIds: [],
        conflictType: 'none',
        resolution: 'kept_both',
        reason: analysis.reason,
      };
    }

    // Determine resolution strategy
    if (analysis.conflictType === 'update') {
      // This is an update, not a true conflict - auto-resolve
      return {
        hasConflict: true,
        conflictingMemoryIds: [existingMemoryId],
        conflictType: 'update',
        resolution: 'auto_resolved',
        reason: 'Detected as information update',
      };
    }

    if (analysis.conflictType === 'contradiction') {
      // True contradiction - decide based on recency and confidence
      const shouldPreferNew = this.shouldPreferNew(existingMemory, newConfidence);
      
      if (shouldPreferNew && analysis.autoResolvable) {
        // Mark old as superseded, create new
        await db.updateMemory(existingMemoryId, {
          status: 'outdated',
          conflictStatus: 'superseded',
          updatedAt: new Date(),
        });

        return {
          hasConflict: true,
          conflictingMemoryIds: [existingMemoryId],
          conflictType: 'contradiction',
          resolution: 'auto_resolved',
          reason: 'Preferred newer memory with higher/equal confidence',
        };
      }

      // Cannot auto-resolve, keep both and mark as conflicting
      return {
        hasConflict: true,
        conflictingMemoryIds: [existingMemoryId],
        conflictType: 'contradiction',
        resolution: 'needs_clarification',
        reason: 'Conflict requires user clarification',
      };
    }

    // Partial overlap - keep both
    return {
      hasConflict: true,
      conflictingMemoryIds: [existingMemoryId],
      conflictType: 'partial_overlap',
      resolution: 'kept_both',
      reason: 'Partial information overlap, both memories valid',
    };
  }

  /**
   * Analyze conflict using LLM
   */
  private async analyzeConflict(
    existingText: string,
    newText: string
  ): Promise<{
    isConflict: boolean;
    conflictType: 'contradiction' | 'update' | 'partial_overlap' | 'none';
    autoResolvable: boolean;
    reason: string;
  }> {
    try {
      const prompt = `Analyze if these two statements conflict:

EXISTING: "${existingText}"
NEW: "${newText}"

Conflict types:
- contradiction: Both claim to be currently true but cannot both be true (e.g., "lives in NYC" vs "lives in LA")
- update: New information replaces old (e.g., "works at Google" → "works at Amazon")
- partial_overlap: Some overlap but both can be true
- none: No conflict

Respond in JSON:
{
  "isConflict": true/false,
  "conflictType": "contradiction" | "update" | "partial_overlap" | "none",
  "autoResolvable": true/false,
  "reason": "brief explanation"
}`;

      return await callLLMWithJSON(prompt, undefined, { temperature: 0.1, maxTokens: 200 });
    } catch (error) {
      console.error('[CONFLICT_RESOLVER] Error analyzing conflict:', error);
      return {
        isConflict: false,
        conflictType: 'none',
        autoResolvable: false,
        reason: 'Analysis failed',
      };
    }
  }

  /**
   * Determine if new memory should be preferred over existing
   */
  private shouldPreferNew(existingMemory: Memory, newConfidence: number): boolean {
    // Prefer new if:
    // 1. New confidence >= existing confidence
    // 2. OR existing memory is old (> 30 days) and new has decent confidence (> 0.7)
    
    if (newConfidence >= existingMemory.confidence) {
      return true;
    }

    const existingAgeDays = (Date.now() - existingMemory.createdAt.getTime()) / (1000 * 60 * 60 * 24);
    if (existingAgeDays > 30 && newConfidence > 0.7) {
      return true;
    }

    return false;
  }

  /**
   * Get all memories in a conflict group
   */
  async getConflictGroup(conflictGroupId: string): Promise<Memory[]> {
    return db.getMemoriesByConflictGroup(conflictGroupId);
  }

  /**
   * Resolve a conflict group by choosing a winner
   */
  async resolveConflictGroup(
    conflictGroupId: string,
    winnerId: string
  ): Promise<void> {
    const memories = await this.getConflictGroup(conflictGroupId);
    
    for (const memory of memories) {
      if (memory.id === winnerId) {
        // Winner stays active
        await db.updateMemory(memory.id, {
          conflictStatus: 'resolved',
          confidence: Math.min(1, memory.confidence + 0.1),
          updatedAt: new Date(),
        });
      } else {
        // Losers become superseded
        await db.updateMemory(memory.id, {
          status: 'outdated',
          conflictStatus: 'superseded',
          supersedesMemoryId: winnerId,
          updatedAt: new Date(),
        });

        // Create relationship
        await db.createMemoryRelationship({
          id: generateId(),
          sourceMemoryId: winnerId,
          targetMemoryId: memory.id,
          relationshipType: 'supersedes',
          confidence: 1.0,
          reason: 'User resolved conflict',
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }
    }

    console.log('[CONFLICT_RESOLVER] Resolved conflict group:', conflictGroupId, 'winner:', winnerId);
  }

  /**
   * Detect conflicts for a user's memories
   */
  async detectConflictsForUser(userId: string): Promise<{
    conflictGroups: { groupId: string; memories: Memory[] }[];
    count: number;
  }> {
    const memories = await db.getMemoriesByStatus(userId, ['active'], 1000);
    const conflicts: Map<string, Memory[]> = new Map();

    for (const memory of memories) {
      if (memory.conflictGroupId) {
        if (!conflicts.has(memory.conflictGroupId)) {
          conflicts.set(memory.conflictGroupId, []);
        }
        conflicts.get(memory.conflictGroupId)!.push(memory);
      }
    }

    const conflictGroups = Array.from(conflicts.entries())
      .filter(([_, mems]) => mems.length > 1)
      .map(([groupId, mems]) => ({ groupId, memories: mems }));

    return {
      conflictGroups,
      count: conflictGroups.length,
    };
  }
}

export const conflictResolver = new ConflictResolver();
export default conflictResolver;















