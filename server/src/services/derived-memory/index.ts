/**
 * Derived Memory Generator Service
 * 
 * Creates inferred memories from existing memories:
 * - Detects patterns across memories
 * - Generates higher-level abstractions
 * - Links derived memories to source memories
 * 
 * Example:
 * - Source: "User works at Google", "User is a software engineer"
 * - Derived: "User is a tech professional"
 */

import { Memory, DerivedMemorySuggestion, MemoryScope } from '../../types';
import { db } from '../../db';
import { callLLMWithJSON, generateEmbedding } from '../../utils/llm';
import { generateId } from '../../utils/helpers';
import { memoryManager } from '../memory-manager';

// Minimum memories needed to generate derived insights
const MIN_MEMORIES_FOR_DERIVATION = 3;

// Maximum derived memories to generate per run
const MAX_DERIVED_PER_RUN = 5;

// Confidence discount for derived memories
const DERIVED_CONFIDENCE_FACTOR = 0.7;

class DerivedMemoryGenerator {
  /**
   * Generate derived memories from existing memories
   */
  async generateDerivedMemories(
    userId: string,
    scope?: MemoryScope
  ): Promise<DerivedMemorySuggestion[]> {
    console.log('[DERIVED] Generating derived memories for user:', userId);

    // Get active memories
    const memories = await db.getMemoriesByStatus(userId, ['active'], 100);
    
    if (memories.length < MIN_MEMORIES_FOR_DERIVATION) {
      console.log('[DERIVED] Not enough memories for derivation:', memories.length);
      return [];
    }

    // Filter by scope if provided
    const scopedMemories = scope 
      ? memories.filter(m => m.scope.type === scope.type && m.scope.id === scope.id)
      : memories;

    if (scopedMemories.length < MIN_MEMORIES_FOR_DERIVATION) {
      return [];
    }

    // Group by category for pattern detection
    const byCategory = this.groupByCategory(scopedMemories);

    // Generate derivations from each category
    const suggestions: DerivedMemorySuggestion[] = [];

    for (const [category, categoryMemories] of byCategory) {
      if (categoryMemories.length >= 2) {
        const derived = await this.deriveFromCategory(category, categoryMemories);
        suggestions.push(...derived);
      }
    }

    // Also try cross-category derivation
    const crossDerived = await this.deriveCrossCategory(scopedMemories);
    suggestions.push(...crossDerived);

    // Limit results
    return suggestions.slice(0, MAX_DERIVED_PER_RUN);
  }

  /**
   * Group memories by category
   */
  private groupByCategory(memories: Memory[]): Map<string, Memory[]> {
    const groups = new Map<string, Memory[]>();
    
    for (const memory of memories) {
      const category = memory.category || memory.type;
      if (!groups.has(category)) {
        groups.set(category, []);
      }
      groups.get(category)!.push(memory);
    }

    return groups;
  }

  /**
   * Derive memories from a single category
   */
  private async deriveFromCategory(
    category: string,
    memories: Memory[]
  ): Promise<DerivedMemorySuggestion[]> {
    if (memories.length < 2) return [];

    try {
      const memoryTexts = memories
        .slice(0, 10) // Limit to prevent token overflow
        .map((m, i) => `${i + 1}. ${m.canonicalText}`)
        .join('\n');

      const prompt = `Analyze these ${category} memories and identify any higher-level patterns or insights that can be derived:

MEMORIES:
${memoryTexts}

Generate 1-2 derived insights that combine or abstract from these memories.
Each insight should be something not explicitly stated but logically inferred.

Respond in JSON array format:
[
  {
    "inferredText": "The derived insight in third person (e.g., 'User is a...')",
    "sourceIndices": [1, 2],  // Which memories this is derived from (1-indexed)
    "confidence": 0.7,
    "reasoning": "Brief explanation of the inference"
  }
]

If no valid derivations can be made, return an empty array: []`;

      const results = await callLLMWithJSON<{
        inferredText: string;
        sourceIndices: number[];
        confidence: number;
        reasoning: string;
      }[]>(prompt, undefined, { temperature: 0.3, maxTokens: 500 });

      if (!Array.isArray(results)) return [];

      return results.map(r => ({
        inferredText: r.inferredText,
        sourceMemoryIds: r.sourceIndices
          .filter(i => i > 0 && i <= memories.length)
          .map(i => memories[i - 1].id),
        confidence: r.confidence * DERIVED_CONFIDENCE_FACTOR,
        category: 'derived' as any,
        reasoning: r.reasoning,
      }));
    } catch (error) {
      console.error('[DERIVED] Error deriving from category:', error);
      return [];
    }
  }

