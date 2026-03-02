import { callLLMWithJSON } from '../../utils/llm';
import { 
  ExtractedEntity, 
  DetectedRelationship, 
  Memory,
  EntityType,
  MemoryRelationshipType,
} from '../../types';
import {
  getEntityExtractionPrompt,
  getRelationshipDetectionPrompt,
} from './prompts';

/**
 * Memory Knowledge Graph Service
 * Extracts entities, detects relationships, and builds knowledge graphs
 */
class GraphService {
  /**
   * Extract entities from memory text using LLM
   */
  async extractEntities(memoryText: string): Promise<ExtractedEntity[]> {
    try {
      console.log('[GRAPH] Extracting entities from:', memoryText);

      const prompt = `${getEntityExtractionPrompt()}\n\nMemory text to analyze:\n"${memoryText}"\n\nExtract ALL entities and return ONLY the JSON array:`;

      const response = await callLLMWithJSON(prompt, {
        temperature: 0.3, // Lower temperature for more consistent extraction
        max_tokens: 1000,
      });

      // Parse response - handle different formats
      let entities: ExtractedEntity[] = [];
      
      if (Array.isArray(response)) {
        entities = response;
      } else if (response.entities && Array.isArray(response.entities)) {
        entities = response.entities;
      } else if (typeof response === 'object' && response !== null) {
        // Single entity returned
        entities = [response];
      }

      // Validate entities
      const validEntities = entities.filter(entity => {
        return (
          entity.name &&
          entity.type &&
          entity.relevanceScore >= 0 &&
          entity.relevanceScore <= 1 &&
          entity.context
        );
      });

      console.log('[GRAPH] Extracted', validEntities.length, 'valid entities');
      return validEntities;
    } catch (error) {
      console.error('[GRAPH] Error extracting entities:', error);
      return [];
    }
  }

  /**
   * Detect relationships between a new memory and existing memories
   */
  async detectRelationships(
    newMemory: Memory,
    existingMemories: Memory[]
  ): Promise<DetectedRelationship[]> {
    try {
      if (existingMemories.length === 0) {
        return [];
      }

      console.log('[GRAPH] Detecting relationships for new memory');
      console.log('[GRAPH] Comparing with', existingMemories.length, 'existing memories');

      // Build prompt with new memory and existing memories
      const existingMemoriesText = existingMemories.map((mem, idx) => {
        return `Memory ${idx + 1} (ID: ${mem.id}):\n"${mem.canonicalText}"\nType: ${mem.type}\nTags: ${mem.tags.join(', ')}`;
      }).join('\n\n');

      const prompt = `${getRelationshipDetectionPrompt()}

🆕 NEW MEMORY:
"${newMemory.canonicalText}"
Type: ${newMemory.type}
Tags: ${newMemory.tags.join(', ')}

📚 EXISTING MEMORIES:
${existingMemoriesText}

Analyze the new memory against ALL existing memories and detect relationships.
Return ONLY the JSON array (use memory IDs from above):`;

      const response = await callLLMWithJSON(prompt, {
        temperature: 0.3,
        max_tokens: 1500,
      });

      // Parse response
      let relationships: DetectedRelationship[] = [];
      
      if (Array.isArray(response)) {
        relationships = response;
      } else if (response.relationships && Array.isArray(response.relationships)) {
        relationships = response.relationships;
      }

      // Validate relationships
      const validRelationships = relationships.filter(rel => {
        return (
          rel.targetMemoryId &&
          rel.relationshipType &&
          rel.confidence >= 0.6 && // Only keep confident relationships
          rel.confidence <= 1 &&
          rel.reason
        );
      });

      console.log('[GRAPH] Detected', validRelationships.length, 'valid relationships');
      return validRelationships;
    } catch (error) {
      console.error('[GRAPH] Error detecting relationships:', error);
      return [];
    }
  }

  /**
   * Normalize entity name (proper case, trimmed)
   */
  normalizeEntityName(name: string): string {
    // Trim whitespace
    let normalized = name.trim();
    
    // Handle common acronyms (keep uppercase)
    const acronyms = ['AI', 'ML', 'API', 'UI', 'UX', 'CEO', 'CTO', 'NYC', 'USA', 'UK'];
    if (acronyms.includes(normalized.toUpperCase())) {
      return normalized.toUpperCase();
    }

    // Capitalize first letter of each word
    normalized = normalized.split(' ').map(word => {
      if (word.length === 0) return word;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    }).join(' ');

    return normalized;
  }

