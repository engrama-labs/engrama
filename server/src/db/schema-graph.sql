-- Memory Knowledge Graph Schema
-- This schema stores entities extracted from memories and their relationships

-- Entities Table (People, Places, Companies, Concepts, etc.)
CREATE TABLE IF NOT EXISTS entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  type VARCHAR(50) NOT NULL, -- person, place, organization, concept, event, product
  description TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Full text search
  search_vector tsvector GENERATED ALWAYS AS (to_tsvector('english', name || ' ' || COALESCE(description, ''))) STORED
);

-- Add constraints
ALTER TABLE entities ADD CONSTRAINT entities_type_check 
  CHECK (type IN ('person', 'place', 'organization', 'concept', 'event', 'product', 'technology', 'skill'));

-- Memory-Entity Links (which entities appear in which memories)
CREATE TABLE IF NOT EXISTS memory_entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_id UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  relevance_score FLOAT DEFAULT 1.0, -- How relevant is this entity to the memory (0-1)
  context TEXT, -- Context in which entity appears
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  UNIQUE(memory_id, entity_id)
);

-- Relationships between memories
CREATE TABLE IF NOT EXISTS memory_relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_memory_id UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  target_memory_id UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  relationship_type VARCHAR(50) NOT NULL, -- related_to, contradicts, supports, updates, supersedes
  confidence FLOAT DEFAULT 0.5, -- Confidence in this relationship (0-1)
  reason TEXT, -- Why are these memories related?
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  UNIQUE(source_memory_id, target_memory_id, relationship_type)
);

-- Add constraints
ALTER TABLE memory_relationships ADD CONSTRAINT memory_relationships_type_check 
  CHECK (relationship_type IN ('related_to', 'contradicts', 'supports', 'updates', 'supersedes', 'references', 'depends_on'));

-- Entity Relationships (how entities relate to each other)
CREATE TABLE IF NOT EXISTS entity_relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  target_entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  relationship_type VARCHAR(50) NOT NULL, -- works_at, located_in, knows, owns, uses, etc.
  confidence FLOAT DEFAULT 0.5,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  UNIQUE(source_entity_id, target_entity_id, relationship_type)
);

-- Create indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type);
CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name);
CREATE INDEX IF NOT EXISTS idx_entities_search ON entities USING gin(search_vector);

CREATE INDEX IF NOT EXISTS idx_memory_entities_memory ON memory_entities(memory_id);
CREATE INDEX IF NOT EXISTS idx_memory_entities_entity ON memory_entities(entity_id);

CREATE INDEX IF NOT EXISTS idx_memory_relationships_source ON memory_relationships(source_memory_id);
CREATE INDEX IF NOT EXISTS idx_memory_relationships_target ON memory_relationships(target_memory_id);
CREATE INDEX IF NOT EXISTS idx_memory_relationships_type ON memory_relationships(relationship_type);

CREATE INDEX IF NOT EXISTS idx_entity_relationships_source ON entity_relationships(source_entity_id);
CREATE INDEX IF NOT EXISTS idx_entity_relationships_target ON entity_relationships(target_entity_id);

-- Function to update entity's updated_at timestamp
CREATE OR REPLACE FUNCTION update_entity_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for entities table
CREATE TRIGGER update_entity_timestamp
  BEFORE UPDATE ON entities
  FOR EACH ROW
  EXECUTE FUNCTION update_entity_timestamp();

-- Function to update relationship's updated_at timestamp
CREATE OR REPLACE FUNCTION update_relationship_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for memory_relationships table
CREATE TRIGGER update_relationship_timestamp
  BEFORE UPDATE ON memory_relationships
  FOR EACH ROW
  EXECUTE FUNCTION update_relationship_timestamp();

-- Views for easy querying

-- View: Memory with its entities
CREATE OR REPLACE VIEW memory_entities_view AS
SELECT 
  m.id as memory_id,
  m.canonical_text,
  m.type as memory_type,
  e.id as entity_id,
  e.name as entity_name,
  e.type as entity_type,
  me.relevance_score,
  me.context
FROM memories m
JOIN memory_entities me ON m.id = me.memory_id
JOIN entities e ON me.entity_id = e.id;

-- View: Entity with all its memories
CREATE OR REPLACE VIEW entity_memories_view AS
SELECT 
  e.id as entity_id,
  e.name as entity_name,
  e.type as entity_type,
  m.id as memory_id,
  m.canonical_text,
  m.type as memory_type,
  me.relevance_score
FROM entities e
JOIN memory_entities me ON e.id = me.entity_id
JOIN memories m ON me.memory_id = m.id;

-- View: Memory relationships with full details
CREATE OR REPLACE VIEW memory_relationships_view AS
SELECT 
  mr.id,
  mr.relationship_type,
  mr.confidence,
  mr.reason,
  m1.id as source_id,
  m1.canonical_text as source_text,
  m1.type as source_type,
  m2.id as target_id,
  m2.canonical_text as target_text,
  m2.type as target_type
FROM memory_relationships mr
JOIN memories m1 ON mr.source_memory_id = m1.id
JOIN memories m2 ON mr.target_memory_id = m2.id;


















