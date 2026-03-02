/**
 * Entity Extraction Prompt
 * Extract entities (people, places, organizations, etc.) from memory text
 */
export function getEntityExtractionPrompt(): string {
  return `You are an Entity Extractor for a Memory Knowledge Graph.

Your task: Extract ALL entities (people, places, organizations, concepts, etc.) from the given memory text.

🎯 ENTITY TYPES:
1. **person** - People, individuals (e.g., "Sarah", "John Smith", "CEO")
2. **place** - Locations, cities, countries (e.g., "Seattle", "NYC", "Office")
3. **organization** - Companies, teams, groups (e.g., "Google", "Microsoft", "Marketing Team")
4. **concept** - Abstract ideas, topics (e.g., "Machine Learning", "Productivity", "Health")
5. **event** - Events, meetings, conferences (e.g., "Y Combinator Interview", "Weekly Standup")
6. **product** - Products, tools, apps (e.g., "iPhone", "Notion", "ChatGPT")
7. **technology** - Technologies, frameworks (e.g., "Python", "React", "Docker")
8. **skill** - Skills, abilities (e.g., "Programming", "Public Speaking")

📋 EXTRACTION RULES:
1. Extract ALL entities mentioned in the text
2. For each entity, provide:
   - **name**: The entity name (normalized, proper case)
   - **type**: One of the 8 types above
   - **description**: Brief 1-sentence description (optional)
   - **relevanceScore**: How relevant is this entity to the memory? (0.0-1.0)
   - **context**: The context/phrase where entity appears

3. Normalize names:
   - "google" → "Google"
   - "new york city" → "New York City"
   - "python programming" → "Python"

4. De-duplicate similar entities:
   - "Python" and "python" → ONE entity: "Python"
   - "NYC" and "New York City" → ONE entity: "New York City"

5. Prioritize important entities:
   - Direct mentions get higher relevanceScore (0.9-1.0)
   - Implied entities get lower relevanceScore (0.5-0.8)

📤 OUTPUT FORMAT:
Return ONLY a JSON array of entities. No explanation before or after.

Example output:
[
  {
    "name": "Google",
    "type": "organization",
    "description": "Technology company",
    "relevanceScore": 0.95,
    "context": "User works at Google"
  },
  {
    "name": "Python",
    "type": "technology",
    "description": "Programming language",
    "relevanceScore": 0.9,
    "context": "User loves Python"
  }
]

✅ GOOD EXAMPLES:

Input: "User works at Google as a software engineer"
Output:
[
  {"name": "Google", "type": "organization", "description": "Technology company", "relevanceScore": 1.0, "context": "works at Google"},
  {"name": "Software Engineer", "type": "skill", "description": "Engineering role", "relevanceScore": 0.9, "context": "as a software engineer"}
]

Input: "User loves Python and React"
Output:
[
  {"name": "Python", "type": "technology", "description": "Programming language", "relevanceScore": 1.0, "context": "loves Python"},
  {"name": "React", "type": "technology", "description": "JavaScript library", "relevanceScore": 1.0, "context": "loves React"}
]

Input: "User subscribed to Tech Burner and Mr Beast on YouTube"
Output:
[
  {"name": "Tech Burner", "type": "person", "description": "YouTube creator", "relevanceScore": 1.0, "context": "subscribed to Tech Burner"},
  {"name": "Mr Beast", "type": "person", "description": "YouTube creator", "relevanceScore": 1.0, "context": "subscribed to Mr Beast"},
  {"name": "YouTube", "type": "product", "description": "Video platform", "relevanceScore": 0.8, "context": "on YouTube"}
]

❌ BAD EXAMPLES:

Bad: Extracting generic words like "user", "is", "the"
Bad: Duplicate entities with different names
Bad: Wrong entity types
Bad: Missing relevanceScore or context`;
}

/**
 * Relationship Detection Prompt
 * Detect relationships between a new memory and existing memories
 */
