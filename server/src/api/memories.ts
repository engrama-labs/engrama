import { Router } from 'express';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { validateRequest } from '../utils/validation';
import { 
  ListMemoriesRequestSchema,
  MergeMemoriesRequestSchema,
  DeleteMemoryRequestSchema,
} from '../utils/validation';
import { 
  ListMemoriesResponse,
  MergeMemoriesResponse,
  DeleteMemoryResponse,
} from '../types';
import { db, vectorDb, getSupabaseClient } from '../db';
import { memoryUpdater } from '../services/updater';

const router = Router();

/**
 * GET /memories
 * List memories with filtering and pagination
 */
router.get('/', asyncHandler(async (req, res) => {
  // Get authenticated user ID (override any userId in query)
  const authenticatedUserId = req.user?.userId || 'anonymous';
  
  console.log('[MEMORIES API] Request from user:', authenticatedUserId);
  console.log('[MEMORIES API] Has token:', !!req.user);
  
  // Validate query parameters
  const validatedData = validateRequest(ListMemoriesRequestSchema, {
    userId: authenticatedUserId, // Use authenticated user
    scope: req.query.scopeType && req.query.scopeId ? {
      type: req.query.scopeType as string,
      id: req.query.scopeId as string,
    } : undefined,
    limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
    offset: req.query.offset ? parseInt(req.query.offset as string) : undefined,
    type: req.query.type,
    sortBy: req.query.sortBy,
    sortOrder: req.query.sortOrder,
  });
  
  const { userId, scope, limit, offset, type, sortBy, sortOrder } = validatedData;
  
  console.log('[MEMORIES API] Querying memories for userId:', userId, 'scope:', scope);
  
  // Get memories from database
  const { memories, total } = await db.listMemories(
    userId,
    limit,
    offset,
    type,
    scope,
    sortBy,
    sortOrder
  );
  
  console.log('[MEMORIES API] Found', memories.length, 'memories for userId:', userId);
  
  // If no memories found and user is authenticated, try to find memories with common user IDs
  if (memories.length === 0 && req.user) {
    console.log('[MEMORIES API] No memories found, checking for memories with alternative user IDs...');
    const commonUserIds = ['default-user', 'anonymous', req.user.userId];
    
    for (const altUserId of commonUserIds) {
      if (altUserId !== userId) {
        const { memories: altMemories } = await db.listMemories(altUserId, 5, 0);
        if (altMemories.length > 0) {
          console.log(`[MEMORIES API] Found ${altMemories.length} memories with userId: ${altUserId}`);
          // Return a message indicating memories exist under a different user ID
          res.json({
            success: true,
            memories: [],
            total: 0,
            limit: limit || 20,
            offset: offset || 0,
            warning: `No memories found for current user (${userId}). Found ${altMemories.length} memories under user ID: ${altUserId}. Please contact support to migrate your memories.`,
            alternativeUserId: altUserId,
          });
          return;
        }
      }
    }
  }
  
  const response: ListMemoriesResponse = {
    success: true,
    memories,
    total,
    limit: limit || 20,
    offset: offset || 0,
  };
  
  res.json(response);
}));

/**
 * GET /memories/:id
 * Get a specific memory by ID
 */
router.get('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  
  // Get authenticated user ID
  const userId = req.user?.userId || 'anonymous';
  
  const memory = await db.getMemoryById(id, userId);
  
  if (!memory) {
    throw new AppError(404, 'Memory not found');
  }
  
  res.json({
    success: true,
    memory,
  });
}));

/**
 * POST /memories/merge
 * Merge two memories
 */
router.post('/merge', asyncHandler(async (req, res) => {
  // Get authenticated user ID
  const authenticatedUserId = req.user?.userId || 'anonymous';
  
  const validatedData = validateRequest(MergeMemoriesRequestSchema, req.body);
  
  const { memoryIdA, memoryIdB } = validatedData;
  const userId = authenticatedUserId; // Use authenticated user
  
  // Get both memories
  const memoryA = await db.getMemoryById(memoryIdA, userId);
  const memoryB = await db.getMemoryById(memoryIdB, userId);
  
  if (!memoryA || !memoryB) {
    throw new AppError(404, 'One or both memories not found');
  }
  
  // Merge memories
  const result = await memoryUpdater.mergeMemory(memoryA, memoryB);
  
  const response: MergeMemoriesResponse = {
    success: true,
    result,
  };
  
  res.json(response);
}));

/**
 * DELETE /memories/:id
 * Delete a memory
 */
router.delete('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  
  // Get authenticated user ID
  const userId = req.user?.userId || 'anonymous';
  
  // Check if memory exists
  const memory = await db.getMemoryById(id, userId);
  
  if (!memory) {
    throw new AppError(404, 'Memory not found');
  }
  
  // Delete from database
  await db.deleteMemory(id, userId);
  
  // Delete from vector database
  try {
    await vectorDb.deleteVector(id);
  } catch (error) {
    console.error('Error deleting vector:', error);
    // Continue even if vector deletion fails
  }
  
  const response: DeleteMemoryResponse = {
    success: true,
    deletedId: id,
  };
  
  res.json(response);
}));

/**
 * GET /memories/debug/user-ids
 * Debug endpoint to list all user IDs that have memories
 * (For troubleshooting missing memories)
 */
router.get('/debug/user-ids', asyncHandler(async (req, res) => {
  const supabaseClient = getSupabaseClient();
  
  const { data, error } = await supabaseClient
    .from('memories')
    .select('user_id')
    .order('created_at', { ascending: false });
  
  if (error) {
    throw new AppError(500, `Failed to query user IDs: ${error.message}`);
  }
  
  // Get unique user IDs with counts
  const userIdCounts: Record<string, number> = {};
  (data || []).forEach((row: any) => {
    const userId = row.user_id || 'null';
    userIdCounts[userId] = (userIdCounts[userId] || 0) + 1;
  });
  
  res.json({
    success: true,
    userIds: Object.keys(userIdCounts).map(userId => ({
      userId,
      memoryCount: userIdCounts[userId],
    })),
    totalMemories: data?.length || 0,
    currentUserId: req.user?.userId || 'anonymous',
  });
}));

export default router;






