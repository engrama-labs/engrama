"""
Engrama — LangChain Memory Integration Example

This example shows how to use Engrama as the memory backend
for a LangChain-powered conversational agent.

Prerequisites:
    pip install langchain langchain-openai requests

    Engrama server running on localhost:3000
    (run `docker compose up` from the repo root)

Usage:
    export OPENAI_API_KEY=sk-...
    python main.py
"""

import os
import requests
from langchain_openai import ChatOpenAI
from langchain.schema import HumanMessage, SystemMessage

ENGRAMA_URL = os.getenv("ENGRAMA_URL", "http://localhost:3000")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")

USER_ID  = "langchain-demo-user"
AGENT_ID = "langchain-agent"


def remember(content: str) -> dict:
    """Store a memory in Engrama."""
    response = requests.post(f"{ENGRAMA_URL}/api/remember", json={
        "userId":  USER_ID,
        "agentId": AGENT_ID,
        "content": content,
        "source":  "user",
    })
    response.raise_for_status()
    return response.json()


def recall(query: str, limit: int = 5) -> list:
    """Retrieve relevant memories from Engrama."""
    response = requests.post(f"{ENGRAMA_URL}/api/recall", json={
        "userId":  USER_ID,
        "agentId": AGENT_ID,
        "query":   query,
        "limit":   limit,
    })
    response.raise_for_status()
    return response.json().get("memories", [])


def assemble_prompt(user_message: str) -> str:
    """Build a context-aware prompt by injecting relevant memories."""
    response = requests.post(f"{ENGRAMA_URL}/api/assemble_prompt", json={
        "userId":       USER_ID,
        "agentId":      AGENT_ID,
        "currentInput": user_message,
    })
    response.raise_for_status()
    return response.json().get("prompt", user_message)


def check_server() -> bool:
    try:
        r = requests.get(f"{ENGRAMA_URL}/health", timeout=3)
        return r.status_code == 200
    except Exception:
        return False


def main():
    print("\n Engrama + LangChain Integration Demo")
    print("=" * 50)

    if not check_server():
        print(f" Cannot reach Engrama at {ENGRAMA_URL}")
        print(" Start with: docker compose up")
        return

    print(f" Connected to Engrama at {ENGRAMA_URL}")

    llm = ChatOpenAI(
        model="gpt-4o",
        temperature=0.7,
        api_key=OPENAI_API_KEY,
    )

    # Seed some memories about the user
    seed_facts = [
        "The user is building an AI research assistant.",
        "The user prefers concise, technical explanations.",
        "The user's primary language is Python.",
    ]
    print("\n Seeding demo memories...")
    for fact in seed_facts:
        result = remember(fact)
        print(f"   Stored: {fact[:60]}...")

    # Run a conversation loop
    print("\nType your message (or 'quit' to exit):\n")
    while True:
        user_input = input("You: ").strip()
        if not user_input or user_input.lower() == "quit":
            print("Goodbye!")
            break

        # Automatically store what the user says
        remember(user_input)

        # Retrieve context-aware prompt from Engrama
        context_prompt = assemble_prompt(user_input)

        # Pass enriched prompt to LangChain LLM
        messages = [
            SystemMessage(content="You are a helpful AI assistant with persistent memory."),
            HumanMessage(content=context_prompt),
        ]

        response = llm.invoke(messages)
        print(f"\nAssistant: {response.content}\n")

        # Store the assistant's response as a memory too
        remember(f"Assistant responded: {response.content[:200]}")


if __name__ == "__main__":
    main()
