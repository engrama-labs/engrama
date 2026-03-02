-- Migration: Add Universal Memory Engine Fields
-- Adds support for agent types, source tracking, and universal memory categories

-- Add agent_id column (optional agent identifier)
ALTER TABLE memories ADD COLUMN IF NOT EXISTS agent_id VARCHAR(255);

-- Add source column (MANDATORY: user | system | environment | ai)
ALTER TABLE memories ADD COLUMN IF NOT EXISTS source VARCHAR(50) DEFAULT 'user' NOT NULL;

-- Add category column (MANDATORY: universal memory category)
-- This replaces the old type-specific categories with universal ones
ALTER TABLE memories ADD COLUMN IF NOT EXISTS category VARCHAR(50);

-- Update category for existing memories based on type
-- Map old coding-specific types to universal categories
UPDATE memories 
SET category = CASE 
  WHEN type = 'project_config' THEN 'constraint'
  WHEN type = 'architectural_decision' THEN 'decision'
  WHEN type = 'project_convention' THEN 'constraint'
  WHEN type = 'user_coding_preference' THEN 'preference'
  WHEN type = 'goal' THEN 'goal'
  ELSE 'fact'
END
WHERE category IS NULL;

-- Set default category for any remaining nulls
UPDATE memories SET category = 'fact' WHERE category IS NULL;

-- Make category NOT NULL after setting defaults
ALTER TABLE memories ALTER COLUMN category SET NOT NULL;

-- Add agent_type column (optional: coding | healthcare | support | research | general)
ALTER TABLE memories ADD COLUMN IF NOT EXISTS agent_type VARCHAR(50);

-- Add confirmation & promotion pipeline fields
ALTER TABLE memories ADD COLUMN IF NOT EXISTS requires_confirmation BOOLEAN DEFAULT false;
ALTER TABLE memories ADD COLUMN IF NOT EXISTS confirmed BOOLEAN DEFAULT true;
ALTER TABLE memories ADD COLUMN IF NOT EXISTS promoted BOOLEAN DEFAULT false;
ALTER TABLE memories ADD COLUMN IF NOT EXISTS supersedes_memory_id VARCHAR(255);

-- Update scope_type to support new scope types
-- Note: 'project' is now 'task' in the universal model
-- We'll keep both for backward compatibility during migration
-- New memories should use 'task', but we'll accept 'project' for existing data

-- Add check constraint for source (drop first if exists, then add)
DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_source') THEN
    ALTER TABLE memories DROP CONSTRAINT chk_source;
  END IF;
END $$;

ALTER TABLE memories ADD CONSTRAINT chk_source 
  CHECK (source IN ('user', 'system', 'environment', 'ai'));

-- Add check constraint for category (universal memory types)
DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_category') THEN
    ALTER TABLE memories DROP CONSTRAINT chk_category;
  END IF;
END $$;

ALTER TABLE memories ADD CONSTRAINT chk_category 
  CHECK (category IN ('preference', 'decision', 'constraint', 'fact', 'goal', 'context', 'history'));

-- Add check constraint for agent_type
DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_agent_type') THEN
    ALTER TABLE memories DROP CONSTRAINT chk_agent_type;
  END IF;
END $$;

ALTER TABLE memories ADD CONSTRAINT chk_agent_type 
  CHECK (agent_type IS NULL OR agent_type IN ('coding', 'healthcare', 'support', 'research', 'general'));

-- Update scope_type constraint to include 'task' and 'agent'
-- First, drop old constraint if it exists
DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_scope_type') THEN
    ALTER TABLE memories DROP CONSTRAINT chk_scope_type;
  END IF;
END $$;

-- Add new constraint with all scope types
ALTER TABLE memories ADD CONSTRAINT chk_scope_type 
  CHECK (scope_type IN ('user', 'task', 'session', 'agent', 'project')); -- Keep 'project' for backward compatibility

-- Create index for source filtering
CREATE INDEX IF NOT EXISTS idx_memories_source ON memories(user_id, source);

-- Create index for agent_type filtering
CREATE INDEX IF NOT EXISTS idx_memories_agent_type ON memories(user_id, agent_type) WHERE agent_type IS NOT NULL;

-- Create index for category filtering
CREATE INDEX IF NOT EXISTS idx_memories_category ON memories(user_id, category);

-- Create composite index for agent-scoped memories
CREATE INDEX IF NOT EXISTS idx_memories_agent_scope ON memories(user_id, scope_type, scope_id) WHERE scope_type = 'agent';

-- Update provenance to support agent_type in JSONB
-- This is handled in application code, but we ensure the column exists
-- (provenance is already JSONB, so no schema change needed)

COMMENT ON COLUMN memories.source IS 'Memory source: user (user-provided), system (system-generated), environment (environment signals), ai (AI-generated, rarely stored)';
COMMENT ON COLUMN memories.category IS 'Universal memory category: preference, decision, constraint, fact, goal, context, history';
COMMENT ON COLUMN memories.agent_type IS 'Agent type preset: coding, healthcare, support, research, general';
COMMENT ON COLUMN memories.agent_id IS 'Optional specific agent identifier';
COMMENT ON COLUMN memories.requires_confirmation IS 'True if memory was inferred and needs user confirmation';
COMMENT ON COLUMN memories.confirmed IS 'True if user confirmed this memory';
COMMENT ON COLUMN memories.promoted IS 'True if promoted from candidate to long-term memory';
COMMENT ON COLUMN memories.supersedes_memory_id IS 'ID of memory this supersedes (for contradictions)';

