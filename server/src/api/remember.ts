import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { validateRequest } from '../utils/validation';
import { RememberRequestSchema } from '../utils/validation';
import { RememberResponse, AgentType, MemorySource } from '../types';
import { memoryExtractor } from '../services/extractor';
import { generateEmbedding } from '../utils/llm';
import { db, vectorDb } from '../db';
import { graphDb } from '../db/graph';
import { graphService } from '../services/graph';
import { generateId, cosineSimilarity } from '../utils/helpers';
import { 
  getAgentPreset, 
  isSourceAllowed
} from '../config/agent-presets';

const router = Router();

/**
 * POST /remember
 * Store new memories from user text
 */
router.post('/', asyncHandler(async (req, res) => {
  // Get authenticated user ID (override any userId in body)
  const authenticatedUserId = req.user?.userId || 'anonymous';
  
  // Validate request
  const validatedData = validateRequest(RememberRequestSchema, req.body);
  
  // Use authenticated user ID instead of request body userId
  const userId = authenticatedUserId;
  const { 
    text, 
    scope, 
    source: requestedSource, 
    agentType: requestedAgentType, 
    agentId,
    timestamp, 
    metadata,
    confirmed,
    promote 
  } = validatedData;
  const inputTimestamp = timestamp ? new Date(timestamp) : new Date();
  
  // UNIVERSAL MEMORY ENGINE: Get agent type and source
  const agentType: AgentType = requestedAgentType || 'general';
  const source: MemorySource = requestedSource || 'user'; // Default to 'user' for safety
  
  // Get agent preset
  const preset = getAgentPreset(agentType);
  
  // UNIVERSAL MEMORY ENGINE: Validate source is allowed
  if (!isSourceAllowed(source, agentType)) {
    console.log(`[UNIVERSAL] Source '${source}' not allowed for agent type '${agentType}'`);
    const response: RememberResponse = {
      success: false,
      memories: [],
      count: 0,
    };
    res.status(400).json({ ...response, error: `Source '${source}' not allowed for agent type '${agentType}'` });
    return;
  }
  
  // UNIVERSAL MEMORY ENGINE: Reject AI source by default (unless explicitly allowed)
  if (source === 'ai' && !preset.allowAiPromotion) {
    console.log(`[UNIVERSAL] AI source rejected for agent type '${agentType}'`);
    const response: RememberResponse = {
      success: true,
      memories: [],
      count: 0,
    };
    res.json(response);
    return;
  }
  
  // Validate scope: if user scope, ensure scope.id matches userId
  // Update scope.id to match authenticated userId if it's a user scope
  if (scope.type === 'user') {
    if (scope.id !== userId) {
      // Auto-correct: use authenticated user ID for user scope
      console.log(`[remember] Updating user scope.id from ${scope.id} to authenticated userId ${userId}`);
      scope.id = userId;
    }
  }
  
  // UNIVERSAL MEMORY ENGINE: Check if text is relevant for storage
  const relevanceCheck = await memoryExtractor.classifyRelevance(text, agentType);
  console.log(`[UNIVERSAL] Relevance check (${agentType}):`, relevanceCheck);
  
  // Reject if text is not relevant or is AI-only content
  if (!relevanceCheck.should_store) {
    console.log(`[UNIVERSAL] Text rejected - not relevant for storage (${agentType}):`, relevanceCheck.reason);
    const response: RememberResponse = {
      success: true,
      memories: [],
      count: 0,
    };
    res.json(response);
    return;
  }
  
  // UNIVERSAL MEMORY ENGINE: Extract memory candidates with agent type and source
  console.log(`[UNIVERSAL] Extracting candidates (${agentType}, source: ${source}):`, text);
  const candidates = await memoryExtractor.extractMemoryCandidates(text, agentType, source);
  
  console.log('[DEBUG] Extracted candidates:', candidates.length, candidates);
  
  if (candidates.length === 0) {
    console.log('[DEBUG] No candidates extracted, returning empty response');
    const response: RememberResponse = {
      success: true,
      memories: [],
      count: 0,
    };
    
    res.json(response);
    return;
  }
  
  // UNIVERSAL MEMORY ENGINE: Filter candidates based on agent preset rules
  const validCandidates = candidates.filter(candidate => {
    // Check if source is allowed for this agent type
    if (!isSourceAllowed(candidate.source, agentType)) {
      console.log(`[UNIVERSAL] Candidate rejected - source '${candidate.source}' not allowed:`, candidate.canonicalText);
      return false;
    }
    
    // Check confirmation requirements
    if (candidate.requiresConfirmation && !confirmed) {
      console.log(`[UNIVERSAL] Candidate requires confirmation but not confirmed:`, candidate.canonicalText);
      return false;
    }
    
    // Check confidence threshold
    const threshold = preset.confidenceThreshold;
    if (candidate.confidence < threshold) {
      console.log(`[UNIVERSAL] Candidate below confidence threshold (${candidate.confidence} < ${threshold}):`, candidate.canonicalText);
      return false;
    }
    
    return true;
  });
  
  if (validCandidates.length === 0) {
    console.log(`[UNIVERSAL] No valid candidates after filtering (${agentType})`);
    const response: RememberResponse = {
      success: true,
      memories: [],
      count: 0,
    };
    res.json(response);
    return;
  }
  
  console.log(`[UNIVERSAL] Processing ${validCandidates.length} valid candidates (${agentType})`);
  
  // Get existing memories for duplicate detection (within the same scope)
  console.log('[DEBUG] Fetching existing memories for duplicate detection');
  const { memories: existingMemories } = await db.listMemories(userId, 100, 0, undefined, scope);
  console.log('[DEBUG] Found', existingMemories.length, 'existing memories in scope', scope.type, scope.id);
  
  // Process each valid candidate
  const storedMemories = [];
  
  for (const candidate of validCandidates) {
    try {
      // Canonicalize the memory
      const canonical = await memoryExtractor.canonicalizeMemory(candidate.canonicalText);
      console.log('[DEBUG] Canonicalized text:', canonical);
      
      // Generate embedding
      const embedding = await generateEmbedding(canonical);
      
      // DUPLICATE & CONTRADICTION DETECTION: Check semantic similarity with existing memories
      let isDuplicate = false;
      let existingMemoryToUpdate = null;
      let isContradiction = false;
      let contradictedMemory: any = null;
      
      for (const existingMemory of existingMemories) {
        try {
          // Get existing memory's embedding
          const existingEmbedding = await vectorDb.getVector(existingMemory.id);
          
          if (existingEmbedding) {
            const similarity = cosineSimilarity(embedding, existingEmbedding);
            console.log('[DUPLICATE CHECK] Similarity with existing memory:', similarity.toFixed(3), '|', existingMemory.canonicalText.substring(0, 50));
            
            // UNIVERSAL MEMORY ENGINE: Check for contradictions in same category
            const sameCategory = candidate.category && 
                                 existingMemory.category === candidate.category;
            
            // If similarity > 0.85, it's a duplicate!
            if (similarity > 0.85) {
              console.log('[DUPLICATE FOUND] Will update existing memory instead of creating new one');
              isDuplicate = true;
              existingMemoryToUpdate = existingMemory;
              break;
            }
            
            // UNIVERSAL MEMORY ENGINE: Detect contradictions (high similarity but different content)
            // For same category memories, if similarity is 0.7-0.85, might be contradiction
            if (sameCategory && similarity > 0.7 && similarity < 0.85) {
              // Check if they contradict (e.g., "prefers X" vs "prefers Y" for same thing)
              const candidateLower = canonical.toLowerCase();
              const existingLower = existingMemory.canonicalText.toLowerCase();
              
              // Simple contradiction detection: if both mention preferences/decisions but different values
              const preferencePattern = /\b(prefers?|likes?|uses?|chose|decided)\b/i;
              if (preferencePattern.test(candidateLower) && preferencePattern.test(existingLower)) {
                // Extract key terms and check for conflicts
                const candidateTerms: string[] = candidateLower.match(/\b\w{3,}\b/g) || [];
                const existingTerms: string[] = existingLower.match(/\b\w{3,}\b/g) || [];
                
                // If they share context words but have different preference values, might be contradiction
                const sharedContext = candidateTerms.filter((t: string) => existingTerms.includes(t) && t.length > 4);
                if (sharedContext.length > 2) {
                  console.log('[CONTRADICTION DETECTED] Same context, different values');
                  isContradiction = true;
                  contradictedMemory = existingMemory;
                  break;
                }
              }
            }
          }
        } catch (err) {
          // Skip if can't get embedding
          continue;
        }
      }
      
      // UNIVERSAL MEMORY ENGINE: Handle contradictions by superseding old memory
      if (isContradiction && contradictedMemory) {
        console.log(`[UNIVERSAL] Contradiction detected (${agentType}), superseding old memory`);
        // Mark old memory as superseded
        const supersededMemory = {
          ...contradictedMemory,
          conflictStatus: 'superseded' as const,
          updatedAt: new Date(),
        };
        await db.updateMemory(supersededMemory);
      }
      
      if (isDuplicate && existingMemoryToUpdate) {
        // UPDATE existing memory instead of creating duplicate
        console.log('[DEBUG] Updating existing memory:', existingMemoryToUpdate.id);
        
        const updatedMemory = {
          ...existingMemoryToUpdate,
          canonicalText: canonical, // Use new canonicalization
          confidence: Math.max(existingMemoryToUpdate.confidence, candidate.confidence), // Keep higher confidence
          tags: [...new Set([...existingMemoryToUpdate.tags, ...candidate.tags])], // Merge tags
          updatedAt: new Date(),
          version: existingMemoryToUpdate.version + 1,
          provenance: [
            ...existingMemoryToUpdate.provenance,
            {
              source: candidate.source,
              timestamp: new Date(),
              rawText: text,
              confidence: candidate.confidence,
              agentType: agentType,
            },
          ],
        };
        
        const stored = await db.updateMemory(updatedMemory);
        console.log('[DEBUG] Memory updated successfully');
        
        storedMemories.push(stored);
      } else {
        // CREATE NEW memory
        const memoryId = generateId();
        const now = new Date();
        
        const memory = {
          id: memoryId,
          userId,
          agentId: agentId, // Optional agent identifier
          scope, // MANDATORY: Store memory with scope
          category: candidate.category, // MANDATORY: Universal category
          canonicalText: canonical,
          type: candidate.category, // Alias for backward compatibility
          source: candidate.source, // MANDATORY: Source tracking
          confidence: candidate.confidence,
          tags: candidate.tags,
          timestamp: inputTimestamp,
          createdAt: now,
          updatedAt: now,
          version: 1,
          ttl: undefined,
          provenance: [
            {
              source: candidate.source,
              timestamp: now,
              rawText: text,
              confidence: candidate.confidence,
              agentType: agentType,
            },
          ],
          linkedMemories: [],
          conflictStatus: isContradiction ? 'superseded' as const : 'none' as const,
          visibility: 'private' as const,
          metadata: {
            ...metadata,
            ...memoryExtractor.extractMetadata(text, candidate.category),
          },
          // Confirmation & promotion pipeline
          requiresConfirmation: candidate.requiresConfirmation || false,
          confirmed: confirmed !== undefined ? confirmed : !candidate.requiresConfirmation,
          promoted: promote || false, // True if promoted from candidate
          supersedesMemoryId: isContradiction && contradictedMemory ? contradictedMemory.id : undefined,
          // Agent type context
          agentType: agentType,
        };
        
        // Store in database
        console.log('[DEBUG] Inserting NEW memory into database:', memoryId);
        const stored = await db.insertMemory(memory);
        console.log('[DEBUG] Memory inserted successfully');
        
        // Store vector
        console.log('[DEBUG] Storing vector embedding');
        await vectorDb.insertVector(memoryId, embedding, {
          userId,
          type: candidate.type,
          timestamp: inputTimestamp.getTime(),
          confidence: candidate.confidence,
        });
        console.log('[DEBUG] Vector stored successfully');
        
        storedMemories.push(stored);
      }
    } catch (error) {
      console.error('[ERROR] Error storing memory candidate:', error);
      console.error('[ERROR] Error details:', error instanceof Error ? error.message : String(error));
      // Continue with other candidates
    }
  }
  
  // ========================================
  // Build Knowledge Graph (async, don't block response)
  // ========================================
  if (storedMemories.length > 0) {
    // Run graph building in background (don't await)
    Promise.all(storedMemories.map(async (memory) => {
      try {
        console.log('[GRAPH] Building knowledge graph for memory:', memory.id);
        
        // 1. Extract entities from the memory
        const entities = await graphService.extractEntities(memory.canonicalText);
        console.log('[GRAPH] Extracted', entities.length, 'entities');
        
        // 2. Store entities and link to memory
        for (const entity of entities) {
          try {
            const storedEntity = await graphDb.upsertEntity(entity);
            await graphDb.linkEntityToMemory(
              storedEntity.id,
              memory.id,
              entity.relevanceScore,
              entity.context
            );
            console.log('[GRAPH] Linked entity:', storedEntity.name, 'to memory');
          } catch (error) {
            console.error('[GRAPH] Error linking entity:', error);
          }
        }
        
        // 3. Detect relationships with existing memories
        const relationships = await graphService.detectRelationships(memory, existingMemories);
        console.log('[GRAPH] Detected', relationships.length, 'relationships');
        
        // 4. Store relationships
        for (const rel of relationships) {
          try {
            await graphDb.createMemoryRelationship(memory.id, rel);
            console.log('[GRAPH] Created relationship:', rel.relationshipType, 'to', rel.targetMemoryId);
          } catch (error) {
            console.error('[GRAPH] Error creating relationship:', error);
          }
        }
        
        console.log('[GRAPH] Knowledge graph built for memory:', memory.id);
      } catch (error) {
        console.error('[GRAPH] Error building knowledge graph:', error);
      }
    })).catch(error => {
      console.error('[GRAPH] Error in graph building promises:', error);
    });
  }
  
  const response: RememberResponse = {
    success: true,
    memories: storedMemories,
    count: storedMemories.length,
  };
  
  res.json(response);
}));

export default router;






