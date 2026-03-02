import { Memory, ConflictResolution, MergeResult } from '../../types';
import { callLLMWithJSON } from '../../utils/llm';
import { getConflictResolutionPrompt } from '../extractor/prompts';
import { calculateTextSimilarity, generateId } from '../../utils/helpers';
import { db } from '../../db';

interface ConflictResolutionResponse {
  action: 'overwrite' | 'merge' | 'mark_conflict' | 'keep_both';
  reason: string;
  merged_text?: string;
  confidence: number;
}

/**
 * Memory Update Engine
 * Handles merging, versioning, conflict resolution, and deduplication
 */
export class MemoryUpdater {
  /**
   * Merge two memories that describe the same or related information
   */
  async mergeMemory(oldMemory: Memory, newMemory: Memory): Promise<MergeResult> {
    try {
      // Calculate similarity
      const similarity = calculateTextSimilarity(
        oldMemory.canonicalText,
        newMemory.canonicalText
      );
      
      // If very different, they might not actually need merging
      if (similarity < 0.3) {
        return {
          mergedMemory: newMemory,
          action: 'merged',
        };
      }
      
      // If nearly identical, just update timestamp
      if (similarity > 0.95) {
        const updated: Memory = {
          ...oldMemory,
          updatedAt: new Date(),
          provenance: [
            ...oldMemory.provenance,
            ...newMemory.provenance,
          ],
        };
        
        await db.updateMemory(updated);
        
        return {
          mergedMemory: updated,
          action: 'merged',
          previousVersion: oldMemory,
        };
      }
      
      // For moderate similarity, use LLM to resolve
      const resolution = await this.resolveConflict(oldMemory, newMemory);
      
      return await this.applyResolution(oldMemory, newMemory, resolution);
    } catch (error) {
      console.error('Error merging memories:', error);
      // Default: keep new memory
      return {
        mergedMemory: newMemory,
        action: 'merged',
      };
    }
  }
  
  /**
   * Resolve conflicts between two memories using LLM
   */
  async resolveConflict(
    oldMemory: Memory,
    newMemory: Memory
  ): Promise<ConflictResolution> {
    try {
      const prompt = getConflictResolutionPrompt(
        this.formatMemoryForLLM(oldMemory),
        this.formatMemoryForLLM(newMemory)
      );
      
      const response = await callLLMWithJSON<ConflictResolutionResponse>(
        prompt,
        undefined,
        { temperature: 0.3, maxTokens: 500 }
      );
      
      return {
        action: response.action,
        reason: response.reason,
        confidence: response.confidence,
      };
    } catch (error) {
      console.error('Error resolving conflict with LLM:', error);
      
      // Fallback: use simple heuristics
      return this.fallbackConflictResolution(oldMemory, newMemory);
    }
  }
  
  /**
   * Apply conflict resolution decision
   */
  private async applyResolution(
    oldMemory: Memory,
    newMemory: Memory,
    resolution: ConflictResolution
  ): Promise<MergeResult> {
    switch (resolution.action) {
      case 'overwrite':
        return await this.overwriteMemory(oldMemory, newMemory);
      
      case 'merge':
        return await this.combineMemories(oldMemory, newMemory);
      
      case 'mark_conflict':
        return await this.markAsConflict(oldMemory, newMemory);
      
      case 'keep_both':
        return await this.keepBoth(oldMemory, newMemory);
      
      default:
        return await this.overwriteMemory(oldMemory, newMemory);
    }
  }
  
  /**
   * Overwrite old memory with new one, preserving version history
   */
  private async overwriteMemory(
    oldMemory: Memory,
    newMemory: Memory
  ): Promise<MergeResult> {
    const updated: Memory = {
      ...oldMemory,
      canonicalText: newMemory.canonicalText,
      type: newMemory.type,
      confidence: Math.max(oldMemory.confidence, newMemory.confidence),
      tags: [...new Set([...oldMemory.tags, ...newMemory.tags])],
      timestamp: newMemory.timestamp,
      updatedAt: new Date(),
      version: oldMemory.version + 1,
      provenance: [
        ...oldMemory.provenance,
        ...newMemory.provenance,
      ],
      metadata: {
        ...oldMemory.metadata,
        ...newMemory.metadata,
        previous_version: oldMemory.canonicalText,
      },
    };
    
    await db.updateMemory(updated);
    
    return {
      mergedMemory: updated,
      action: 'overwritten',
      previousVersion: oldMemory,
    };
  }
  
