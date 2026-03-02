/**
 * Importance Scorer Service
 * 
 * Computes and manages importance scores for memories based on:
 * - Usage frequency (recall count)
 * - Recency (last accessed)
 * - User explicit signals ("remember this")
 * - Entity priority (identity, preferences, goals)
 * - Type weight (identity > preferences > facts)
 * - Confidence level
 */

import { Memory, MemoryType, MemorySource, PIIType, ImportanceFactors } from '../../types';

// Type priority weights (higher = more important)
const TYPE_WEIGHTS: Record<MemoryType, number> = {
  fact: 0.9,          // Identity facts are critical
  preference: 0.85,   // Preferences shape behavior
  goal: 0.8,          // Goals guide actions
  decision: 0.75,     // Decisions are commitments
  constraint: 0.7,    // Constraints limit actions
  context: 0.5,       // Context is ephemeral
  history: 0.3,       // History is background
  derived: 0.4,       // Derived are inferred
};

// Source weights
const SOURCE_WEIGHTS: Record<MemorySource, number> = {
  user: 1.0,          // User-provided is most reliable
  environment: 0.8,   // Environment signals are reliable
  system: 0.7,        // System-generated
  ai: 0.5,            // AI-generated (less reliable)
  derived: 0.6,       // Derived from other memories
};

// High-priority tags
const PRIORITY_TAGS = new Set([
  'identity', 'name', 'profile', 'self', 'personal',
  'critical', 'important', 'remember', 'key', 'core',
  'long-term', 'permanent', 'persistent',
]);

// Default importance factors
const DEFAULT_FACTORS: ImportanceFactors = {
  usageWeight: 0.25,
  recencyWeight: 0.20,
  userExplicitSignal: 0.20,
  entityPriorityBoost: 0.15,
  typeWeight: 0.10,
  confidenceWeight: 0.10,
};

class ImportanceScorer {
  private factors: ImportanceFactors;

  constructor(factors: ImportanceFactors = DEFAULT_FACTORS) {
    this.factors = factors;
  }

  /**
   * Compute importance score for an existing memory
   * Returns a value from 0-100
   */
  compute(memory: Memory): number {
    let score = 0;

    // 1. Usage weight (based on recall count)
    const usageScore = this.computeUsageScore(memory.recallCount || 0, memory.usedInPromptCount || 0);
    score += usageScore * this.factors.usageWeight;

    // 2. Recency weight (based on last recall)
    const recencyScore = this.computeRecencyScore(memory.lastRecalledAt, memory.createdAt);
    score += recencyScore * this.factors.recencyWeight;

    // 3. User explicit signal
    if (memory.userExplicitRemember) {
      score += 100 * this.factors.userExplicitSignal;
    }

    // 4. Entity priority boost (based on tags)
    const entityBoost = this.computeEntityPriorityBoost(memory.tags);
    score += entityBoost * this.factors.entityPriorityBoost;

    // 5. Type weight
    const typeScore = (TYPE_WEIGHTS[memory.category] || 0.5) * 100;
    score += typeScore * this.factors.typeWeight;

    // 6. Confidence weight
    const confidenceScore = (memory.confidence || 0.5) * 100;
    score += confidenceScore * this.factors.confidenceWeight;

    // Apply decay score modifier
    score *= (memory.decayScore || 1.0);

    // Clamp to 0-100
    return Math.max(0, Math.min(100, Math.round(score)));
  }

  /**
   * Compute initial importance for a new memory
   */
  computeInitial(params: {
    category: MemoryType;
    confidence: number;
    userExplicitRemember: boolean;
    source: MemorySource;
    piiTags?: PIIType[];
    tags?: string[];
  }): number {
    let score = 50; // Base score

    // Type weight
    score += (TYPE_WEIGHTS[params.category] || 0.5) * 20;

    // Source weight
    score += (SOURCE_WEIGHTS[params.source] || 0.5) * 10;

    // Confidence
    score += params.confidence * 10;

    // User explicit
    if (params.userExplicitRemember) {
      score += 20;
    }

    // PII boost (identity info is important)
    if (params.piiTags && params.piiTags.length > 0) {
      score += 10;
    }

    // Tag boost
    if (params.tags) {
      const boost = this.computeEntityPriorityBoost(params.tags) * 0.1;
      score += boost;
    }

    return Math.max(0, Math.min(100, Math.round(score)));
  }

  /**
   * Compute usage score based on recall and prompt usage counts
   */
  private computeUsageScore(recallCount: number, promptUsageCount: number): number {
    // Logarithmic scaling to prevent runaway scores
    const recallScore = Math.log10(recallCount + 1) * 30;
    const promptScore = Math.log10(promptUsageCount + 1) * 20;
    return Math.min(100, recallScore + promptScore);
  }

  /**
   * Compute recency score based on last access time
   */
  private computeRecencyScore(lastRecalledAt?: Date, createdAt?: Date): number {
    const referenceDate = lastRecalledAt || createdAt || new Date();
    const daysSinceAccess = (Date.now() - referenceDate.getTime()) / (1000 * 60 * 60 * 24);

    // Exponential decay - recent is better
    if (daysSinceAccess < 1) return 100;
    if (daysSinceAccess < 7) return 90;
    if (daysSinceAccess < 30) return 70;
    if (daysSinceAccess < 90) return 50;
    if (daysSinceAccess < 180) return 30;
    if (daysSinceAccess < 365) return 15;
    return 5;
  }

  /**
   * Compute entity priority boost based on tags
   */
  private computeEntityPriorityBoost(tags: string[]): number {
    let boost = 0;
    for (const tag of tags) {
      if (PRIORITY_TAGS.has(tag.toLowerCase())) {
        boost += 20;
      }
    }
    return Math.min(100, boost);
  }

  /**
   * Update factors dynamically
   */
  setFactors(factors: Partial<ImportanceFactors>): void {
    this.factors = { ...this.factors, ...factors };
  }

  /**
   * Get current factors
   */
  getFactors(): ImportanceFactors {
    return { ...this.factors };
  }

  /**
   * Batch recompute importance for multiple memories
   */
  batchRecompute(memories: Memory[]): { memoryId: string; newScore: number }[] {
    return memories.map(memory => ({
      memoryId: memory.id,
      newScore: this.compute(memory),
    }));
  }
}

export const importanceScorer = new ImportanceScorer();
export default importanceScorer;















