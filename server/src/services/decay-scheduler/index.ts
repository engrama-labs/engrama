/**
 * Decay Scheduler Service
 * 
 * Background worker that manages memory decay:
 * - Reduces importance of unused memories over time
 * - Expires memories below threshold
 * - Simulates human forgetting + reinforcement
 */

import { Memory, DecayConfig, WorkerStatus, MemoryStatus } from '../../types';
import { db } from '../../db';
import { importanceScorer } from '../importance-scorer';

// Default decay configuration
const DEFAULT_DECAY_CONFIG: DecayConfig = {
  baseDecayRate: 0.005,         // 0.5% daily decay
  minImportanceThreshold: 10,   // Below this, memory expires
  inactivityDays: 90,           // Days without use before accelerated decay
  reactivationBoost: 0.15,      // Confidence boost when expired memory recalled
};

class DecayScheduler {
  private config: DecayConfig;
  private status: WorkerStatus;
  private intervalId: NodeJS.Timeout | null = null;

  constructor(config: DecayConfig = DEFAULT_DECAY_CONFIG) {
    this.config = config;
    this.status = {
      name: 'DecayScheduler',
      isRunning: false,
      processedCount: 0,
      errorCount: 0,
      averageProcessingTimeMs: 0,
    };
  }

  /**
   * Start the decay scheduler
   * Runs every 24 hours by default
   */
  start(intervalMs = 24 * 60 * 60 * 1000): void {
    if (this.intervalId) {
      console.log('[DECAY_SCHEDULER] Already running');
      return;
    }

    console.log('[DECAY_SCHEDULER] Starting scheduler...');
    this.status.isRunning = true;

    // Run immediately on start
    this.runDecayCycle().catch(err => {
      console.error('[DECAY_SCHEDULER] Initial run error:', err);
    });

    // Then run on interval
    this.intervalId = setInterval(() => {
      this.runDecayCycle().catch(err => {
        console.error('[DECAY_SCHEDULER] Scheduled run error:', err);
      });
    }, intervalMs);

    this.status.nextRunAt = new Date(Date.now() + intervalMs);
  }

  /**
   * Stop the decay scheduler
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.status.isRunning = false;
    console.log('[DECAY_SCHEDULER] Stopped');
  }

  /**
   * Run a decay cycle for all users
   */
  async runDecayCycle(): Promise<{
    processedCount: number;
    decayedCount: number;
    expiredCount: number;
    reactivatedCount: number;
  }> {
    const startTime = Date.now();
    console.log('[DECAY_SCHEDULER] Starting decay cycle...');

    let processedCount = 0;
    let decayedCount = 0;
    let expiredCount = 0;
    let reactivatedCount = 0;

    try {
      // Get all active memories
      const memories = await db.getAllActiveMemories(10000);
      console.log('[DECAY_SCHEDULER] Processing', memories.length, 'memories');

      for (const memory of memories) {
        try {
          const result = await this.processMemory(memory);
          processedCount++;

          if (result.decayed) decayedCount++;
          if (result.expired) expiredCount++;
          if (result.reactivated) reactivatedCount++;
        } catch (err) {
          this.status.errorCount++;
          console.error('[DECAY_SCHEDULER] Error processing memory:', memory.id, err);
        }
      }

      this.status.processedCount += processedCount;
      this.status.lastRunAt = new Date();

      const processingTime = Date.now() - startTime;
      this.status.averageProcessingTimeMs = 
        (this.status.averageProcessingTimeMs + processingTime) / 2;

      console.log('[DECAY_SCHEDULER] Cycle complete:', {
        processedCount,
        decayedCount,
        expiredCount,
        reactivatedCount,
        timeMs: processingTime,
      });
    } catch (error) {
      this.status.errorCount++;
      console.error('[DECAY_SCHEDULER] Cycle error:', error);
    }

    return { processedCount, decayedCount, expiredCount, reactivatedCount };
  }

  /**
   * Process decay for a single memory
   */
  private async processMemory(memory: Memory): Promise<{
    decayed: boolean;
    expired: boolean;
    reactivated: boolean;
  }> {
    const now = new Date();
    const result = { decayed: false, expired: false, reactivated: false };

    // Skip if memory is already archived/expired
    if (memory.status === 'archived' || memory.status === 'merged') {
      return result;
    }

    // Calculate days since last activity
    const lastActivity = memory.lastRecalledAt || memory.createdAt;
    const daysSinceActivity = (now.getTime() - lastActivity.getTime()) / (1000 * 60 * 60 * 24);

    // Calculate decay amount
    let decayRate = this.config.baseDecayRate;
    
    // Accelerate decay for inactive memories
    if (daysSinceActivity > this.config.inactivityDays) {
      decayRate *= 2;
    }

    // Apply decay to decayScore
    const currentDecay = memory.decayScore || 1.0;
    const newDecay = Math.max(0, currentDecay - decayRate);

    // Recalculate importance with new decay
    const updatedMemory = { ...memory, decayScore: newDecay };
    const newImportance = importanceScorer.compute(updatedMemory);

    // Check if memory should expire
    if (
      newImportance < this.config.minImportanceThreshold &&
      daysSinceActivity > this.config.inactivityDays
    ) {
      // Expire the memory
      await db.updateMemory(memory.id, {
        status: 'expired',
        decayScore: newDecay,
        importanceScore: newImportance,
        updatedAt: now,
      });
      result.expired = true;
      console.log('[DECAY_SCHEDULER] Memory expired:', memory.id);
    } else if (newDecay < currentDecay) {
      // Just apply decay
      await db.updateMemory(memory.id, {
        decayScore: newDecay,
        importanceScore: newImportance,
        updatedAt: now,
      });
      result.decayed = true;
    }

    return result;
  }

  /**
   * Reactivate an expired memory (called when recalled)
   */
  async reactivateMemory(memoryId: string): Promise<void> {
    const memory = await db.getMemoryById(memoryId);
    if (!memory || memory.status !== 'expired') return;

    const newConfidence = Math.min(1, memory.confidence + this.config.reactivationBoost);
    const newDecay = 0.8; // Reset decay partially

    await db.updateMemory(memoryId, {
      status: 'active',
      confidence: newConfidence,
      decayScore: newDecay,
      lastRecalledAt: new Date(),
      recallCount: (memory.recallCount || 0) + 1,
      updatedAt: new Date(),
    });

    console.log('[DECAY_SCHEDULER] Memory reactivated:', memoryId);
  }

  /**
   * Get worker status
   */
  getStatus(): WorkerStatus {
    return { ...this.status };
  }

  /**
   * Update decay configuration
   */
  setConfig(config: Partial<DecayConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): DecayConfig {
    return { ...this.config };
  }

  /**
   * Run decay for a specific user
   */
  async runForUser(userId: string): Promise<{
    processedCount: number;
    decayedCount: number;
    expiredCount: number;
  }> {
    const memories = await db.getMemoriesByStatus(userId, ['active'], 10000);
    
    let processedCount = 0;
    let decayedCount = 0;
    let expiredCount = 0;

    for (const memory of memories) {
      const result = await this.processMemory(memory);
      processedCount++;
      if (result.decayed) decayedCount++;
      if (result.expired) expiredCount++;
    }

    return { processedCount, decayedCount, expiredCount };
  }
}

export const decayScheduler = new DecayScheduler();
export default decayScheduler;