  /**
   * Combine information from both memories
   */
  private async combineMemories(
    oldMemory: Memory,
    newMemory: Memory
  ): Promise<MergeResult> {
    // Attempt to intelligently merge the texts
    const mergedText = await this.generateMergedText(
      oldMemory.canonicalText,
      newMemory.canonicalText
    );
    
    const merged: Memory = {
      ...oldMemory,
      canonicalText: mergedText,
      confidence: (oldMemory.confidence + newMemory.confidence) / 2,
      tags: [...new Set([...oldMemory.tags, ...newMemory.tags])],
      updatedAt: new Date(),
      version: oldMemory.version + 1,
      provenance: [
        ...oldMemory.provenance,
        ...newMemory.provenance,
      ],
      linkedMemories: [
        ...oldMemory.linkedMemories,
        newMemory.id,
      ],
    };
    
    await db.updateMemory(merged);
    
    return {
      mergedMemory: merged,
      action: 'merged',
      previousVersion: oldMemory,
    };
  }
  
  /**
   * Mark memories as conflicting
   */
  private async markAsConflict(
    oldMemory: Memory,
    newMemory: Memory
  ): Promise<MergeResult> {
    const updated: Memory = {
      ...oldMemory,
      conflictStatus: 'conflict',
      linkedMemories: [
        ...oldMemory.linkedMemories,
        newMemory.id,
      ],
      metadata: {
        ...oldMemory.metadata,
        conflicting_memory_id: newMemory.id,
        conflict_detected_at: new Date().toISOString(),
      },
    };
    
    await db.updateMemory(updated);
    
    return {
      mergedMemory: updated,
      action: 'conflict_marked',
      previousVersion: oldMemory,
    };
  }
  
  /**
   * Keep both memories as separate entities
   */
  private async keepBoth(
    oldMemory: Memory,
    newMemory: Memory
  ): Promise<MergeResult> {
    // Link them together
    const updated: Memory = {
      ...oldMemory,
      linkedMemories: [
        ...oldMemory.linkedMemories,
        newMemory.id,
      ],
    };
    
    await db.updateMemory(updated);
    
    return {
      mergedMemory: newMemory,
      action: 'merged',
    };
  }
  
  /**
   * Update version of a memory
   */
  async updateVersion(memory: Memory): Promise<Memory> {
    const updated: Memory = {
      ...memory,
      version: memory.version + 1,
      updatedAt: new Date(),
      metadata: {
        ...memory.metadata,
        version_history: [
          ...(memory.metadata.version_history || []),
          {
            version: memory.version,
            text: memory.canonicalText,
            timestamp: memory.updatedAt.toISOString(),
          },
        ],
      },
    };
    
    return await db.updateMemory(updated);
  }
  
  /**
   * Check if two memories are duplicates
   */
  isDuplicate(memory1: Memory, memory2: Memory): boolean {
    const similarity = calculateTextSimilarity(
      memory1.canonicalText,
      memory2.canonicalText
    );
    
    return similarity > 0.95;
  }
  
  /**
   * Find potential duplicates for a memory
   */
  async findDuplicates(
    memory: Memory,
    userId: string
  ): Promise<Memory[]> {
    const similar = await db.findSimilarMemories(
      userId,
      memory.canonicalText,
      0.85
    );
    
    return similar.filter(m => 
      m.id !== memory.id &&
      this.isDuplicate(m, memory)
    );
  }
  
  /**
   * Generate merged text from two memory texts using LLM
   */
  private async generateMergedText(text1: string, text2: string): Promise<string> {
    try {
      const prompt = `Merge these two related memory statements into a single, coherent statement that preserves all important information:

Memory 1: "${text1}"
Memory 2: "${text2}"

Provide only the merged statement, nothing else.`;
      
      const merged = await callLLMWithJSON<{ merged: string }>(
        prompt,
        undefined,
        { temperature: 0.3, maxTokens: 300 }
      );
      
      return merged.merged || text2;
    } catch (error) {
      // Fallback: simple concatenation
      return `${text1} ${text2}`;
    }
  }
  
  /**
   * Fallback conflict resolution using simple heuristics
   */
  private fallbackConflictResolution(
    oldMemory: Memory,
    newMemory: Memory
  ): ConflictResolution {
    // Prefer newer, higher-confidence memories
    if (newMemory.confidence > oldMemory.confidence + 0.2) {
      return {
        action: 'overwrite',
        reason: 'New memory has significantly higher confidence',
        confidence: 0.8,
      };
    }
    
    // If types are different, keep both
    if (oldMemory.type !== newMemory.type) {
      return {
        action: 'keep_both',
        reason: 'Different memory types',
        confidence: 0.7,
      };
    }
    
    // Default: merge
    return {
      action: 'merge',
      reason: 'Similar memories with moderate confidence',
      confidence: 0.6,
    };
  }
  
  /**
   * Format memory for LLM prompt
   */
  private formatMemoryForLLM(memory: Memory): string {
    return `[${memory.type}] "${memory.canonicalText}" (confidence: ${memory.confidence}, timestamp: ${memory.timestamp.toISOString()})`;
  }
}

// Export singleton instance
export const memoryUpdater = new MemoryUpdater();























