// Universal memory types (domain-agnostic)
export type MemoryType = 
  | 'preference'    // User preferences, likes, dislikes
  | 'decision'      // Confirmed decisions, choices made
  | 'constraint'    // Constraints, rules, limitations
  | 'fact'          // Objective facts, information
  | 'goal'          // Goals, objectives, aspirations
  | 'context'       // Contextual information, state
  | 'history'       // Historical events (low-priority, optional)
  | 'derived';      // System-inferred from other memories

// Memory lifecycle status
export type MemoryStatus = 
  | 'active'        // Currently valid and in use
  | 'outdated'      // Superseded by newer memory
  | 'merged'        // Merged into another memory
  | 'expired'       // TTL exceeded, soft-archived
  | 'archived';     // Manually or auto-archived

// Universal scopes (all agents)
export type ScopeType = 'user' | 'task' | 'session' | 'agent' | 'project' | 'global';

// Memory source (critical for safety)
export type MemorySource = 'user' | 'system' | 'environment' | 'ai' | 'derived';

// PII types for safety layer
export type PIIType = 'email' | 'phone' | 'address' | 'ssn' | 'credit_card' | 'name' | 'dob' | 'none';

// Agent type presets
export type AgentType = 'coding' | 'healthcare' | 'support' | 'research' | 'general';

export interface MemoryScope {
  type: ScopeType;
  id: string;
}

export interface Memory {
  id: string;
  userId: string;
  agentId?: string; // Optional: agent identifier
  scope: MemoryScope; // MANDATORY: Every memory must have a scope
  category: MemoryType; // MANDATORY: Universal category
  canonicalText: string;
  type: MemoryType; // Alias for category (backward compatibility)
  source: MemorySource; // MANDATORY: Where memory came from
  confidence: number;
  tags: string[];
  timestamp: Date;
  createdAt: Date;
  updatedAt: Date;
  version: number;
  ttl?: Date;
  provenance: Provenance[];
  linkedMemories: string[];
  conflictStatus: 'none' | 'conflict' | 'resolved' | 'superseded';
  visibility: 'private' | 'shared' | 'public';
  metadata: Record<string, any>;
  
  // ========================================
  // LIFECYCLE SYSTEM (v2.0)
  // ========================================
  status: MemoryStatus;              // Memory lifecycle stage
  lastVerifiedAt?: Date;             // Last time memory was confirmed accurate
  decayScore: number;                // Importance aging factor (0-1, starts at 1)
  
  // ========================================
  // IMPORTANCE & USAGE TRACKING
  // ========================================
  importanceScore: number;           // Computed importance (0-100)
  recallCount: number;               // Number of times recalled
  lastRecalledAt?: Date;             // Last recall timestamp
  usedInPromptCount: number;         // Times used in prompt assembly
  userExplicitRemember: boolean;     // User explicitly said "remember this"
  
  // ========================================
  // RELATIONSHIPS & LINKING
  // ========================================
  updatedFromId?: string;            // ID of memory this updates
  mergedFromIds?: string[];          // IDs of memories merged into this
  derivedFromIds?: string[];         // IDs of memories this was inferred from
  conflictGroupId?: string;          // Group ID for conflicting memories
  
  // ========================================
  // SAFETY & PRIVACY
  // ========================================
  piiTags: PIIType[];                // Detected PII types
  isEncrypted: boolean;              // Whether content is encrypted at rest
  isSensitive: boolean;              // Marked as sensitive data
  
  // ========================================
  // CONFIRMATION & PROMOTION (existing)
  // ========================================
  requiresConfirmation?: boolean;    // True if memory was inferred and needs user confirmation
  confirmed?: boolean;               // True if user confirmed this memory
  promoted?: boolean;                // True if promoted from candidate to long-term
  candidateId?: string;              // ID of candidate memory if this was promoted
  supersedesMemoryId?: string;       // ID of memory this supersedes
  
  // Agent type context
  agentType?: AgentType;             // Agent type that created this memory
}

export interface Provenance {
  source: MemorySource; // Updated to use MemorySource type
  timestamp: Date;
  rawText: string;
  confidence: number;
  agentType?: AgentType; // Agent type that created this provenance
}

export interface MemoryCandidate {
  type: MemoryType;
  category: MemoryType; // Universal category
  canonicalText: string;
  confidence: number;
  tags: string[];
  entities?: string[];
  relevance: boolean;
  source: MemorySource; // MANDATORY: Source of candidate
  requiresConfirmation?: boolean; // True if needs user confirmation
  agentType?: AgentType; // Agent type context
}

export interface EmbeddingVector {
  memoryId: string;
  vector: number[];
  metadata: {
    userId: string;
    type: MemoryType;
    timestamp: number;
    confidence: number;
  };
}

export interface RetrievalResult {
  memory: Memory;
  score: number;
  similarityScore: number;
  recencyScore: number;
  confidenceScore: number;
  typeScore: number;
}

