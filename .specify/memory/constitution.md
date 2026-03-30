<!--
SYNC IMPACT REPORT
==================
Version change: [TEMPLATE] → 1.0.0
Modified principles: All (initial population from template placeholders)
Added sections:
  - Core Principles (5 principles derived from CLAUDE.md)
  - Technology Stack & Constraints
  - Development Workflow
  - Governance
Templates requiring updates:
  - .specify/templates/plan-template.md ✅ — Constitution Check section references this constitution
  - .specify/templates/spec-template.md ✅ — No structural misalignment found
  - .specify/templates/tasks-template.md ✅ — Task categories align with principles
Deferred TODOs: None
-->

# Claude Session Analyzer Constitution

## Core Principles

### I. Pipeline Architecture

The tool MUST follow a strictly sequential, single-responsibility pipeline:
**Discovery → Validation → Parsing → Filtering → Selection → Enhancement → Export**

- Each stage MUST have one clearly named module responsible for it.
- Stages MUST NOT reach into adjacent stage responsibilities.
- Adding a new processing step MUST slot into this pipeline rather than bypass it.

**Rationale**: Predictable data flow prevents hidden side-effects and makes each stage independently testable and replaceable.

### II. Two-Phase Metadata Strategy

Session data processing MUST follow a two-phase approach:

- **Phase 1 (Fast)**: Base metadata read from `sessions-index.json` — always available, used for filtering and display.
- **Phase 2 (Enhanced)**: Rich metadata read from `.jsonl` files — opt-in, slower, required for accurate durations and message previews.

Enhanced metadata MUST NOT be loaded unless explicitly requested by the user.

**Rationale**: Reading every `.jsonl` file on startup is prohibitively slow for large project sets. Opt-in enhancement keeps startup fast while allowing depth when needed.

### III. Privacy by Default (NON-NEGOTIABLE)

Any content derived from `.jsonl` files MUST be masked before leaving the tool:

- User directory paths, workspace paths, emails, tokens (40+ chars), IPs, and URLs MUST be redacted using the `SENSITIVE_PATTERNS` array in `src/jsonl-reader.ts`.
- New extraction functions MUST call `maskSensitiveInfo()` before returning content.
- Privacy masking MUST NOT be configurable off via CLI flags.

**Rationale**: Session logs contain paths, credentials, and personal data. Accidental export of raw content is a data-leak risk.

### IV. Test-First Development

New features and bug fixes MUST follow this sequence:

1. Write failing tests (Vitest) covering the behaviour.
2. Get user/reviewer approval on the test cases.
3. Implement until tests pass.
4. Refactor under green tests.

Unit tests live in `tests/unit/`. Integration/discovery tests live in `tests/`.
Tests MUST NOT mock the filesystem when the behaviour under test depends on real file structure (e.g., `.jsonl` scanning, index repair).

**Rationale**: The tool's correctness depends on filesystem interactions that have burned the project before when mocked away.

### V. Simplicity & Progressive Disclosure

- Implement only what the current requirement demands — no speculative abstractions.
- CLI prompts MUST be sequential and one-at-a-time; never dump all options at once.
- The session selection checkbox MUST cap at 50 items to prevent UI freezes.
- New helpers or utilities MUST NOT be created for one-time operations.

**Rationale**: The target users are developers who need quick answers from session logs, not a feature-rich analytics platform. Complexity slows both the tool and development.

## Technology Stack & Constraints

- **Language**: TypeScript (ES2022 modules); all imports use `.js` extensions.
- **Runtime**: Node.js via `tsx` for development; compiled `dist/` for production.
- **Testing**: Vitest — `npm test`, `npm run test:watch`, `npm run test:coverage`.
- **Key libraries**: commander, @inquirer/prompts, glob, csv-stringify, chalk (v5 ESM),
  date-fns, cli-table3.
- **Session formats**: `sessions-index.json` (`{ version, entries }`) and `.jsonl`
  (one JSON object per line with `timestamp` + `message` fields).
- **Output directory**: `dist/` — never commit compiled output.
- New dependencies MUST have a clearly documented purpose and MUST NOT duplicate
  functionality already provided by existing dependencies.

## Development Workflow

- **Discovery entry point**: `src/parser.ts → discoverProjects()`.
- **Validation/repair**: `src/session-index-validator.ts` — always creates a timestamped
  backup before mutating `sessions-index.json`.
- **Filtering & enhancement**: `src/analyzer.ts` — `filterSessions()` then opt-in
  `enhanceSessions()`.
- **Export**: `src/exporters.ts` — supports JSON and CSV; CSV columns are auto-detected.
- **Adding a filter**: update `FilterOptions` (types.ts) → `filterSessions()` (analyzer.ts)
  → `collectFilters()` (index.ts) → add a test in `tests/unit/analyzer.test.ts`.
- **Adding an export field**: update `EnhancedSession` (types.ts) → implement in
  jsonl-reader.ts → call in `enhanceSession()` (analyzer.ts). JSON and CSV auto-pick it up.
- All PRs MUST verify compliance with the Privacy by Default principle before merge.

## Governance

- This constitution supersedes all informal conventions and inline comments.
- Amendments MUST increment the version following semantic versioning:
  - **MAJOR**: Principle removed, renamed, or fundamentally redefined.
  - **MINOR**: New principle or section added, or materially expanded guidance.
  - **PATCH**: Clarifications, wording fixes, non-semantic refinements.
- Amendment procedure: update this file, increment version, update `LAST_AMENDED_DATE`,
  record changes in the Sync Impact Report comment at the top of this file.
- All active feature plans (`specs/*/plan.md`) MUST re-verify their Constitution Check
  section after any MAJOR or MINOR amendment.
- Runtime development guidance lives in `CLAUDE.md` at the repository root.

**Version**: 1.0.0 | **Ratified**: 2026-03-29 | **Last Amended**: 2026-03-29
