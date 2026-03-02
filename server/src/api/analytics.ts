/**
 * Memory Analytics API
 * 
 * Exposes observability metrics for the memory system.
 * 
 * Endpoints:
 * - GET /analytics/metrics - Get comprehensive metrics
 * - GET /analytics/health - Get health score
 * - GET /analytics/distribution - Get memory type distribution
 * - GET /analytics/timeline - Get activity timeline
 * - GET /analytics/top - Get top memories by importance
 * - GET /analytics/workers - Get background worker status
 */

import { Router, Request, Response } from 'express';
import { memoryAnalytics } from '../services/analytics';
import { decayScheduler } from '../services/decay-scheduler';

const router = Router();

/**
 * GET /analytics/metrics
 * Get comprehensive memory metrics
 */
router.get('/metrics', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).userId || req.query.userId as string;
    
    if (!userId) {
      res.status(400).json({ error: 'userId is required' });
      return;
    }

    const metrics = await memoryAnalytics.getMetrics(userId);
    
    res.json({
      success: true,
      metrics,
    });
  } catch (error: any) {
    console.error('[ANALYTICS] Error getting metrics:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Failed to get metrics' 
    });
  }
});

/**
 * GET /analytics/health
 * Get memory system health score
 */
router.get('/health', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).userId || req.query.userId as string;
    
    if (!userId) {
      res.status(400).json({ error: 'userId is required' });
      return;
    }

    const health = await memoryAnalytics.getHealthScore(userId);
    
    res.json({
      success: true,
      health,
    });
  } catch (error: any) {
    console.error('[ANALYTICS] Error getting health:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Failed to get health score' 
    });
  }
});

/**
 * GET /analytics/distribution
 * Get memory type distribution
 */
router.get('/distribution', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).userId || req.query.userId as string;
    
    if (!userId) {
      res.status(400).json({ error: 'userId is required' });
      return;
    }

    const distribution = await memoryAnalytics.getTypeDistribution(userId);
    
    res.json({
      success: true,
      distribution,
    });
  } catch (error: any) {
    console.error('[ANALYTICS] Error getting distribution:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Failed to get distribution' 
    });
  }
});

/**
 * GET /analytics/timeline
 * Get activity timeline (last 30 days)
 */
router.get('/timeline', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).userId || req.query.userId as string;
    
    if (!userId) {
      res.status(400).json({ error: 'userId is required' });
      return;
    }

    const timeline = await memoryAnalytics.getActivityTimeline(userId);
    
    res.json({
      success: true,
      timeline,
    });
  } catch (error: any) {
    console.error('[ANALYTICS] Error getting timeline:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Failed to get timeline' 
    });
  }
});

/**
 * GET /analytics/top
 * Get top memories by importance
 */
router.get('/top', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).userId || req.query.userId as string;
    const limit = parseInt(req.query.limit as string) || 10;
    
    if (!userId) {
      res.status(400).json({ error: 'userId is required' });
      return;
    }

    const memories = await memoryAnalytics.getTopMemories(userId, limit);
    
    res.json({
      success: true,
      memories,
      count: memories.length,
    });
  } catch (error: any) {
    console.error('[ANALYTICS] Error getting top memories:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Failed to get top memories' 
    });
  }
});

/**
 * GET /analytics/workers
 * Get background worker status
 */
router.get('/workers', async (req: Request, res: Response): Promise<void> => {
  try {
    const workers = memoryAnalytics.getWorkerStatuses();
    
    res.json({
      success: true,
      workers,
    });
  } catch (error: any) {
    console.error('[ANALYTICS] Error getting worker status:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Failed to get worker status' 
    });
  }
});

/**
 * POST /analytics/decay/run
 * Manually trigger decay cycle (admin only)
 */
router.post('/decay/run', async (req: Request, res: Response): Promise<void> => {
  try {
    console.log('[ANALYTICS] Manually triggering decay cycle...');
    
    const result = await decayScheduler.runDecayCycle();
    
    res.json({
      success: true,
      result,
    });
  } catch (error: any) {
    console.error('[ANALYTICS] Error running decay:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Failed to run decay cycle' 
    });
  }
});

/**
 * POST /analytics/decay/start
 * Start decay scheduler
 */
router.post('/decay/start', async (req: Request, res: Response): Promise<void> => {
  try {
    const intervalHours = parseInt(req.body.intervalHours as string) || 24;
    const intervalMs = intervalHours * 60 * 60 * 1000;
    
    decayScheduler.start(intervalMs);
    
    res.json({
      success: true,
      message: `Decay scheduler started with ${intervalHours}h interval`,
      status: decayScheduler.getStatus(),
    });
  } catch (error: any) {
    console.error('[ANALYTICS] Error starting decay scheduler:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Failed to start decay scheduler' 
    });
  }
});

/**
 * POST /analytics/decay/stop
 * Stop decay scheduler
 */
router.post('/decay/stop', async (req: Request, res: Response): Promise<void> => {
  try {
    decayScheduler.stop();
    
    res.json({
      success: true,
      message: 'Decay scheduler stopped',
      status: decayScheduler.getStatus(),
    });
  } catch (error: any) {
    console.error('[ANALYTICS] Error stopping decay scheduler:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Failed to stop decay scheduler' 
    });
  }
});

export default router;
