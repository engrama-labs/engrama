import { AgentType, MemoryType, MemorySource } from '../types';

/**
 * Agent Preset Configuration
 * Defines behavior for different agent types without hardcoding domain logic
 */
export interface AgentPreset {
  agentType: AgentType;
  // Which memory categories to store
  allowedCategories: MemoryType[];
  // Confidence threshold for storing memories
  confidenceThreshold: number;
  // Require confirmation before storing
  requiresConfirmation: boolean;
  // Default scope for new memories
  defaultScope: 'user' | 'task' | 'session' | 'agent';
  // Which sources are allowed
  allowedSources: MemorySource[];
  // Can AI source memories be promoted to long-term?
  allowAiPromotion: boolean;
  // Minimum confidence for AI promotion
  aiPromotionThreshold: number;
  // Category-specific rules
  categoryRules: {
    [key in MemoryType]?: {
      requiresConfirmation: boolean;
      confidenceThreshold: number;
      allowedSources: MemorySource[];
    };
  };
}

/**
 * Agent Presets
 * Each preset tunes memory behavior for a specific agent type
 */
export const agentPresets: Record<AgentType, AgentPreset> = {
  /**
   * Coding Agent Preset
   * Focuses on project context, decisions, and preferences
   */
  coding: {
    agentType: 'coding',
    allowedCategories: ['preference', 'decision', 'constraint', 'fact', 'goal', 'context'],
    confidenceThreshold: 0.85,
    requiresConfirmation: false, // Explicit statements don't need confirmation
    defaultScope: 'task', // Project/task-scoped by default
    allowedSources: ['user', 'environment', 'system'],
    allowAiPromotion: false, // Never promote AI output
    aiPromotionThreshold: 1.0, // Never reached
    categoryRules: {
      decision: {
        requiresConfirmation: true, // Decisions need confirmation
        confidenceThreshold: 0.9,
        allowedSources: ['user', 'environment'],
      },
      constraint: {
        requiresConfirmation: false,
        confidenceThreshold: 0.85,
        allowedSources: ['user', 'environment'],
      },
      preference: {
        requiresConfirmation: false,
        confidenceThreshold: 0.8,
        allowedSources: ['user'],
      },
    },
  },

  /**
   * Healthcare Agent Preset
   * Strict source validation, requires confirmation for sensitive info
   */
  healthcare: {
    agentType: 'healthcare',
    allowedCategories: ['fact', 'preference', 'constraint', 'context'],
    confidenceThreshold: 0.9, // Higher threshold for healthcare
    requiresConfirmation: true, // Always require confirmation
    defaultScope: 'user', // User-scoped for patient data
    allowedSources: ['user', 'environment'], // Only user and environment
    allowAiPromotion: false, // Never promote AI output
    aiPromotionThreshold: 1.0,
    categoryRules: {
      fact: {
        requiresConfirmation: true, // Facts need confirmation
        confidenceThreshold: 0.95, // Very high threshold
        allowedSources: ['user', 'environment'],
      },
      preference: {
        requiresConfirmation: true,
        confidenceThreshold: 0.9,
        allowedSources: ['user'],
      },
    },
  },

  /**
   * Support Agent Preset
   * Stores customer preferences and ticket history
   */
  support: {
    agentType: 'support',
    allowedCategories: ['preference', 'fact', 'context', 'history'],
    confidenceThreshold: 0.8,
    requiresConfirmation: false,
    defaultScope: 'task', // Ticket/case-scoped
    allowedSources: ['user', 'environment', 'system'],
    allowAiPromotion: false,
    aiPromotionThreshold: 1.0,
    categoryRules: {
      preference: {
        requiresConfirmation: false,
        confidenceThreshold: 0.8,
        allowedSources: ['user', 'environment'],
      },
      history: {
        requiresConfirmation: false,
        confidenceThreshold: 0.75, // Lower for historical events
        allowedSources: ['user', 'environment', 'system'],
      },
    },
  },

  /**
   * Research Agent Preset
   * Stores facts, context, and goals
   */
  research: {
    agentType: 'research',
    allowedCategories: ['fact', 'context', 'goal', 'constraint'],
    confidenceThreshold: 0.85,
    requiresConfirmation: false,
    defaultScope: 'task', // Research project-scoped
    allowedSources: ['user', 'environment', 'system'],
    allowAiPromotion: false,
    aiPromotionThreshold: 1.0,
    categoryRules: {
      fact: {
        requiresConfirmation: false,
        confidenceThreshold: 0.85,
        allowedSources: ['user', 'environment'],
      },
      goal: {
        requiresConfirmation: false,
        confidenceThreshold: 0.8,
        allowedSources: ['user'],
      },
    },
  },

  /**
   * General Agent Preset
   * Balanced settings for general-purpose agents
   */
  general: {
    agentType: 'general',
    allowedCategories: ['preference', 'decision', 'fact', 'goal', 'context'],
    confidenceThreshold: 0.5, // Lower threshold to capture more information
    requiresConfirmation: false,
    defaultScope: 'user', // User-scoped by default
    allowedSources: ['user', 'environment', 'system'],
    allowAiPromotion: false, // Never promote AI by default
    aiPromotionThreshold: 1.0,
    categoryRules: {
      preference: {
        requiresConfirmation: false,
        confidenceThreshold: 0.5,
        allowedSources: ['user'],
      },
      fact: {
        requiresConfirmation: false,
        confidenceThreshold: 0.5,
        allowedSources: ['user', 'environment'],
      },
      decision: {
        requiresConfirmation: true, // Decisions need confirmation
        confidenceThreshold: 0.6,
        allowedSources: ['user', 'environment'],
      },
    },
  },
};

/**
 * Get agent preset by type
 */
export function getAgentPreset(agentType: AgentType = 'general'): AgentPreset {
  return agentPresets[agentType] || agentPresets.general;
}

/**
 * Check if a memory source is allowed for an agent type
 */
export function isSourceAllowed(
  source: MemorySource,
  agentType: AgentType = 'general'
): boolean {
  const preset = getAgentPreset(agentType);
  return preset.allowedSources.includes(source);
}

/**
 * Check if a memory category is allowed for an agent type
 */
export function isCategoryAllowed(
  category: MemoryType,
  agentType: AgentType = 'general'
): boolean {
  const preset = getAgentPreset(agentType);
  return preset.allowedCategories.includes(category);
}

/**
 * Get confirmation requirement for a memory
 */
export function requiresConfirmation(
  category: MemoryType,
  agentType: AgentType = 'general',
  source: MemorySource = 'user'
): boolean {
  const preset = getAgentPreset(agentType);
  
  // Check category-specific rules first
  const categoryRule = preset.categoryRules[category];
  if (categoryRule) {
    return categoryRule.requiresConfirmation;
  }
  
  // Fall back to preset default
  return preset.requiresConfirmation;
}

/**
 * Get confidence threshold for a memory
 */
export function getConfidenceThreshold(
  category: MemoryType,
  agentType: AgentType = 'general',
  source: MemorySource = 'user'
): number {
  const preset = getAgentPreset(agentType);
  
  // Check category-specific rules first
  const categoryRule = preset.categoryRules[category];
  if (categoryRule) {
    return categoryRule.confidenceThreshold;
  }
  
  // Fall back to preset default
  return preset.confidenceThreshold;
}



