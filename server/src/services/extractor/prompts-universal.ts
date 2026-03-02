import { AgentType } from '../../types';
import { getAgentPreset } from '../../config/agent-presets';

/**
 * Universal Memory Extraction Prompts
 * Domain-agnostic prompts that adapt to agent type presets
 */

/**
 * Get extraction prompt for a specific agent type
 */
export function getExtractionPrompt(agentType: AgentType = 'general'): string {
  const preset = getAgentPreset(agentType);
  const allowedCategories = preset.allowedCategories.join(', ');
  
  return `You are a Memory Extractor for a UNIVERSAL AI AGENT memory system. Your job is to extract structured, factual information that helps agents remember context, decisions, preferences, and state over time.

🔥 CRITICAL RULES (ALL AGENTS):

1. **ONLY EXTRACT USER-PROVIDED INFORMATION**
   - ✅ DO STORE: What the user explicitly states
   - ✅ DO STORE: What the user confirms ("yes", "correct", "that's right")
   - ✅ DO STORE: What the user corrects ("actually, I prefer X")
   - ❌ DO NOT STORE: AI explanations or suggestions
   - ❌ DO NOT STORE: Boilerplate advice
   - ❌ DO NOT STORE: Generic best practices
   - ❌ DO NOT STORE: AI-generated content

2. **MEMORY ≠ CHAT HISTORY**
   - Store facts and decisions, not conversations
   - Store confirmed choices, not suggestions
   - Store state, not process

3. **REQUIRE EXPLICIT CONFIRMATION FOR INFERRED INFO**
   - If you infer something useful, mark requiresConfirmation: true
   - Only store if user explicitly agrees

4. **SOURCE TRACKING (CRITICAL)**
   - Always mark source: "user" for user-provided information
   - Mark source: "environment" for system/environment signals
   - Mark source: "system" for system-generated state
   - NEVER mark source: "ai" unless explicitly required (and it will be filtered out)

UNIVERSAL MEMORY CATEGORIES (Domain-Agnostic):

1. **preference** - User preferences, likes, dislikes, choices
   - "I prefer TypeScript"
   - "I like dark mode"
   - "I prefer concise explanations"

2. **decision** - Confirmed decisions, choices made
   - "We decided to use Next.js"
   - "We chose Clerk for auth"
   - "We're using PostgreSQL"

3. **constraint** - Constraints, rules, limitations
   - "Must use TypeScript"
   - "No external dependencies"
   - "Must be accessible"

4. **fact** - Objective facts, information
   - "User's name is John"
   - "Project uses Next.js 14"
   - "User lives in NYC"

5. **goal** - Goals, objectives, aspirations
   - "Building a todo app"
   - "Want to learn Python"
   - "Goal is to launch by Q1"

6. **context** - Contextual information, current state
   - "Currently working on login page"
   - "User is in onboarding flow"
   - "Session started at 2pm"

7. **history** - Historical events (low-priority, optional)
   - "User completed onboarding yesterday"
   - "Last login was Monday"

AGENT TYPE: ${agentType.toUpperCase()}
ALLOWED CATEGORIES: ${allowedCategories}
CONFIDENCE THRESHOLD: ${preset.confidenceThreshold}
REQUIRES CONFIRMATION: ${preset.requiresConfirmation ? 'Yes (by default)' : 'No (unless inferred)'}

EXTRACTION EXAMPLES:

✅ GOOD - User explicitly states:
Input: "I prefer TypeScript over JavaScript"
Extract:
[
  {
    "type": "preference",
    "category": "preference",
    "canonical_text": "User prefers TypeScript over JavaScript",
    "confidence": 0.95,
    "tags": ["typescript", "javascript", "preference"],
    "source": "user",
    "requiresConfirmation": false
  }
]

✅ GOOD - Decision:
Input: "We decided to use Next.js for this project"
Extract:
[
  {
    "type": "decision",
    "category": "decision",
    "canonical_text": "Project uses Next.js framework",
    "confidence": 0.95,
    "tags": ["nextjs", "framework", "decision"],
    "source": "user",
    "requiresConfirmation": false
  }
]

✅ GOOD - Fact:
Input: "My name is Sarah and I work at Google"
Extract:
[
  {
    "type": "fact",
    "category": "fact",
    "canonical_text": "User's name is Sarah",
    "confidence": 0.95,
    "tags": ["name", "identity"],
    "source": "user",
    "requiresConfirmation": false
  },
  {
    "type": "fact",
    "category": "fact",
    "canonical_text": "User works at Google",
    "confidence": 0.95,
    "tags": ["work", "company", "google"],
    "source": "user",
    "requiresConfirmation": false
  }
]

✅ GOOD - Goal:
Input: "I want to build a todo app"
Extract:
[
  {
    "type": "goal",
    "category": "goal",
    "canonical_text": "User wants to build a todo app",
    "confidence": 0.9,
    "tags": ["goal", "todo", "app"],
    "source": "user",
    "requiresConfirmation": false
  }
]

❌ BAD - AI suggestion (DO NOT STORE):
Input: "You could use Next.js for this project"
Extract: []  // This is AI suggestion, not user decision

❌ BAD - AI explanation (DO NOT STORE):
Input: "Next.js is a React framework that provides server-side rendering"
Extract: []  // This is explanation, not user information

✅ GOOD - Inferred but marked for confirmation:
Input: "I'm building a Next.js app" (user didn't explicitly say TypeScript, but code shows .tsx files)
Extract:
[
  {
    "type": "fact",
    "category": "fact",
    "canonical_text": "Project uses TypeScript (inferred from .tsx files)",
    "confidence": 0.75,
    "tags": ["typescript", "language"],
    "source": "environment",
    "requiresConfirmation": true  // Mark for user confirmation
  }
]

For EACH memory extracted, provide:
1. type: ONE of the categories above (must be in allowed categories: ${allowedCategories})
2. category: Same as type (for consistency)
3. canonical_text: ONE SHORT SENTENCE stating the fact (max 25 words)
4. confidence: ${preset.confidenceThreshold}+ for direct statements, 0.7-0.8 for inferred
5. tags: 2-6 relevant keywords
6. source: "user" | "environment" | "system" (NEVER "ai" unless explicitly required)
7. requiresConfirmation: true if inferred, false if explicit

⚠️ MANDATORY FORMAT: ALWAYS return a JSON ARRAY starting with [ and ending with ] ⚠️

If NOTHING worth remembering (AI suggestions, explanations, generic advice), return: []

🎯 REMEMBER: Only extract what the USER explicitly states or confirms. Never store AI output as fact. Always track source correctly.`;
}

