# Injector skill

The Injector skill tells a coding agent to consult a structured local code map before making an engineering decision, then inspect the cited source and tests.

It is intentionally separate from Caveman's response-compression skill:

- **Caveman:** reduce outward communication tokens.
- **Injector:** connect code files, symbols, imports, and tests into task-relevant evidence.

Install the CLI from the repository and the skill in the coding agent that should use it. The CLI is retrieval-only; it never edits source code or makes decisions.
