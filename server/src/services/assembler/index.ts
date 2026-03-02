import { Memory, ContextBlock, RetrievalResult, MemoryType, TokenBudgetOptions } from '../../types';
import { estimateTokenCount, truncateToTokenBudget } from '../../utils/helpers';
import { db } from '../../db';

// Default priority order: identity facts > preferences > decisions > goals > context
const DEFAULT_PRIORITY_ORDER: MemoryType[] = [
  'fact',        // Identity facts are critical
  'preference',  // User preferences shape behavior
  'decision',    // Past decisions are commitments
  'goal',        // Goals guide actions
  'constraint',  // Constraints limit actions
  'context',     // Context is ephemeral
  'history',     // History is background
  'derived',     // Derived are inferred
];

// Similarity threshold for deduplication
const DEDUP_SIMILARITY_THRESHOLD = 0.85;

/**
 * Context Assembler Service (v2.0)
 * 
 * Builds optimized memory context blocks for LLM prompts with:
 * - Token budget optimization
 * - Priority-based memory selection
 * - Semantic deduplication
 * - Usage tracking for importance scoring
 */
export class ContextAssembler {
  /**
   * Assemble a context block from memories with intelligent optimization
   */
  assembleContextBlock(
    memories: RetrievalResult[],
    tokenBudget: number = 2000,
    options?: Partial<TokenBudgetOptions>
  ): ContextBlock {
    const opts: TokenBudgetOptions = {
      maxTokens: tokenBudget,
      priorityOrder: options?.priorityOrder || DEFAULT_PRIORITY_ORDER,
      deduplicateSimilar: options?.deduplicateSimilar ?? true,
      minConfidence: options?.minConfidence ?? 0.3,
      includeMetadata: options?.includeMetadata ?? false,
    };

    // Filter by minimum confidence
    let filteredMemories = memories.filter(m => m.memory.confidence >= opts.minConfidence);

    // Deduplicate similar memories
    if (opts.deduplicateSimilar) {
      filteredMemories = this.deduplicateMemories(filteredMemories);
    }

    // Group memories by type for better organization
    const grouped = this.groupMemoriesByType(filteredMemories);
    
    // Compress groups with priority ordering
    const compressed = this.compressMemoryGroupsWithPriority(grouped, opts.maxTokens, opts.priorityOrder);
    
    // Build the final context text
    const contextText = this.buildContextText(compressed, opts.includeMetadata);
    
    // Ensure we're within token budget
    const finalText = truncateToTokenBudget(contextText, opts.maxTokens);
    const tokenCount = estimateTokenCount(finalText);

    // Get all included memory IDs
    const includedMemories: Memory[] = [];
    for (const mems of compressed.values()) {
      includedMemories.push(...mems.map(r => r.memory));
    }
    
    return {
      memories: includedMemories,
      memoryIds: includedMemories.map(m => m.id),
      contextText: finalText,
      tokenCount,
      timestamp: new Date(),
    };
  }

  /**
   * Deduplicate semantically similar memories
   * Keeps the one with highest score
   */
  private deduplicateMemories(memories: RetrievalResult[]): RetrievalResult[] {
    if (memories.length <= 1) return memories;

    const deduplicated: RetrievalResult[] = [];
    const seen = new Set<string>();

    // Sort by score descending to keep best ones
    const sorted = [...memories].sort((a, b) => b.score - a.score);

    for (const memory of sorted) {
      const text = memory.memory.canonicalText.toLowerCase().trim();
      
      // Check if we've seen a very similar memory
      let isDuplicate = false;
      
      for (const existingText of seen) {
        const similarity = this.quickTextSimilarity(text, existingText);
        if (similarity > DEDUP_SIMILARITY_THRESHOLD) {
          isDuplicate = true;
          break;
        }
      }

      if (!isDuplicate) {
        deduplicated.push(memory);
        seen.add(text);
      }
    }

    return deduplicated;
  }

  /**
   * Quick text similarity using Jaccard index on words
   * (Fast approximation without embeddings)
   */
  private quickTextSimilarity(text1: string, text2: string): number {
    const words1 = new Set(text1.split(/\s+/).filter(w => w.length > 2));
    const words2 = new Set(text2.split(/\s+/).filter(w => w.length > 2));

    if (words1.size === 0 || words2.size === 0) return 0;

    let intersection = 0;
    for (const word of words1) {
      if (words2.has(word)) intersection++;
    }

    const union = words1.size + words2.size - intersection;
    return intersection / union;
  }
  
  /**
   * Group memories by type
   */
  private groupMemoriesByType(
    memories: RetrievalResult[]
  ): Map<string, RetrievalResult[]> {
    const groups = new Map<string, RetrievalResult[]>();
    
    for (const memory of memories) {
      const type = memory.memory.type;
      
      if (!groups.has(type)) {
        groups.set(type, []);
      }
      
      groups.get(type)!.push(memory);
    }
    
    return groups;
  }
  
  /**
   * Compress memory groups to fit token budget (legacy method)
   */
  compressMemoryGroups(
    groups: Map<string, RetrievalResult[]>,
    tokenBudget: number
  ): Map<string, RetrievalResult[]> {
    return this.compressMemoryGroupsWithPriority(groups, tokenBudget, DEFAULT_PRIORITY_ORDER);
  }

