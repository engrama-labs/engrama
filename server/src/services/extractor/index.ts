import { MemoryCandidate, MemoryType, AgentType, MemorySource } from '../../types';
import { callLLM, callLLMWithJSON } from '../../utils/llm';
import {
  getExtractionPrompt as getUniversalExtractionPrompt,
  getCanonicalizationPrompt as getUniversalCanonicalizationPrompt,
  getRelevancePrompt as getUniversalRelevancePrompt,
} from './prompts-universal';
import { extractKeywords, extractSimpleEntities } from '../../utils/helpers';
import { 
  getAgentPreset, 
  isCategoryAllowed, 
  requiresConfirmation as getConfirmationRequirement,
  getConfidenceThreshold 
} from '../../config/agent-presets';

interface ExtractionResult {
  type: MemoryType;
  category: MemoryType;
  canonical_text: string;
  confidence: number;
  tags: string[];
  entities?: string[];
  source: MemorySource;
  requiresConfirmation?: boolean;
}

interface RelevanceResult {
  should_store: boolean;
  confidence: number;
  reason: string;
}

/**
 * Memory Extractor Service
 * Determines what should be remembered from raw text
 */
export class MemoryExtractor {
  /**
   * Extract memory candidates from raw text using LLM
   * @param rawText - Text to extract memories from
   * @param agentType - Agent type preset (defaults to 'general')
   * @param source - Source of the text (defaults to 'user')
   */
  async extractMemoryCandidates(
    rawText: string,
    agentType: AgentType = 'general',
    source: MemorySource = 'user'
  ): Promise<MemoryCandidate[]> {
    try {
      console.log('[EXTRACTOR] Extracting memories from text:', rawText);
      
      // Get agent preset
      const preset = getAgentPreset(agentType);
      
      // Filter out AI source if not allowed
      if (source === 'ai' && !preset.allowAiPromotion) {
        console.log('[EXTRACTOR] AI source not allowed for agent type:', agentType);
        return [];
      }
      
      // Extract structured memories using universal prompts
      const extractionPrompt = getUniversalExtractionPrompt(agentType);
      const prompt = `${extractionPrompt}\n\nText to analyze:\n"${rawText}"\n\n🎯 OUTPUT FORMAT REQUIRED:\nReturn ONLY a JSON array. Start with [ and end with ]\nDo NOT add any explanation before or after the JSON.\n\nNow extract ALL facts from the text above and return ONLY the JSON array:`;
      console.log('[EXTRACTOR] Calling OpenAI with extraction prompt...');
      
      const response = await callLLMWithJSON<ExtractionResult[]>(
        prompt,
        'Return a JSON array starting with [ and ending with ]. Extract EVERY fact as separate object in array. Even 1 fact = [{...}]. Multiple facts = [{...},{...},{...}]. NEVER return single object. NEVER wrap in another object. ALWAYS direct array.',
        { temperature: 0.15, maxTokens: 3000 }
      );
      console.log('[EXTRACTOR] OpenAI response:', JSON.stringify(response));
      
      // Validate and map to MemoryCandidate format
      const candidates: MemoryCandidate[] = [];
      
      // Handle different response formats from GPT-5
      let results: ExtractionResult[] = [];
      if (Array.isArray(response)) {
        // Direct array: [{...}, {...}]
        results = response;
      } else if (response && typeof response === 'object') {
        // Check if it's a wrapper object with "memories" key
        const responseObj = response as any;
        if (responseObj.memories && Array.isArray(responseObj.memories)) {
          // Wrapped array: {"memories": [{...}, {...}]}
          results = responseObj.memories;
          console.log('[EXTRACTOR] Found wrapped memories array');
        } else {
          // Single object: {...}
          results = [response as ExtractionResult];
        }
      }
      console.log('[EXTRACTOR] Results array length:', results.length);
      
      for (const result of results) {
        // Skip invalid results (only skip if completely invalid or extremely low confidence)
        if (!result.canonical_text || !result.type) {
          console.log('[EXTRACTOR] Skipping invalid result - missing canonical_text or type');
          continue;
        }
        
        // Very permissive confidence check - we'll filter more strictly later
        if (result.confidence !== undefined && result.confidence < 0.2) {
          console.log('[EXTRACTOR] Skipping very low confidence result:', result.confidence);
          continue;
        }
        
        // Check if category is allowed for this agent type
        const category = result.category || result.type;
        if (!isCategoryAllowed(category, agentType)) {
          console.log('[EXTRACTOR] Category not allowed for agent type:', category, agentType);
          continue;
        }
        
        // Check confidence threshold
        const threshold = getConfidenceThreshold(category, agentType, result.source || source);
        if (result.confidence < threshold) {
          console.log('[EXTRACTOR] Confidence below threshold:', result.confidence, '<', threshold);
          continue;
        }
        
        // Enhance with additional processing
        const entities = result.entities || extractSimpleEntities(result.canonical_text);
        const keywords = extractKeywords(result.canonical_text, 5);
        const allTags = [...new Set([...result.tags, ...keywords])];
        
        // Determine if confirmation is required
        const needsConfirmation = result.requiresConfirmation !== undefined
          ? result.requiresConfirmation
          : getConfirmationRequirement(category, agentType, result.source || source);
        
        const candidate: MemoryCandidate = {
          type: category,
          category: category,
          canonicalText: result.canonical_text,
          confidence: result.confidence,
          tags: allTags,
          entities,
          relevance: true,
          source: result.source || source,
          requiresConfirmation: needsConfirmation,
          agentType: agentType,
        };
        
        candidates.push(candidate);
      }
      
      return candidates;
    } catch (error) {
      console.error('Error extracting memory candidates:', error);
      console.error('Error details:', error instanceof Error ? error.message : String(error));
      // Use fallback extraction when LLM fails
      console.log('[EXTRACTOR] Using fallback extraction');
      return this.fallbackExtraction(rawText);
    }
  }
  
