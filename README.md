# Injector Engineering

**Caveman saves tokens in what an agent says. Injector connects code evidence before an agent decides.**

Injector is a small, local-first CLI for coding agents and developers. It creates a structured map of source files, symbols, imports, and likely tests, then ranks relevant evidence for a task. The agent still reads the code, decides what it means, makes any authorized change, and verifies it.

No model API. No network calls. No source edits. No runtime dependencies.

## Quick start

Requires Node.js 18 or later.

```bash
git clone https://github.com/shaonkabir8/injector-engineering.git
cd injector-engineering
npm install -g .
cd /path/to/your/repository
injector map .
injector context . --task "session expiry validation"
```

Or run directly without a global install:

```bash
node /path/to/injector-engineering/bin/injector.js map .
node /path/to/injector-engineering/bin/injector.js context . --task "session expiry validation"
```

`injector map` writes a cache outside the repository, under the user cache directory. Set `INJECTOR_CACHE_HOME` to place caches elsewhere. Use `--out <file>` to write a portable map explicitly; that file contains repository paths and symbol metadata, not source text.

## Commands

```text
injector map [directory] [--out <file>] [--json]
injector context [directory] --task <description> [--map <file>] [--limit <count>]
injector --help
```

The map and context commands print JSON. The context bundle contains ranked candidate files, matching symbols, imports, related tests, and dependency edges. Ranking uses deterministic word overlap; it is not semantic search and is not a diagnosis. Read the cited files and tests before choosing an implementation.

## What it indexes

- JavaScript: `.js`, `.cjs`, `.mjs`, `.jsx`
- TypeScript: `.ts`, `.cts`, `.mts`, `.tsx`
- Python: `.py`

Common generated, dependency, and VCS directories are skipped. Files over 1 MiB are skipped and counted in the map summary. Symbol and test relationships are lightweight lexical hints, not a full language parser.

## Agent workflow

Install or copy [`skills/injector/SKILL.md`](skills/injector/SKILL.md) into your coding agent's skill directory. It activates on `Injector Required` / `Injection Required` and requires retrieving task-focused evidence before repository engineering decisions, then inspecting the actual source and tests.

## Security and privacy

- The CLI has no network code and does not invoke model providers.
- It reads supported source files locally but stores only relative paths, symbol names, import strings, hashes, sizes, and relationships.
- The default cache is outside the repository. A manually exported map can reveal internal path and symbol names; review it before sharing.
- It does not modify application source. `--out` writes only the map file you specify.

## Development

```bash
npm test
```

The project has no third-party runtime dependencies and is released under the MIT License.
