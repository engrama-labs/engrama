-- Migration: Add Scope Support to Memories
-- This migration adds scope_type and scope_id columns to support scoped memory

-- Add scope columns to memories table
ALTER TABLE memories 
ADD COLUMN IF NOT EXISTS scope_type VARCHAR(20) NOT NULL DEFAULT 'user' 
  CHECK (scope_type IN ('user', 'project', 'session')),
ADD COLUMN IF NOT EXISTS scope_id VARCHAR(255) NOT NULL DEFAULT '';

-- Update existing memories to have user scope (migrate existing data)
UPDATE memories 
SET scope_type = 'user', scope_id = user_id 
WHERE scope_type IS NULL OR scope_id IS NULL OR scope_id = '';

-- Create composite index for scope-based queries (critical for performance)
CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories(user_id, scope_type, scope_id);

-- Create index for tenant_id if it exists (for future multi-tenancy)
-- Note: tenant_id may not exist yet, so this is optional
-- CREATE INDEX IF NOT EXISTS idx_memories_tenant_scope ON memories(tenant_id, user_id, scope_type, scope_id);

-- Add comments for documentation
COMMENT ON COLUMN memories.scope_type IS 'Memory scope: user (global preferences), project (project-specific), session (temporary)';
COMMENT ON COLUMN memories.scope_id IS 'Scope identifier: user_id for user scope, project_id for project scope, session_id for session scope';