  /**
   * Classify if text is relevant enough to store
   * @param text - Text to classify
   * @param agentType - Agent type preset (defaults to 'general')
   */
  async classifyRelevance(text: string, agentType: AgentType = 'general'): Promise<RelevanceResult> {
    console.log('[CLASSIFIER] Starting relevance classification for:', text);
    // Quick heuristic checks first
    const trimmed = text.trim();
    
    // Too short
    if (trimmed.length < 10) {
      return { should_store: false, confidence: 0.9, reason: 'Text too short' };
    }
    
    // Common non-memorable patterns
    const skipPatterns = [
      /^(ok|okay|sure|yes|no|thanks?|hello|hi|hey)[\s\.\!]*$/i,
      /^(um+|uh+|er+|ah+)[\s\.\!]*$/i,
    ];
    
    for (const pattern of skipPatterns) {
      if (pattern.test(trimmed)) {
        return { should_store: false, confidence: 0.95, reason: 'Generic response' };
      }
    }
    
    // Strong positive indicators
    const positiveIndicators = [
      /\b(prefer|like|love|hate|dislike|want|need|goal|always|never)\b/i,
      /\b(my|i am|i'm|i have|i've)\b/i,
      /\b(remember|don't forget|note that)\b/i,
      /\b(meeting|appointment|deadline|birthday)\b/i,
      /\b(favorite|best|worst)\b/i,
    ];
    
    const hasPositiveIndicator = positiveIndicators.some(pattern => pattern.test(text));
    console.log('[CLASSIFIER] Has positive indicator:', hasPositiveIndicator);
    
    if (hasPositiveIndicator) {
      console.log('[CLASSIFIER] Returning SHOULD_STORE = true');
      return { should_store: true, confidence: 0.85, reason: 'Contains memorable content' };
    }
    
    // Use LLM for borderline cases
    if (trimmed.length > 20 && trimmed.length < 200) {
      try {
        const prompt = getUniversalRelevancePrompt(text, agentType);
        const result = await callLLMWithJSON<RelevanceResult>(prompt, undefined, {
          temperature: 0.2,
          maxTokens: 200,
        });
        
        return result;
      } catch (error) {
        console.error('Error in LLM relevance classification:', error);
        // Default to storing if unsure
        return { should_store: true, confidence: 0.6, reason: 'LLM classification failed, defaulting to store' };
      }
    }
    
    // Default for medium-length text
    return { should_store: true, confidence: 0.7, reason: 'Sufficient length and no skip patterns' };
  }
  
  /**
   * Canonicalize memory text into structured format
   */
  async canonicalizeMemory(rawText: string): Promise<string> {
    try {
      const prompt = getUniversalCanonicalizationPrompt(rawText);
      
      const canonical = await callLLM(prompt, undefined, {
        temperature: 0.3,
        maxTokens: 300,
      });
      
      return canonical.trim();
    } catch (error) {
      console.error('Error canonicalizing memory:', error);
      // Fallback: basic cleanup
      return rawText.trim().replace(/\s+/g, ' ');
    }
  }
  
  /**
   * Fallback extraction when LLM fails
   * Uses pattern matching to extract basic facts from user messages
   */
  private fallbackExtraction(text: string): MemoryCandidate[] {
    const trimmed = text.trim();
    
    if (trimmed.length < 10) return [];
    
    const candidates: MemoryCandidate[] = [];
    
    // Pattern-based extraction for common personal information
    const patterns: { pattern: RegExp; type: MemoryType; extract: (match: RegExpMatchArray) => string }[] = [
      // Name patterns
      { 
        pattern: /\b(?:my name is|i'm|i am)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i,
        type: 'fact',
        extract: (m) => `User's name is ${m[1]}`
      },
      // Location patterns
      { 
        pattern: /\b(?:i live in|i'm from|i am from|i'm in|i am in)\s+([A-Za-z\s]+?)(?:\.|,|$|\band\b)/i,
        type: 'fact',
        extract: (m) => `User lives in ${m[1].trim()}`
      },
      // Work patterns
      { 
        pattern: /\b(?:i work at|i work for|i'm working at)\s+([A-Za-z\s]+?)(?:\.|,|$|\band\b)/i,
        type: 'fact',
        extract: (m) => `User works at ${m[1].trim()}`
      },
      // Family patterns
      { 
        pattern: /\b(?:i have)\s+(\d+)\s+(child(?:ren)?|kids?|son|daughter|brother|sister)/i,
        type: 'fact',
        extract: (m) => `User has ${m[1]} ${m[2]}`
      },
      // Preference patterns
      { 
        pattern: /\b(?:i prefer|i like|i love)\s+([^.,!?]+)/i,
        type: 'preference',
        extract: (m) => `User prefers ${m[1].trim()}`
      },
      // Dislike patterns
      { 
        pattern: /\b(?:i hate|i dislike|i don't like)\s+([^.,!?]+)/i,
        type: 'preference',
        extract: (m) => `User dislikes ${m[1].trim()}`
      },
      // Occupation patterns
      { 
        pattern: /\b(?:i am a|i'm a|i work as a?)\s+([A-Za-z\s]+?)(?:\.|,|$|\band\b)/i,
        type: 'fact',
        extract: (m) => `User is a ${m[1].trim()}`
      },
      // Education patterns
      { 
        pattern: /\b(?:i (?:am|'m) a?\s*(?:college|university|school)\s*(?:dropout|graduate|student))/i,
        type: 'fact',
        extract: (m) => `User is a ${m[0].replace(/^i (?:am|'m) a?\s*/i, '')}`
      },
      // Married/relationship patterns
      { 
        pattern: /\b(?:i (?:am|'m)\s+(?:married|single|divorced|engaged))/i,
        type: 'fact',
        extract: (m) => `User is ${m[0].replace(/^i (?:am|'m)\s+/i, '')}`
      },
      // "I have" patterns for possessions/situations
      { 
        pattern: /\b(?:i have a?)\s+(wife|husband|partner|girlfriend|boyfriend)/i,
        type: 'fact',
        extract: (m) => `User has a ${m[1]}`
      },
    ];
    
    for (const { pattern, type, extract } of patterns) {
      const match = text.match(pattern);
      if (match) {
        try {
          const canonicalText = extract(match);
          if (canonicalText && canonicalText.length > 5) {
            candidates.push({
              type,
              category: type,
              canonicalText,
              confidence: 0.7,
              tags: extractKeywords(canonicalText, 3),
              entities: extractSimpleEntities(canonicalText),
              relevance: true,
              source: 'user',
              requiresConfirmation: false,
              agentType: 'general',
            });
          }
        } catch (e) {
          // Skip this pattern if extraction fails
        }
      }
    }
    
    // If no specific patterns matched but text contains personal indicators, store as general fact
    if (candidates.length === 0) {
      const hasPersonalInfo = /\b(my|i am|i'm|i have|i've|i live|i work|i prefer|i like)\b/i.test(text);
      
      if (hasPersonalInfo && trimmed.length >= 20) {
        // Determine basic type from keywords
        let type: MemoryType = 'fact';
        
        if (/\b(prefer|like|love|hate|favorite)\b/i.test(text)) {
          type = 'preference';
        } else if (/\b(goal|want to|plan to|aim to)\b/i.test(text)) {
          type = 'goal';
        }
        
        candidates.push({
          type,
          category: type,
          canonicalText: trimmed.length > 100 ? trimmed.substring(0, 100) + '...' : trimmed,
          confidence: 0.6,
          tags: extractKeywords(text, 3),
          entities: extractSimpleEntities(text),
          relevance: true,
          source: 'user',
          requiresConfirmation: false,
          agentType: 'general',
        });
      }
    }
    
    console.log('[EXTRACTOR] Fallback extracted', candidates.length, 'candidates');
    return candidates;
  }
  
  /**
   * Extract metadata from memory text
   */
  extractMetadata(text: string, type: MemoryType): Record<string, any> {
    const metadata: Record<string, any> = {};
    
    // Extract dates
    const datePattern = /\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})\b/g;
    const dates = text.match(datePattern);
    if (dates) {
      metadata.mentioned_dates = dates;
    }
    
    // Extract times
    const timePattern = /\b(\d{1,2}:\d{2}\s*(?:am|pm)?)\b/gi;
    const times = text.match(timePattern);
    if (times) {
      metadata.mentioned_times = times;
    }
    
    // Extract URLs
    const urlPattern = /https?:\/\/[^\s]+/g;
    const urls = text.match(urlPattern);
    if (urls) {
      metadata.urls = urls;
    }
    
    // Extract emails
    const emailPattern = /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g;
    const emails = text.match(emailPattern);
    if (emails) {
      metadata.emails = emails;
    }
    
    // Type-specific metadata
    if (type === 'preference') {
      metadata.sentiment = this.detectSentiment(text);
    }
    
    if (type === 'event' || type === 'task') {
      metadata.time_sensitive = true;
    }
    
    return metadata;
  }
  
  /**
   * Simple sentiment detection
   */
  private detectSentiment(text: string): 'positive' | 'negative' | 'neutral' {
    const positiveWords = /\b(love|like|enjoy|prefer|best|great|awesome|good|happy)\b/i;
    const negativeWords = /\b(hate|dislike|worst|bad|terrible|awful|annoying|never)\b/i;
    
    const hasPositive = positiveWords.test(text);
    const hasNegative = negativeWords.test(text);
    
    if (hasPositive && !hasNegative) return 'positive';
    if (hasNegative && !hasPositive) return 'negative';
    return 'neutral';
  }
  
  /**
   * Extract automatic coding tags from text
   */
  private extractCodingTags(text: string, type: MemoryType): string[] {
    const tags: string[] = [];
    const lowerText = text.toLowerCase();
    
    // Framework tags
    if (/\b(next\.?js|nextjs)\b/i.test(text)) tags.push('nextjs', 'framework');
    if (/\b(react)\b/i.test(text)) tags.push('react', 'framework');
    if (/\b(vue\.?js|vue)\b/i.test(text)) tags.push('vue', 'framework');
    if (/\b(angular)\b/i.test(text)) tags.push('angular', 'framework');
    if (/\b(svelte)\b/i.test(text)) tags.push('svelte', 'framework');
    if (/\b(remix)\b/i.test(text)) tags.push('remix', 'framework');
    
    // Language tags
    if (/\b(typescript|ts)\b/i.test(text)) tags.push('typescript', 'language');
    if (/\b(javascript|js)\b/i.test(text)) tags.push('javascript', 'language');
    if (/\b(python|py)\b/i.test(text)) tags.push('python', 'language');
    if (/\b(go|golang)\b/i.test(text)) tags.push('go', 'language');
    if (/\b(rust)\b/i.test(text)) tags.push('rust', 'language');
    
    // Styling tags
    if (/\b(tailwind)\b/i.test(text)) tags.push('tailwind', 'styling');
    if (/\b(css)\b/i.test(text)) tags.push('css', 'styling');
    if (/\b(mui|material-ui)\b/i.test(text)) tags.push('mui', 'styling');
    if (/\b(styled-components)\b/i.test(text)) tags.push('styled-components', 'styling');
    if (/\b(emotion)\b/i.test(text)) tags.push('emotion', 'styling');
    
    // Backend tags
    if (/\b(firebase)\b/i.test(text)) tags.push('firebase', 'backend');
    if (/\b(supabase)\b/i.test(text)) tags.push('supabase', 'backend');
    if (/\b(express)\b/i.test(text)) tags.push('express', 'backend');
    if (/\b(fastapi)\b/i.test(text)) tags.push('fastapi', 'backend');
    if (/\b(django)\b/i.test(text)) tags.push('django', 'backend');
    
    // Database tags
    if (/\b(postgres|postgresql)\b/i.test(text)) tags.push('postgresql', 'database');
    if (/\b(mongodb|mongo)\b/i.test(text)) tags.push('mongodb', 'database');
    if (/\b(mysql)\b/i.test(text)) tags.push('mysql', 'database');
    if (/\b(sqlite)\b/i.test(text)) tags.push('sqlite', 'database');
    
    // Auth tags
    if (/\b(clerk)\b/i.test(text)) tags.push('clerk', 'auth');
    if (/\b(auth0)\b/i.test(text)) tags.push('auth0', 'auth');
    if (/\b(nextauth|next-auth)\b/i.test(text)) tags.push('nextauth', 'auth');
    
    // Infra tags
    if (/\b(vercel)\b/i.test(text)) tags.push('vercel', 'infra');
    if (/\b(aws)\b/i.test(text)) tags.push('aws', 'infra');
    if (/\b(docker)\b/i.test(text)) tags.push('docker', 'infra');
    if (/\b(kubernetes|k8s)\b/i.test(text)) tags.push('kubernetes', 'infra');
    
    // Router tags (Next.js specific)
    if (/\b(app router|app-router)\b/i.test(text)) tags.push('app-router');
    if (/\b(pages router|pages-router)\b/i.test(text)) tags.push('pages-router');
    
    // State management tags
    if (/\b(redux)\b/i.test(text)) tags.push('redux', 'state-management');
    if (/\b(zustand)\b/i.test(text)) tags.push('zustand', 'state-management');
    if (/\b(jotai)\b/i.test(text)) tags.push('jotai', 'state-management');
    if (/\b(recoil)\b/i.test(text)) tags.push('recoil', 'state-management');
    
    // Add category-based tags
    if (type === 'project_config') tags.push('config');
    if (type === 'architectural_decision') tags.push('decision');
    if (type === 'project_convention') tags.push('convention');
    if (type === 'user_coding_preference') tags.push('preference');
    
    return [...new Set(tags)]; // Remove duplicates
  }
}

// Export singleton instance
export const memoryExtractor = new MemoryExtractor();