  /**
   * Compress memory groups with configurable priority ordering
   * Prioritizes: identity facts > preferences > decisions > goals > context
   */
  private compressMemoryGroupsWithPriority(
    groups: Map<string, RetrievalResult[]>,
    tokenBudget: number,
    priorityOrder: MemoryType[]
  ): Map<string, RetrievalResult[]> {
    // Estimate tokens per group
    const groupTokens = new Map<string, number>();
    let totalTokens = 0;
    
    for (const [type, memories] of groups) {
      const tokens = memories.reduce(
        (sum, m) => sum + estimateTokenCount(m.memory.canonicalText),
        0
      );
      groupTokens.set(type, tokens);
      totalTokens += tokens;
    }
    
    // If within budget, return as is
    if (totalTokens <= tokenBudget) {
      return groups;
    }
    
    // Need to compress - use priority ordering
    const compressed = new Map<string, RetrievalResult[]>();
    let remainingBudget = tokenBudget;
    
    // Reserve minimum space for each priority type
    const minReserve = Math.min(100, tokenBudget / priorityOrder.length);
    
    for (const type of priorityOrder) {
      if (!groups.has(type)) continue;
      if (remainingBudget <= 50) break;
      
      const memories = groups.get(type)!;
      const selected: RetrievalResult[] = [];
      
      // Sort by combined score (similarity + importance + confidence)
      const sorted = [...memories].sort((a, b) => {
        const scoreA = a.score + (a.memory.importanceScore || 50) / 100 + a.memory.confidence;
        const scoreB = b.score + (b.memory.importanceScore || 50) / 100 + b.memory.confidence;
        return scoreB - scoreA;
      });
      
      for (const memory of sorted) {
        const tokens = estimateTokenCount(memory.memory.canonicalText);
        
        if (tokens <= remainingBudget) {
          selected.push(memory);
          remainingBudget -= tokens;
        }
        
        if (remainingBudget <= minReserve && selected.length > 0) break;
      }
      
      if (selected.length > 0) {
        compressed.set(type, selected);
      }
    }
    
    // Add any remaining types not in priority order
    for (const [type, memories] of groups) {
      if (compressed.has(type)) continue;
      if (remainingBudget <= 50) break;
      
      const selected: RetrievalResult[] = [];
      
      for (const memory of memories) {
        const tokens = estimateTokenCount(memory.memory.canonicalText);
        
        if (tokens <= remainingBudget) {
          selected.push(memory);
          remainingBudget -= tokens;
        }
        
        if (remainingBudget <= 50) break;
      }
      
      if (selected.length > 0) {
        compressed.set(type, selected);
      }
    }
    
    return compressed;
  }
  
  /**
   * Build context text from compressed groups
   */
  private buildContextText(groups: Map<string, RetrievalResult[]>, includeMetadata = false): string {
    const sections: string[] = [];
    
    sections.push('### USER MEMORY CONTEXT START');
    sections.push('');
    sections.push('The following information has been retrieved from the user\'s long-term memory:');
    sections.push('');
    
    // Type labels for better readability (v2.0: expanded)
    const typeLabels: Record<string, string> = {
      fact: 'Known Facts',
      preference: 'User Preferences',
      decision: 'Past Decisions',
      goal: 'Goals & Aspirations',
      constraint: 'Constraints',
      context: 'Current Context',
      history: 'History',
      derived: 'Inferred Information',
      task: 'Tasks & To-Dos',
      event: 'Events & Appointments',
      episodic: 'Past Experiences',
      pattern: 'Behavioral Patterns',
      entity: 'Known Entities',
    };
    
    for (const [type, memories] of groups) {
      if (memories.length === 0) continue;
      
      sections.push(`**${typeLabels[type] || type.toUpperCase()}:**`);
      
      for (const result of memories) {
        const memory = result.memory;
        
        if (includeMetadata) {
          const timestamp = memory.timestamp.toLocaleDateString();
          const confidence = Math.round(memory.confidence * 100);
          sections.push(`- ${memory.canonicalText} (recorded: ${timestamp}, confidence: ${confidence}%)`);
        } else {
          sections.push(`- ${memory.canonicalText}`);
        }
      }
      
      sections.push('');
    }
    
    sections.push('### END MEMORY CONTEXT');
    sections.push('');
    
    return sections.join('\n');
  }
  
  /**
   * Build a simple context block (no grouping)
   */
  buildSimpleContext(memories: Memory[], tokenBudget: number = 2000): string {
    const lines: string[] = [];
    let currentTokens = 0;
    
    lines.push('=== Relevant Memories ===');
    
    for (const memory of memories) {
      const line = `[${memory.type}] ${memory.canonicalText}`;
      const tokens = estimateTokenCount(line);
      
      if (currentTokens + tokens > tokenBudget) {
        break;
      }
      
      lines.push(line);
      currentTokens += tokens;
    }
    
    lines.push('=== End Memories ===');
    
    return lines.join('\n');
  }
  
  /**
   * Assemble prompt with memory context
   */
  assemblePromptWithMemory(
    agentInstructions: string,
    userInput: string,
    contextBlock: ContextBlock
  ): string {
    const parts: string[] = [];
    
    // Add agent instructions
    parts.push(agentInstructions);
    parts.push('');
    
    // Add memory context
    parts.push(contextBlock.contextText);
    
    // Add user input
    parts.push('**Current User Input:**');
    parts.push(userInput);
    
    return parts.join('\n');
  }
  
  /**
   * Generate memory summary for display
   */
  generateMemorySummary(memories: Memory[]): string {
    if (memories.length === 0) {
      return 'No memories available.';
    }
    
    const byType = new Map<string, number>();
    
    for (const memory of memories) {
      byType.set(memory.type, (byType.get(memory.type) || 0) + 1);
    }
    
    const summary = Array.from(byType.entries())
      .map(([type, count]) => `${count} ${type}${count > 1 ? 's' : ''}`)
      .join(', ');
    
    return `Retrieved ${memories.length} memories: ${summary}`;
  }
}

// Export singleton instance
export const contextAssembler = new ContextAssembler();