  /**
   * Derive cross-category insights
   */
  private async deriveCrossCategory(
    memories: Memory[]
  ): Promise<DerivedMemorySuggestion[]> {
    if (memories.length < 3) return [];

    try {
      const memoryTexts = memories
        .slice(0, 15)
        .map((m, i) => `${i + 1}. [${m.category}] ${m.canonicalText}`)
        .join('\n');

      const prompt = `Analyze these memories across different categories and identify patterns or persona insights:

MEMORIES:
${memoryTexts}

Generate 1-2 high-level insights about the user that combine information from multiple categories.
Focus on:
- Professional identity
- Personal characteristics
- Lifestyle patterns
- Goals/aspirations summary

Respond in JSON array format:
[
  {
    "inferredText": "High-level insight in third person",
    "sourceIndices": [1, 3, 5],
    "confidence": 0.65,
    "reasoning": "How this was inferred"
  }
]

If no valid cross-category insights, return: []`;

      const results = await callLLMWithJSON<{
        inferredText: string;
        sourceIndices: number[];
        confidence: number;
        reasoning: string;
      }[]>(prompt, undefined, { temperature: 0.3, maxTokens: 500 });

      if (!Array.isArray(results)) return [];

      return results.map(r => ({
        inferredText: r.inferredText,
        sourceMemoryIds: r.sourceIndices
          .filter(i => i > 0 && i <= memories.length)
          .map(i => memories[i - 1].id),
        confidence: r.confidence * DERIVED_CONFIDENCE_FACTOR,
        category: 'derived' as any,
        reasoning: r.reasoning,
      }));
    } catch (error) {
      console.error('[DERIVED] Error deriving cross-category:', error);
      return [];
    }
  }

  /**
   * Store a derived memory suggestion
   */
  async storeDerivedMemory(
    userId: string,
    suggestion: DerivedMemorySuggestion,
    scope: MemoryScope
  ): Promise<Memory | null> {
    try {
      // Check if similar derived memory already exists
      const existing = await db.findSimilarMemories(userId, suggestion.inferredText);
      if (existing.length > 0) {
        console.log('[DERIVED] Similar memory already exists, skipping');
        return null;
      }

      const result = await memoryManager.storeMemory(userId, suggestion.inferredText, {
        scope,
        category: 'derived',
        source: 'derived',
        confidence: suggestion.confidence,
        tags: ['derived', 'inferred'],
        metadata: {
          reasoning: suggestion.reasoning,
          derivedFromIds: suggestion.sourceMemoryIds,
        },
      });

      // Link to source memories
      for (const sourceId of suggestion.sourceMemoryIds) {
        await db.createMemoryRelationship({
          id: generateId(),
          sourceMemoryId: result.memory.id,
          targetMemoryId: sourceId,
          relationshipType: 'depends_on',
          confidence: suggestion.confidence,
          reason: 'Derived from source memory',
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }

      console.log('[DERIVED] Stored derived memory:', result.memory.id);
      return result.memory;
    } catch (error) {
      console.error('[DERIVED] Error storing derived memory:', error);
      return null;
    }
  }

  /**
   * Run full derivation cycle for a user
   */
  async runDerivationCycle(userId: string): Promise<{
    suggestions: DerivedMemorySuggestion[];
    stored: number;
  }> {
    const suggestions = await this.generateDerivedMemories(userId);
    let stored = 0;

    // Auto-store high-confidence derived memories
    for (const suggestion of suggestions) {
      if (suggestion.confidence >= 0.6) {
        const sourceMemory = await db.getMemoryById(suggestion.sourceMemoryIds[0]);
        if (sourceMemory) {
          const result = await this.storeDerivedMemory(userId, suggestion, sourceMemory.scope);
          if (result) stored++;
        }
      }
    }

    return { suggestions, stored };
  }
}

export const derivedMemoryGenerator = new DerivedMemoryGenerator();
export default derivedMemoryGenerator;















