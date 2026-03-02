/**
 * Memory Analytics Service
 * 
 * Provides observability metrics for the memory system:
 * - Memory counts by status
 * - Operation counts (merges, conflicts, decay)
 * - Quality metrics (confidence, importance, lifespan)
 * - Usage metrics (recalls, prompt assemblies)
 * - Safety metrics (PII, encrypted)
 */

import { Memory, MemoryMetrics, WorkerStatus, MemoryStatus } from '../../types';
import { db } from '../../db';
import { decayScheduler } from '../decay-scheduler';

class MemoryAnalytics {
  // In-memory counters (reset on server restart, would be persisted in production)
  private mergeCount = 0;
  private conflictCount = 0;
  private decayCount = 0;
  private reactivationCount = 0;
  private totalRecalls = 0;
  private totalPromptAssemblies = 0;
  private periodStart = new Date();

  /**
   * Get comprehensive memory metrics for a user
   */
  async getMetrics(userId: string): Promise<MemoryMetrics> {
    // Get all memories for the user
    const allMemories = await this.getAllUserMemories(userId);

    // Count by status
    const statusCounts = this.countByStatus(allMemories);

    // Count derived memories
    const derivedCount = allMemories.filter(m => m.type === 'derived').length;

    // Calculate quality metrics
    const qualityMetrics = this.calculateQualityMetrics(allMemories);

    // Count PII and encrypted memories
    const piiCount = allMemories.filter(m => m.piiTags && m.piiTags.length > 0).length;
    const encryptedCount = allMemories.filter(m => m.isEncrypted).length;

    // Calculate average recalls per memory
    const totalUserRecalls = allMemories.reduce((sum, m) => sum + (m.recallCount || 0), 0);
    const avgRecalls = allMemories.length > 0 ? totalUserRecalls / allMemories.length : 0;

    return {
      // Counts
      totalMemories: allMemories.length,
      activeMemories: statusCounts.active,
      outdatedMemories: statusCounts.outdated,
      mergedMemories: statusCounts.merged,
      expiredMemories: statusCounts.expired,
      archivedMemories: statusCounts.archived,
      derivedMemories: derivedCount,

      // Operations
      mergeCount: this.mergeCount,
      conflictCount: this.conflictCount,
      decayCount: this.decayCount,
      reactivationCount: this.reactivationCount,

      // Quality
      averageConfidence: qualityMetrics.avgConfidence,
      averageImportance: qualityMetrics.avgImportance,
      averageLifespanDays: qualityMetrics.avgLifespanDays,
      recallAccuracyScore: qualityMetrics.recallAccuracy,

      // Usage
      totalRecalls: this.totalRecalls,
      totalPromptAssemblies: this.totalPromptAssemblies,
      averageRecallsPerMemory: avgRecalls,

      // Safety
      piiMemoryCount: piiCount,
      encryptedMemoryCount: encryptedCount,

      // Time range
      periodStart: this.periodStart,
      periodEnd: new Date(),
    };
  }

  /**
   * Get all memories for a user
   */
  private async getAllUserMemories(userId: string): Promise<Memory[]> {
    try {
      const { memories } = await db.listMemories(userId, 10000, 0);
      return memories;
    } catch (error) {
      console.error('[ANALYTICS] Error getting user memories:', error);
      return [];
    }
  }

  /**
   * Count memories by status
   */
  private countByStatus(memories: Memory[]): Record<MemoryStatus, number> {
    const counts: Record<MemoryStatus, number> = {
      active: 0,
      outdated: 0,
      merged: 0,
      expired: 0,
      archived: 0,
    };

    for (const memory of memories) {
      const status = memory.status || 'active';
      if (status in counts) {
        counts[status]++;
      }
    }

    return counts;
  }

  /**
   * Calculate quality metrics
   */
  private calculateQualityMetrics(memories: Memory[]): {
    avgConfidence: number;
    avgImportance: number;
    avgLifespanDays: number;
    recallAccuracy: number;
  } {
    if (memories.length === 0) {
      return {
        avgConfidence: 0,
        avgImportance: 0,
        avgLifespanDays: 0,
        recallAccuracy: 0,
      };
    }

    const now = Date.now();
    let totalConfidence = 0;
    let totalImportance = 0;
    let totalLifespanDays = 0;
    let recalledMemories = 0;

    for (const memory of memories) {
      totalConfidence += memory.confidence;
      totalImportance += memory.importanceScore || 50;

      const lifespanMs = now - memory.createdAt.getTime();
      totalLifespanDays += lifespanMs / (1000 * 60 * 60 * 24);

      if ((memory.recallCount || 0) > 0) {
        recalledMemories++;
      }
    }

    const count = memories.length;
    return {
      avgConfidence: Math.round((totalConfidence / count) * 100) / 100,
      avgImportance: Math.round(totalImportance / count),
      avgLifespanDays: Math.round(totalLifespanDays / count),
      recallAccuracy: Math.round((recalledMemories / count) * 100),
    };
  }