/**
 * Get canonicalization prompt (universal)
 */
export function getCanonicalizationPrompt(text: string): string {
  return `You are a Memory Canonicalizer for a UNIVERSAL AI AGENT memory system. Convert text into a SHORT, FACTUAL, DECLARATIVE statement.

STRICT RULES:
1. Output EXACTLY 1 SENTENCE
2. Maximum 25 words
3. Write as a FACT, not a story
4. Use third-person ("User prefers...", "Project uses...", "User's name is...")
5. Remove ALL conversational tone
6. Be declarative and concise
7. Domain-agnostic (works for any agent type)

EXAMPLES:

❌ BAD: "The user mentioned that they're thinking about using Next.js for their project"
✅ GOOD: "User prefers Next.js framework"

❌ BAD: "Yeah, so I'm building a todo app and I want to use TypeScript"
✅ GOOD: "User wants to build a todo app using TypeScript"

❌ BAD: "We decided that we should probably use Tailwind for styling"
✅ GOOD: "Project uses Tailwind for styling"

✅ GOOD: "User's name is Sarah"
✅ GOOD: "User prefers TypeScript over JavaScript"
✅ GOOD: "Project uses Next.js 14 with App Router"
✅ GOOD: "User works at Google"
✅ GOOD: "User wants to learn Python"

Now canonicalize this text into ONE SHORT SENTENCE (max 25 words):

Text: "${text}"`;
}

/**
 * Get conflict resolution prompt (universal)
 */
export function getConflictResolutionPrompt(oldMemory: string, newMemory: string): string {
  return `You are a Memory Conflict Resolver for a UNIVERSAL AI AGENT memory system. Two memories describe related information but contain different or contradictory details.

OLD MEMORY: ${oldMemory}
NEW MEMORY: ${newMemory}

Analyze both memories and determine the best action:

1. **overwrite** - The new memory completely replaces the old one (e.g., updated preference, corrected fact, changed decision)
2. **merge** - Both memories contain partial truth and should be combined
3. **mark_conflict** - The memories genuinely conflict and cannot be reconciled
4. **keep_both** - Both memories are valid but describe different aspects or time periods

Rules:
- Newer information often supersedes older
- More specific information is often more accurate
- Higher confidence memories may be more reliable
- Different scopes may allow both to coexist

Respond ONLY in this JSON format:
{
  "action": "overwrite" | "merge" | "mark_conflict" | "keep_both",
  "reason": "Brief explanation of your decision",
  "merged_text": "If action is 'merge', provide the merged canonical text",
  "confidence": 0.0-1.0
}`;
}

/**
 * Get relevance classification prompt (universal)
 */
export function getRelevancePrompt(text: string, agentType: AgentType = 'general'): string {
  const preset = getAgentPreset(agentType);
  
  return `You are a Memory Relevance Classifier for a UNIVERSAL AI AGENT memory system. Determine if a piece of information is worth storing for long-term memory.

AGENT TYPE: ${agentType.toUpperCase()}
ALLOWED CATEGORIES: ${preset.allowedCategories.join(', ')}
CONFIDENCE THRESHOLD: ${preset.confidenceThreshold}

STRONG YES signals (store these):
- Explicit user statements ("I prefer...", "My name is...", "We use...")
- Confirmed decisions ("We decided to...", "We chose...")
- User preferences ("I like...", "I prefer...", "I want...")
- Facts about user or context ("User works at...", "Project uses...")
- Goals and objectives ("I want to...", "Goal is...")
- User corrections ("Actually, I prefer...", "Change that to...")

STRONG NO signals (do NOT store):
- AI suggestions ("You could use...", "I recommend...")
- AI explanations ("X is a framework that...")
- Generic best practices ("It's best to use...")
- Boilerplate advice ("Always use...")
- Questions without answers
- Generic acknowledgments ("okay", "sure", "thanks")
- Casual conversation fillers

Analyze this text and respond with JSON:
{
  "should_store": true | false,
  "confidence": 0.0-1.0,
  "reason": "Brief explanation",
  "requiresConfirmation": true | false  // true if inferred, false if explicit
}

Text: "${text}"`;
}



