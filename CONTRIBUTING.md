# Contributing to Engrama

Thank you for your interest in contributing to Engrama. This is an open-source project and we welcome contributions from the community.

## Ways to Contribute

- **Bug reports** — open an issue with a clear reproduction case
- **Feature requests** — open an issue describing the problem you want to solve
- **Pull requests** — code contributions following the guidelines below
- **Documentation** — improve docs, fix typos, add examples
- **Community** — answer questions in Discussions

## Development Setup

### Prerequisites

- Node.js 18+
- Docker (for Qdrant and integration tests)
- An OpenAI API key
- A Supabase project

### Local Setup

```bash
git clone https://github.com/engrama-labs/engrama.git
cd engrama

# Set up environment
cp .env.example .env
# Edit .env with your API keys

# Start dependencies
docker compose up qdrant -d

# Install server dependencies
cd server
npm install
npm run dev
```

### Running Tests

```bash
cd server
npm test
```

## Pull Request Guidelines

1. **Fork** the repository and create a branch from `main`
2. **Name your branch** descriptively: `feat/memory-decay`, `fix/recall-ranking`, `docs/quickstart`
3. **Write tests** for new functionality
4. **Keep PRs focused** — one feature or fix per PR
5. **Update documentation** if your change affects the API or behavior
6. **Run the full test suite** before submitting

## Code Style

- TypeScript with strict mode enabled
- Use `prettier` for formatting: `npm run format`
- Use `eslint` for linting: `npm run lint`
- Follow existing patterns in the codebase

## Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add memory decay scheduling
fix: handle empty recall results gracefully
docs: add LangChain integration example
chore: update openai to 4.x
```

## Issue Reporting

When filing a bug, include:
- Engrama version
- Operating system and Node.js version
- Minimal reproduction steps
- Expected vs actual behavior
- Relevant logs or error messages

## Code of Conduct

By participating, you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md).

## License

Contributions are licensed under the [MIT License](LICENSE).