export interface ContextBlock {
  memories: Memory[];
  memoryIds: string[];
  contextText: string;
  tokenCount: number;
  timestamp: Date;
}

export interface ConflictResolution {
  action: 'overwrite' | 'merge' | 'mark_conflict' | 'keep_both';
  reason: string;
  confidence: number;
}

export interface MergeResult {
  mergedMemory: Memory;
  action: 'merged' | 'overwritten' | 'conflict_marked';
  previousVersion?: Memory;
}

// API Request/Response types
export interface RememberRequest {
  userId: string;
  text: string;
  scope: MemoryScope; // MANDATORY: Must specify scope when storing memory
  source?: MemorySource; // Optional: defaults to 'user' if not provided
  agentType?: AgentType; // Optional: agent type preset
  agentId?: string; // Optional: specific agent identifier
  timestamp?: Date;
  metadata?: Record<string, any>;
  // Confirmation & promotion
  requiresConfirmation?: boolean;  // True if agent inferred this
  confirmed?: boolean;            // True if user confirmed
  promote?: boolean;              // True to promote candidate to long-term
}

export interface RememberResponse {
  success: boolean;
  memories: Memory[];
  count: number;
}

export interface RecallRequest {
  userId: string;
  query: string;
  agentType?: AgentType; // Optional: agent type for recall tuning
  scope?: MemoryScope; // Single scope for basic recall
  scopes?: MemoryScope[]; // Multiple scopes for layered recall (priority: session > task > agent > user)
  k?: number;
  tokenBudget?: number;
  filters?: {
    types?: MemoryType[];
    sources?: MemorySource[]; // Filter by source
    dateRange?: {
      start: Date;
      end: Date;
    };
    tags?: string[];
  };
}

export interface RecallResponse {
  success: boolean;
  memories: RetrievalResult[];
  count: number;
}

export interface AssemblePromptRequest {
  userId: string;
  agentInstructions: string;
  userInput: string;
  tokenBudget?: number;
}

export interface AssemblePromptResponse {
  success: boolean;
  assembledPrompt: string;
  contextBlock: ContextBlock;
  usedMemories: string[];
}

export interface ListMemoriesRequest {
  userId: string;
  scope?: MemoryScope; // Filter by scope
  limit?: number;
  offset?: number;
  type?: MemoryType;
  sortBy?: 'createdAt' | 'updatedAt' | 'confidence';
  sortOrder?: 'asc' | 'desc';
}

export interface ListMemoriesResponse {
  success: boolean;
  memories: Memory[];
  total: number;
  limit: number;
  offset: number;
}

export interface MergeMemoriesRequest {
  memoryIdA: string;
  memoryIdB: string;
  userId: string;
}

export interface MergeMemoriesResponse {
  success: boolean;
  result: MergeResult;
}

export interface DeleteMemoryRequest {
  memoryId: string;
  userId: string;
}

export interface DeleteMemoryResponse {
  success: boolean;
  deletedId: string;
}

// Configuration types
export interface ScoringWeights {
  similarity: number;
  recency: number;
  confidence: number;
  typePriority: number;
}

export interface MemoryConfig {
  typePriorities: Record<MemoryType, number>;
  scoringWeights: ScoringWeights;
  defaultTtlDays: number;
  relevanceThreshold: number;
  conflictThreshold: number;
  maxMemoriesPerUser: number;
}

export interface ExtractionPrompts {
  extraction: string;
  canonicalization: string;
  conflictResolution: string;
  relevanceClassification: string;
}

// ========================================
// Knowledge Graph Types
// ========================================

export type EntityType = 
  | 'person' 
  | 'place' 
  | 'organization' 
  | 'concept' 
  | 'event' 
  | 'product'
  | 'technology'
  | 'skill';