  /**
   * Get worker statuses
   */
  getWorkerStatuses(): WorkerStatus[] {
    return [
      decayScheduler.getStatus(),
    ];
  }

  /**
   * Increment operation counters
   */
  recordMerge(): void {
    this.mergeCount++;
  }

  recordConflict(): void {
    this.conflictCount++;
  }

  recordDecay(): void {
    this.decayCount++;
  }

  recordReactivation(): void {
    this.reactivationCount++;
  }

  recordRecall(): void {
    this.totalRecalls++;
  }

  recordPromptAssembly(): void {
    this.totalPromptAssemblies++;
  }

  /**
   * Reset counters (for new period)
   */
  resetCounters(): void {
    this.mergeCount = 0;
    this.conflictCount = 0;
    this.decayCount = 0;
    this.reactivationCount = 0;
    this.totalRecalls = 0;
    this.totalPromptAssemblies = 0;
    this.periodStart = new Date();
  }

  /**
   * Get memory type distribution
   */
  async getTypeDistribution(userId: string): Promise<Record<string, number>> {
    const memories = await this.getAllUserMemories(userId);
    const distribution: Record<string, number> = {};

    for (const memory of memories) {
      const type = memory.type || 'unknown';
      distribution[type] = (distribution[type] || 0) + 1;
    }

    return distribution;
  }

  /**
   * Get memory activity timeline (last 30 days)
   */
  async getActivityTimeline(userId: string): Promise<{
    date: string;
    created: number;
    recalled: number;
  }[]> {
    const memories = await this.getAllUserMemories(userId);
    const timeline: Map<string, { created: number; recalled: number }> = new Map();

    // Initialize last 30 days
    for (let i = 29; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      timeline.set(dateStr, { created: 0, recalled: 0 });
    }

    // Count creations
    for (const memory of memories) {
      const dateStr = memory.createdAt.toISOString().split('T')[0];
      if (timeline.has(dateStr)) {
        const entry = timeline.get(dateStr)!;
        entry.created++;
      }
    }

    // Count recalls (approximate from lastRecalledAt)
    for (const memory of memories) {
      if (memory.lastRecalledAt) {
        const dateStr = memory.lastRecalledAt.toISOString().split('T')[0];
        if (timeline.has(dateStr)) {
          const entry = timeline.get(dateStr)!;
          entry.recalled++;
        }
      }
    }

    return Array.from(timeline.entries()).map(([date, counts]) => ({
      date,
      ...counts,
    }));
  }

  /**
   * Get top memories by importance
   */
  async getTopMemories(userId: string, limit = 10): Promise<Memory[]> {
    const memories = await this.getAllUserMemories(userId);
    
    return memories
      .filter(m => m.status === 'active' || !m.status)
      .sort((a, b) => (b.importanceScore || 50) - (a.importanceScore || 50))
      .slice(0, limit);
  }

  /**
   * Get health score for memory system
   */
  async getHealthScore(userId: string): Promise<{
    score: number;
    factors: Record<string, number>;
    recommendations: string[];
  }> {
    const metrics = await this.getMetrics(userId);
    const factors: Record<string, number> = {};
    const recommendations: string[] = [];
    let totalScore = 0;
    let factorCount = 0;

    // Factor 1: Active memory ratio
    const activeRatio = metrics.totalMemories > 0 
      ? metrics.activeMemories / metrics.totalMemories 
      : 0;
    factors.activeRatio = Math.round(activeRatio * 100);
    totalScore += activeRatio * 100;
    factorCount++;
    if (activeRatio < 0.7) {
      recommendations.push('Consider archiving or cleaning up outdated memories');
    }

    // Factor 2: Average confidence
    factors.avgConfidence = Math.round(metrics.averageConfidence * 100);
    totalScore += metrics.averageConfidence * 100;
    factorCount++;
    if (metrics.averageConfidence < 0.6) {
      recommendations.push('Many memories have low confidence - consider verifying important facts');
    }

    // Factor 3: Conflict ratio
    const conflictRatio = metrics.totalMemories > 0 
      ? 1 - (metrics.conflictCount / metrics.totalMemories)
      : 1;
    factors.conflictResolution = Math.round(conflictRatio * 100);
    totalScore += conflictRatio * 100;
    factorCount++;
    if (metrics.conflictCount > 5) {
      recommendations.push('Multiple memory conflicts detected - review and resolve');
    }

    // Factor 4: Usage rate
    const usageRate = metrics.totalMemories > 0 
      ? Math.min(1, metrics.averageRecallsPerMemory / 5)
      : 0;
    factors.usageRate = Math.round(usageRate * 100);
    totalScore += usageRate * 100;
    factorCount++;
    if (usageRate < 0.2) {
      recommendations.push('Memory recall rate is low - memories may not be relevant');
    }

    const overallScore = factorCount > 0 ? Math.round(totalScore / factorCount) : 0;

    return {
      score: overallScore,
      factors,
      recommendations,
    };
  }
}

export const memoryAnalytics = new MemoryAnalytics();
export default memoryAnalytics;
