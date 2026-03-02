-- Memory Engine Database Schema
-- This SQL file creates the necessary tables for the Memory Engine

-- Create memories table
CREATE TABLE IF NOT EXISTS memories (
    id UUID PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL,
    canonical_text TEXT NOT NULL,
    type VARCHAR(50) NOT NULL CHECK (type IN ('identity', 'profile', 'preference', 'goal', 'fact', 'document', 'location')),
    confidence DECIMAL(3, 2) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    tags TEXT[] DEFAULT '{}',
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    version INTEGER DEFAULT 1,
    ttl TIMESTAMP WITH TIME ZONE,
    provenance JSONB DEFAULT '[]',
    linked_memories TEXT[] DEFAULT '{}',
    conflict_status VARCHAR(20) DEFAULT 'none' CHECK (conflict_status IN ('none', 'conflict', 'resolved')),
    visibility VARCHAR(20) DEFAULT 'private' CHECK (visibility IN ('private', 'shared', 'public')),
    metadata JSONB DEFAULT '{}'
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_memories_user_id ON memories(user_id);
CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
CREATE INDEX IF NOT EXISTS idx_memories_timestamp ON memories(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_memories_created_at ON memories(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_memories_updated_at ON memories(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_memories_confidence ON memories(confidence DESC);
CREATE INDEX IF NOT EXISTS idx_memories_tags ON memories USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_memories_canonical_text ON memories USING GIN(to_tsvector('english', canonical_text));

-- Create composite indexes for common queries
CREATE INDEX IF NOT EXISTS idx_memories_user_type ON memories(user_id, type);
CREATE INDEX IF NOT EXISTS idx_memories_user_timestamp ON memories(user_id, timestamp DESC);

-- Create memory_versions table for version history
CREATE TABLE IF NOT EXISTS memory_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    memory_id UUID NOT NULL,
    version INTEGER NOT NULL,
    canonical_text TEXT NOT NULL,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_memory_versions_memory_id ON memory_versions(memory_id);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger to automatically update updated_at
CREATE TRIGGER update_memories_updated_at BEFORE UPDATE ON memories
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Create view for memory statistics
CREATE OR REPLACE VIEW memory_stats AS
SELECT 
    user_id,
    COUNT(*) as total_memories,
    COUNT(DISTINCT type) as distinct_types,
    AVG(confidence) as avg_confidence,
    MAX(created_at) as latest_memory,
    MIN(created_at) as earliest_memory
FROM memories
GROUP BY user_id;

-- Add comments for documentation
COMMENT ON TABLE memories IS 'Stores all user memories with metadata and provenance';
COMMENT ON COLUMN memories.canonical_text IS 'Canonicalized, structured memory text';
COMMENT ON COLUMN memories.confidence IS 'Confidence score from 0.0 to 1.0';
COMMENT ON COLUMN memories.provenance IS 'Array of source information for this memory';
COMMENT ON COLUMN memories.linked_memories IS 'Array of related memory IDs';

