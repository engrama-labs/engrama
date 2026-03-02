# TypeScript SDK

Install the Engrama TypeScript SDK:

```bash
npm install @engrama-ai/sdk
```

## Usage

```typescript
import { createClient } from '@engrama-ai/sdk';

const engrama = createClient({
  baseURL: 'http://localhost:3000',  // self-hosted
  // baseURL: 'https://api.engrama.io', // hosted
  // apiKey: 'your_api_key',
});

// Store a memory
const result = await engrama.remember({
  userId:  'user_123',
  agentId: 'my-agent',
  content: 'The user prefers dark mode and uses Python.',
  source:  'user',
});
console.log(`Created ${result.memoriesCreated} memory fragments`);

// Retrieve relevant memories
const { memories } = await engrama.recall({
  userId:  'user_123',
  agentId: 'my-agent',
  query:   'What does the user prefer?',
  limit:   5,
});
memories.forEach(m => console.log(m.content, m.type));

// Build a context-aware prompt
const { prompt } = await engrama.assemblePrompt({
  userId:       'user_123',
  agentId:      'my-agent',
  currentInput: 'Help me build a script.',
});
// prompt now contains injected memory context
```

## Full Reference

See the [API Reference](https://engrama.io/docs/api) for all available methods and options.