  /**
   * Check if two entity names are similar (for deduplication)
   */
  areSimilarEntities(name1: string, name2: string): boolean {
    const n1 = name1.toLowerCase().trim();
    const n2 = name2.toLowerCase().trim();
    
    // Exact match
    if (n1 === n2) return true;
    
    // One contains the other
    if (n1.includes(n2) || n2.includes(n1)) return true;
    
    // Handle common abbreviations
    const abbreviations: Record<string, string[]> = {
      'new york': ['ny', 'nyc', 'new york city'],
      'san francisco': ['sf', 'san fran'],
      'los angeles': ['la'],
      'machine learning': ['ml'],
      'artificial intelligence': ['ai'],
    };
    
    for (const [full, abbrevs] of Object.entries(abbreviations)) {
      if (n1 === full && abbrevs.includes(n2)) return true;
      if (n2 === full && abbrevs.includes(n1)) return true;
    }
    
    return false;
  }

  /**
   * Deduplicate extracted entities
   */
  deduplicateEntities(entities: ExtractedEntity[]): ExtractedEntity[] {
    const deduplicated: ExtractedEntity[] = [];
    
    for (const entity of entities) {
      const normalizedName = this.normalizeEntityName(entity.name);
      
      // Check if similar entity already exists
      const existing = deduplicated.find(e => 
        this.areSimilarEntities(normalizedName, e.name) && e.type === entity.type
      );
      
      if (existing) {
        // Merge: keep the one with higher relevance score
        if (entity.relevanceScore > existing.relevanceScore) {
          existing.name = normalizedName;
          existing.relevanceScore = entity.relevanceScore;
          existing.description = entity.description || existing.description;
          existing.context = existing.context + '; ' + entity.context;
        }
      } else {
        // Add new entity
        deduplicated.push({
          ...entity,
          name: normalizedName,
        });
      }
    }
    
    return deduplicated;
  }

  /**
   * Calculate entity importance score based on various factors
   */
  calculateEntityImportance(
    entity: ExtractedEntity,
    memoryCount: number,
    relationshipCount: number
  ): number {
    // Base score from relevance
    let score = entity.relevanceScore * 0.4;
    
    // Boost based on how many memories mention this entity
    const memoryBoost = Math.min(memoryCount * 0.1, 0.4);
    score += memoryBoost;
    
    // Boost based on relationships
    const relationshipBoost = Math.min(relationshipCount * 0.05, 0.2);
    score += relationshipBoost;
    
    // Normalize to 0-1
    return Math.min(score, 1.0);
  }

  /**
   * Determine relationship strength based on common entities and topics
   */
  calculateRelationshipStrength(
    memory1: Memory,
    memory2: Memory
  ): number {
    let strength = 0;
    
    // Check common tags
    const commonTags = memory1.tags.filter(tag => memory2.tags.includes(tag));
    strength += commonTags.length * 0.15;
    
    // Check same type
    if (memory1.type === memory2.type) {
      strength += 0.2;
    }
    
    // Check temporal proximity (memories created close together)
    const timeDiff = Math.abs(
      memory1.createdAt.getTime() - memory2.createdAt.getTime()
    );
    const daysDiff = timeDiff / (1000 * 60 * 60 * 24);
    if (daysDiff < 7) {
      strength += 0.2;
    } else if (daysDiff < 30) {
      strength += 0.1;
    }
    
    // Check text similarity (simple keyword overlap)
    const words1 = new Set(memory1.canonicalText.toLowerCase().split(/\W+/));
    const words2 = new Set(memory2.canonicalText.toLowerCase().split(/\W+/));
    const intersection = new Set([...words1].filter(w => words2.has(w)));
    const union = new Set([...words1, ...words2]);
    const jaccardSimilarity = intersection.size / union.size;
    strength += jaccardSimilarity * 0.3;
    
    // Normalize to 0-1
    return Math.min(strength, 1.0);
  }
}

export const graphService = new GraphService();


















