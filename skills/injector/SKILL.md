---
name: injector
description: Required evidence-first workflow for codebase decisions. Builds and retrieves a local structured map of files, symbols, imports, and tests. Activate on "Injector Required" or before repository engineering work.
---

# Injector

## Activation

- Activate when the user says **“Injector Required”** or **“Injection Required,”** and before making decisions on repository engineering work.
- For an explicit invocation, acknowledge it once with `INJECTOR MODE = ACTIVE`.
- Do not activate for unrelated conversational questions that do not involve a repository decision.

## Purpose

Caveman reduces the tokens an agent spends communicating outward. Injector organizes the code evidence agents use internally before they decide what to do. They complement each other; Injector does not rewrite replies or make implementation decisions.

## Required workflow

Before deciding on a repository change:

1. Reuse the local map when it is known to match the current repository state; otherwise run `injector map <repository>`.
2. Retrieve task-focused evidence with `injector context <repository> --task "<goal>"`.
3. Inspect the candidate files, symbols, dependencies, and tests directly. Treat scores and links as leads, not confirmed causes.
4. Choose the smallest evidence-supported action, make only the authorized change, and verify it with the repository's existing checks.
5. If verification fails or is incomplete, retrieve the missing evidence, revise the decision, and verify again. Stop when the result is verified.
6. If the CLI is unavailable, follow the same evidence-first steps manually and say so; do not claim the CLI or an unavailable agent ran.

## Safety and limits

- The CLI reads local JavaScript, TypeScript, and Python files. It does not send source to a model, network, or external service.
- Its cache contains relative paths, symbol names, imports, relationships, file hashes, and sizes—not source text. By default, the cache is outside the repository.
- Indexing and retrieval do not edit source files. They do not authorize edits, deployments, or production changes.
- The map is a lightweight lexical index, not a full parser, semantic search system, diagnosis, or proof. Verify source behavior and tests before deciding.
- Keep the map current after code changes. Do not reuse it as evidence if the relevant files have changed.
