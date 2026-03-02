# Python SDK

Install the Engrama Python SDK:

```bash
pip install engrama-sdk
```

## Usage

```python
from engrama import EngramaClient

client = EngramaClient(
    base_url="http://localhost:3000",  # self-hosted
    # base_url="https://api.engrama.ai",  # hosted
    # api_key="your_api_key",
)

# Store a memory
result = client.remember(
    user_id="user_123",
    agent_id="my-agent",
    content="The user prefers concise answers and uses Python.",
    source="user",
)
print(f"Created {result['memoriesCreated']} memory fragments")

# Retrieve relevant memories
memories = client.recall(
    user_id="user_123",
    agent_id="my-agent",
    query="What does the user prefer?",
    limit=5,
)
for m in memories:
    print(m["content"], m["type"])

# Build a context-aware prompt
response = client.assemble_prompt(
    user_id="user_123",
    agent_id="my-agent",
    current_input="Help me write a Python script.",
)
print(response["prompt"])
```

## Full Reference

See the [API Reference](https://engrama.ai/docs/api) for all available methods and options.
