import { Router } from 'express';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { graphDb } from '../db/graph';
import {
  GetGraphResponse,
  GetEntityResponse,
  SearchEntitiesResponse,
} from '../types';

const router = Router();

/**
 * GET /graph
 * Get knowledge graph for a user
 * Query params: userId, depth, entityTypes, relationshipTypes, centerMemoryId, limit
 */
router.get('/', asyncHandler(async (req, res) => {
  // Get authenticated user ID (override any userId in query)
  const userId = req.user?.userId || 'anonymous';
  
  const { depth, entityTypes, relationshipTypes, centerMemoryId, limit } = req.query;

  const options: any = {};
  if (depth) options.depth = parseInt(depth as string);
  if (limit) options.limit = parseInt(limit as string);
  if (centerMemoryId) options.centerMemoryId = centerMemoryId as string;
  if (entityTypes) {
    options.entityTypes = (entityTypes as string).split(',');
  }
  if (relationshipTypes) {
    options.relationshipTypes = (relationshipTypes as string).split(',');
  }

  console.log('[GRAPH API] Building knowledge graph for user:', userId);
  console.log('[GRAPH API] Options:', options);

  const graph = await graphDb.buildKnowledgeGraph(userId, options);

  const response: GetGraphResponse = {
    success: true,
    graph,
  };

  res.json(response);
}));

/**
 * GET /graph/entities/:entityId
 * Get entity details with all its memories and relationships
 */
router.get('/entities/:entityId', asyncHandler(async (req, res) => {
  const { entityId } = req.params;
  const { userId } = req.query;

  if (!userId) {
    throw new AppError('userId is required', 400);
  }

  console.log('[GRAPH API] Getting entity:', entityId);

  const entity = await graphDb.getEntityById(entityId);
  if (!entity) {
    throw new AppError('Entity not found', 404);
  }

  const memories = await graphDb.getEntityMemories(entityId, userId as string);

  const response: GetEntityResponse = {
    success: true,
    entity,
    memories,
    relationships: [], // TODO: Implement entity relationships
  };

  res.json(response);
}));

/**
 * GET /graph/entities/search
 * Search entities by name
 * Query params: userId, query, type, limit
 */
router.get('/entities/search', asyncHandler(async (req, res) => {
  const { query, type, limit } = req.query;

  if (!query) {
    throw new AppError('query is required', 400);
  }

  console.log('[GRAPH API] Searching entities:', query);

  const entities = await graphDb.searchEntities(
    query as string,
    type as any,
    limit ? parseInt(limit as string) : 20
  );

  const response: SearchEntitiesResponse = {
    success: true,
    entities,
    count: entities.length,
  };

  res.json(response);
}));

/**
 * GET /graph/memories/:memoryId/related
 * Get all memories related to a specific memory
 */
router.get('/memories/:memoryId/related', asyncHandler(async (req, res) => {
  const { memoryId } = req.params;
  const { userId } = req.query;

  if (!userId) {
    throw new AppError('userId is required', 400);
  }

  console.log('[GRAPH API] Getting related memories for:', memoryId);

  const memories = await graphDb.getRelatedMemories(memoryId, userId as string);
  const relationships = await graphDb.getMemoryRelationships(memoryId);

  res.json({
    success: true,
    memories,
    relationships,
    count: memories.length,
  });
}));

/**
 * GET /graph/memories/:memoryId/entities
 * Get all entities for a specific memory
 */
router.get('/memories/:memoryId/entities', asyncHandler(async (req, res) => {
  const { memoryId } = req.params;

  console.log('[GRAPH API] Getting entities for memory:', memoryId);

  const entities = await graphDb.getMemoryEntities(memoryId);

  res.json({
    success: true,
    entities,
    count: entities.length,
  });
}));

export default router;

