# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 1.x     | Yes       |

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

To report a security issue, email us directly at:

**security@engrama.ai**

Include the following in your report:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

We will acknowledge your report within **48 hours** and aim to release a patch within **7 days** for critical issues.

## Scope

In scope:
- Memory engine API (`server/`)
- Authentication and authorization logic
- API key and JWT handling
- Data leakage between user scopes

Out of scope:
- Hosted cloud infrastructure at `engrama.ai` (report via email)
- Third-party dependencies (report upstream)
- Social engineering attacks

## Responsible Disclosure

We follow responsible disclosure. We ask that you:
- Give us reasonable time to fix the issue before public disclosure
- Avoid accessing or modifying other users' data
- Do not perform denial-of-service attacks

We will credit security researchers in our release notes (with your permission).
