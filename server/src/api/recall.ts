import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { validateRequest } from '../utils/validation';
import { RecallRequestSchema } from '../utils/validation';
import { RecallResponse } from '../types';
import { memoryRetriever } from '../services/retriever';

const router = Router();

/**
 * POST /recall
 * Retrieve relevant memories for a query
 */
router.post('/', asyncHandler(async (req, res) => {
  // Get authenticated user ID (override any userId in body)
  const authenticatedUserId = req.user?.userId || 'anonymous';
  
  // Validate request
  const validatedData = validateRequest(RecallRequestSchema, req.body);
  
  // Use authenticated user ID
  const requestData = {
    ...validatedData,
    userId: authenticatedUserId,
  };
  
  // Auto-correct scope.id for user scope to match authenticated userId
  if (requestData.scope && requestData.scope.type === 'user') {
    requestData.scope.id = authenticatedUserId;
  }
  if (requestData.scopes && Array.isArray(requestData.scopes)) {
    requestData.scopes = requestData.scopes.map(s => {
      if (s.type === 'user') {
        return { ...s, id: authenticatedUserId };
      }
      return s;
    });
  }
  
  // Retrieve memories
  const results = await memoryRetriever.retrieve(requestData);
  
  const response: RecallResponse = {
    success: true,
    memories: results,
    count: results.length,
  };
  
  res.json(response);
}));

export default router;