export function getRelationshipDetectionPrompt(): string {
  return `You are a Memory Relationship Detector for a Knowledge Graph.

Your task: Given a NEW memory and a list of EXISTING memories, detect relationships between them.

🔗 RELATIONSHIP TYPES:
1. **related_to** - Memories are about similar topics
2. **contradicts** - Memories contradict each other (conflict!)
3. **supports** - New memory supports/reinforces the existing memory
4. **updates** - New memory updates/modifies information in existing memory
5. **supersedes** - New memory completely replaces existing memory
6. **references** - New memory references/mentions existing memory
7. **depends_on** - New memory depends on information in existing memory

📋 DETECTION RULES:
1. Compare the new memory with EACH existing memory
2. Look for:
   - **Common entities** (same people, places, organizations)
   - **Common topics** (both about work, hobbies, preferences)
   - **Temporal updates** (old preference vs new preference)
   - **Contradictions** (loves X vs dislikes X)
   - **Dependencies** (needs to know X to understand Y)

3. For each relationship, provide:
   - **targetMemoryId**: ID of the existing memory
   - **relationshipType**: One of the 7 types above
   - **confidence**: How confident are you? (0.0-1.0)
   - **reason**: WHY are they related? (1 sentence)

4. Only detect STRONG relationships:
   - Confidence < 0.6 → Don't include
   - Vague connections → Don't include
   - Obvious connections → Include with high confidence

📤 OUTPUT FORMAT:
Return ONLY a JSON array of relationships. If no relationships found, return [].

Example output:
[
  {
    "targetMemoryId": "mem-123",
    "relationshipType": "related_to",
    "confidence": 0.9,
    "reason": "Both memories are about user's work at Google"
  },
  {
    "targetMemoryId": "mem-456",
    "relationshipType": "contradicts",
    "confidence": 0.95,
    "reason": "New memory says user loves Python, old memory says user dislikes Python"
  }
]

✅ GOOD EXAMPLES:

New: "User works at Google"
Existing: ["User is a software engineer", "User loves Python"]
Output:
[
  {"targetMemoryId": "mem-1", "relationshipType": "related_to", "confidence": 0.85, "reason": "Both about user's professional work"},
  {"targetMemoryId": "mem-2", "relationshipType": "related_to", "confidence": 0.7, "reason": "Python is commonly used at Google for engineering"}
]

New: "User now loves Python"
Existing: ["User dislikes Python"]
Output:
[
  {"targetMemoryId": "mem-1", "relationshipType": "contradicts", "confidence": 0.98, "reason": "Directly contradicts previous dislike of Python"}
]

New: "User wants to learn Machine Learning"
Existing: ["User knows Python", "User works at Google"]
Output:
[
  {"targetMemoryId": "mem-1", "relationshipType": "depends_on", "confidence": 0.8, "reason": "Machine Learning typically requires Python knowledge"},
  {"targetMemoryId": "mem-2", "relationshipType": "related_to", "confidence": 0.7, "reason": "Google is known for Machine Learning work"}
]

❌ BAD EXAMPLES:

Bad: Detecting weak/vague relationships (confidence < 0.6)
Bad: Detecting relationships where none exist
Bad: Wrong relationship types
Bad: Missing reason field`;
}

/**
 * Entity Relationship Detection Prompt
 * Detect relationships between entities based on memories
 */
export function getEntityRelationshipPrompt(): string {
  return `You are an Entity Relationship Detector for a Knowledge Graph.

Your task: Given two entities and their contexts from memories, determine if they have a relationship.

🔗 COMMON ENTITY RELATIONSHIP TYPES:
- **works_at**: Person works at Organization
- **located_in**: Organization/Person located in Place
- **knows**: Person knows Person
- **owns**: Person owns Product
- **uses**: Person/Organization uses Technology
- **member_of**: Person member of Organization
- **created_by**: Product created by Person/Organization
- **part_of**: Place/Organization part of larger entity
- **similar_to**: Entity similar to another entity
- **requires**: Skill requires another skill
- **related_to**: Generic relationship

📋 DETECTION RULES:
1. Analyze the context from both entities
2. Look for explicit or implicit relationships
3. Provide confidence score (0.0-1.0)
4. Only return relationships with confidence >= 0.7

📤 OUTPUT FORMAT:
Return a JSON object:
{
  "hasRelationship": true/false,
  "relationshipType": "type" or null,
  "confidence": 0.0-1.0,
  "reason": "explanation"
}

✅ EXAMPLES:

Entity A: "Google" (organization)
Entity B: "Software Engineer" (skill)
Context A: "User works at Google"
Context B: "User is a Software Engineer"
Output:
{
  "hasRelationship": true,
  "relationshipType": "employs",
  "confidence": 0.9,
  "reason": "User works at Google as a Software Engineer"
}`;
}


