export interface Entity {
  id: string;
  name: string;
  type: EntityType;
  description?: string;
  metadata: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

export interface MemoryEntity {
  id: string;
  memoryId: string;
  entityId: string;
  relevanceScore: number;
  context?: string;
  createdAt: Date;
}

export type MemoryRelationshipType = 
  | 'related_to' 
  | 'contradicts' 
  | 'supports' 
  | 'updates' 
  | 'supersedes'
  | 'references'
  | 'depends_on';

export interface MemoryRelationship {
  id: string;
  sourceMemoryId: string;
  targetMemoryId: string;
  relationshipType: MemoryRelationshipType;
  confidence: number;
  reason?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface EntityRelationship {
  id: string;
  sourceEntityId: string;
  targetEntityId: string;
  relationshipType: string;
  confidence: number;
  metadata: Record<string, any>;
  createdAt: Date;
}

export interface ExtractedEntity {
  name: string;
  type: EntityType;
  description?: string;
  relevanceScore: number;
  context: string;
}

export interface DetectedRelationship {
  targetMemoryId: string;
  relationshipType: MemoryRelationshipType;
  confidence: number;
  reason: string;
}

// Graph Query Interfaces
export interface GraphNode {
  id: string;
  label: string;
  type: 'memory' | 'entity';
  data: Memory | Entity;
  size?: number;
  color?: string;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: string;
  label?: string;
  confidence?: number;
  data?: MemoryRelationship | EntityRelationship;
}

export interface KnowledgeGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  metadata: {
    totalNodes: number;
    totalEdges: number;
    entityTypes: Record<EntityType, number>;
    relationshipTypes: Record<string, number>;
  };
}

// Graph API Types
export interface GetGraphRequest {
  userId: string;
  depth?: number; // How many levels deep to traverse
  entityTypes?: EntityType[];
  relationshipTypes?: MemoryRelationshipType[];
  centerMemoryId?: string; // Center the graph around a specific memory
}

export interface GetGraphResponse {
  success: boolean;
  graph: KnowledgeGraph;
}

export interface GetEntityRequest {
  entityId: string;
  userId: string;
}

export interface GetEntityResponse {
  success: boolean;
  entity: Entity;
  memories: Memory[];
  relationships: EntityRelationship[];
}

export interface SearchEntitiesRequest {
  userId: string;
  query: string;
  type?: EntityType;
  limit?: number;
}

export interface SearchEntitiesResponse {
  success: boolean;
  entities: Entity[];
  count: number;
}

// ========================================
// MEMORY INTELLIGENCE TYPES (v2.0)
// ========================================

/**
 * Memory similarity check result
 */
export interface SimilarityCheckResult {
  memoryId: string;
  similarity: number;
  isSemanticDuplicate: boolean;
  isEntityMatch: boolean;
  suggestedAction: 'merge' | 'update' | 'conflict' | 'none';
  reason: string;
}

/**
 * Memory merge operation result
 */
export interface MergeOperationResult {
  success: boolean;
  mergedMemoryId: string;
  sourceMemoryIds: string[];
  action: 'merged' | 'deduped' | 'conflict_created';
  confidenceBoost: number;
}

/**
 * Conflict detection result
 */
export interface ConflictDetectionResult {
  hasConflict: boolean;
  conflictingMemoryIds: string[];
  conflictType: 'contradiction' | 'update' | 'partial_overlap' | 'none';
  resolution: 'auto_resolved' | 'needs_clarification' | 'kept_both';
  resolvedMemoryId?: string;
  reason: string;
}

/**
 * Importance scoring factors
 */
export interface ImportanceFactors {
  usageWeight: number;
  recencyWeight: number;
  userExplicitSignal: number;
  entityPriorityBoost: number;
  typeWeight: number;
  confidenceWeight: number;
}

/**
 * Memory decay configuration
 */
export interface DecayConfig {
  baseDecayRate: number;          // Daily decay rate (e.g., 0.01 = 1% per day)
  minImportanceThreshold: number; // Below this, memory expires
  inactivityDays: number;         // Days without use before decay accelerates
  reactivationBoost: number;      // Confidence boost when expired memory is recalled
}

/**
 * Derived memory suggestion
 */
export interface DerivedMemorySuggestion {
  inferredText: string;
  sourceMemoryIds: string[];
  confidence: number;
  category: MemoryType;
  reasoning: string;
}

/**
 * Memory analytics/metrics
 */
export interface MemoryMetrics {
  // Counts
  totalMemories: number;
  activeMemories: number;
  outdatedMemories: number;
  mergedMemories: number;
  expiredMemories: number;
  archivedMemories: number;
  derivedMemories: number;
  
  // Operations
  mergeCount: number;
  conflictCount: number;
  decayCount: number;
  reactivationCount: number;
  
  // Quality
  averageConfidence: number;
  averageImportance: number;
  averageLifespanDays: number;
  recallAccuracyScore: number;
  
  // Usage
  totalRecalls: number;
  totalPromptAssemblies: number;
  averageRecallsPerMemory: number;
  
  // Safety
  piiMemoryCount: number;
  encryptedMemoryCount: number;
  
  // Time range
  periodStart: Date;
  periodEnd: Date;
}

/**
 * Scoped recall options with hierarchical fallback
 */
export interface ScopedRecallOptions {
  primaryScope: MemoryScope;
  fallbackScopes?: MemoryScope[];   // Ordered list: project → user → global
  includeArchived?: boolean;
  includeExpired?: boolean;
  reactivateExpired?: boolean;      // Auto-reactivate expired memories if recalled
}

/**
 * Token budget optimizer options
 */
export interface TokenBudgetOptions {
  maxTokens: number;
  priorityOrder: MemoryType[];      // identity > preferences > facts > context
  deduplicateSimilar: boolean;
  minConfidence: number;
  includeMetadata: boolean;
}

/**
 * Background worker status
 */
export interface WorkerStatus {
  name: string;
  isRunning: boolean;
  lastRunAt?: Date;
  nextRunAt?: Date;
  processedCount: number;
  errorCount: number;
  averageProcessingTimeMs: number;
}






