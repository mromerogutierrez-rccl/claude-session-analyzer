# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Claude Session Analyzer is an interactive CLI tool that analyzes and exports Claude Code session logs. It parses `sessions-index.json` files, applies filters, and exports session data in JSON or CSV formats with enhanced metadata including accurate duration calculations from `.jsonl` files. The tool includes automatic validation and repair of corrupted session indexes.

## Development Commands

### Local Development
```bash
npm install           # Install dependencies
npm run dev           # Run in development mode with tsx
npm run build         # Compile TypeScript to JavaScript (outputs to dist/)
npm start             # Run compiled code from dist/
```

### Testing
```bash
npm test              # Run all tests
npm run test:watch    # Run tests in watch mode
npm run test:coverage # Run tests with coverage report
```

### Running with Arguments
```bash
npm run dev -- "/path/to/sessions-index.json"
npm run dev -- "~/.claude/projects/*/sessions-index.json"
npm run dev -- "~/.claude/projects/my-project" --auto-repair
npm run dev -- --no-validate  # Skip validation for faster startup
```

### CLI Usage
The main entry point is `src/index.ts` which is registered as the `claude-logs` binary in package.json.

**CLI Options:**
- `--validate` - Validate session indexes before analysis (default: true)
- `--auto-repair` - Automatically repair indexes without prompting (default: false)
- `--no-validate` - Skip validation (faster but may miss sessions)

## Architecture

### High-Level Flow

The application follows a pipeline architecture:
1. **Discovery** → Find Claude project directories and session files
2. **Validation** → Check and repair `sessions-index.json` files if needed
3. **Parsing** → Load sessions from validated index files
4. **Interactive Filtering** → User selects filters (date, branch, message count, search)
5. **Session Selection** → User chooses to export all or specific sessions
6. **Enhancement** → Optionally read `.jsonl` files for accurate metadata
7. **Export** → Write to JSON or CSV format

### Module Responsibilities

**`src/index.ts`** (CLI Entry Point)
- Orchestrates the entire workflow using Commander.js
- Handles all user interaction via @inquirer/prompts
- Coordinates between parser, analyzer, validator, and exporters
- Implements filter collection and session selection UI

**`src/parser.ts`** (Smart Discovery & Parsing)
- **Smart Discovery**: Detects input type (default, directory, file, glob) and discovers projects
- `discoverProjects()` - Main entry point for finding Claude projects
- `detectInputType()` - Determines whether input is directory, file, or glob pattern
- `expandTilde()` - Expands `~` to home directory for path resolution
- `scanAllProjects()` - Scans `~/.claude/projects` for all project directories
- `scanSingleDirectory()` - Validates and loads a single project directory
- `handleGlobPattern()` - Resolves glob patterns to project directories
- Parses `sessions-index.json` files into `SessionEntry` objects
- Extracts unique git branches for filtering

**`src/session-index-validator.ts`** (Index Validation & Repair)
- Addresses Claude Code bug where `sessions-index.json` stops being updated
- `validateSessionIndex()` - Compares index entries against actual `.jsonl` files on disk
- `repairSessionIndex()` - Adds missing sessions and removes stale entries
- `createIndexFromScratch()` - Rebuilds index from all `.jsonl` files
- `parseJsonlMetadata()` - Extracts metadata from `.jsonl` files for index entries
- Creates timestamped backups before making changes (`sessions-index.json.bak-{timestamp}`)
- Handles batch validation/repair across multiple projects

**`src/analyzer.ts`** (Data Processing)
- Filters sessions by date, branch, message count, and search text
- Sorts sessions by creation date (newest first)
- `enhanceSession()` - Enriches individual sessions with `.jsonl` metadata
- `enhanceSessions()` - Batch enhancement using Promise.all for parallel processing
- Orchestrates calls to `jsonl-reader.ts` for timestamp and message extraction

**`src/jsonl-reader.ts`** (Enhanced Metadata Extraction)
- Reads raw `.jsonl` session files line-by-line
- `getFirstAndLastTimestamp()` - Extracts accurate conversation duration
- `getFirstUserMessage()` - Finds first actual user message (skips IDE artifacts)
- `getLastAssistantMessage()` - Extracts final assistant response (excludes tool use)
- `maskSensitiveInfo()` - Privacy protection using `SENSITIVE_PATTERNS`
- Masks: user directories, workspace paths, emails, tokens (40+ chars), IPs, URLs

**`src/date-utils.ts`** (Date Handling)
- `parseStartOfDay()` - Parses date string to start of day (00:00:00.000 UTC)
- `parseEndOfDay()` - Parses date string to end of day (23:59:59.999 UTC)
- `isValidDateRange()` - Validates that end date is not before start date
- `formatDateRange()` - Human-readable date range display
- Critical for inclusive date filtering in "sprint cut" workflows

**`src/exporters.ts`** (Data Export)
- Exports to JSON with pretty printing
- Exports to CSV using csv-stringify with dynamic column detection
- Handles both `SessionEntry` and `EnhancedSession` types

**`src/types.ts`** (Type Definitions)
- `SessionEntry`: Base structure from sessions-index.json
- `EnhancedSession`: Extends SessionEntry with duration, accurate timestamps, first/last messages
- `FilterOptions`: User-selected filtering criteria
- `ExportFormat`: 'json' | 'csv'
- `ProjectInfo`: Project discovery metadata (projectDir, indexPath, sessionCount)
- `ValidationResult`: Results of index validation (orphaned sessions, missing files)
- `RepairResult`: Results of index repair operation

### Key Design Patterns

**Two-Phase Metadata Strategy**: Sessions have base metadata from the index file and optional enhanced metadata from reading the actual `.jsonl` files. Enhanced metadata is opt-in because it's slower (requires reading full session files).

**Progressive Disclosure**: The CLI uses sequential prompts to avoid overwhelming users. Filters are asked one at a time, with sensible defaults.

**Privacy by Default**: When extracting first user messages and last assistant messages, sensitive information is automatically masked using pattern matching before export.

**Smart Input Detection**: The tool automatically detects whether user input is a directory, file path, glob pattern, or default scan, and handles each case appropriately with tilde expansion.

## Important Implementation Details

### TypeScript Configuration
- Uses ES2022 modules (`"type": "module"` in package.json)
- All imports must use `.js` extensions (even for `.ts` files) due to ES module resolution
- Output directory is `dist/`

### Session File Format
- `sessions-index.json`: Contains metadata array in `{ version, entries }` structure
- `.jsonl` files: One JSON object per line with `timestamp` and `message` fields
- User messages have `type: "user"` and `message.role: "user"`
- Message content is an array of content blocks with `type` and `text` fields

### Duration Calculation

The tool calculates duration in two ways:

1. **Index-based** (fast): Uses `created` and `modified` fields from sessions-index.json
2. **Accurate** (slower): Reads all timestamps from `.jsonl` file and uses actual first/last message times

The accurate method is preferred because file modification times may not reflect actual conversation duration.

### Date Filtering (Inclusive Ranges)

**CRITICAL**: Date filtering uses inclusive start and end dates for "sprint cut" workflows.

- `dateFrom`: Parsed using `parseStartOfDay()` → sets time to 00:00:00.000 UTC
- `dateTo`: Parsed using `parseEndOfDay()` → sets time to 23:59:59.999 UTC
- All date comparisons use the `created` field from `SessionEntry`
- Date validation ensures end date is not before start date using `isValidDateRange()`

This ensures that selecting "From: 2026-02-01" and "To: 2026-02-05" includes ALL sessions from the beginning of Feb 1st through the end of Feb 5th.

### Session Index Validation & Repair

**Why this is needed**: Claude Code has a known bug where `sessions-index.json` stops being updated while `.jsonl` session files continue to be created. This causes:

- Sessions missing from the index even though `.jsonl` files exist
- `/resume` command failures with "Session was not found"
- Incomplete data when analyzing sessions

**How validation works**:

1. Scans project directory for all `.jsonl` files
2. Compares against entries in `sessions-index.json`
3. Identifies orphaned sessions (in `.jsonl` but not in index)
4. Identifies stale entries (in index but `.jsonl` file missing)
5. Prompts user to repair (unless `--auto-repair` flag is used)

**How repair works**:

1. Creates timestamped backup: `sessions-index.json.bak-{timestamp}`
2. Parses metadata from orphaned `.jsonl` files using `parseJsonlMetadata()`
3. Adds missing entries to index
4. Removes stale entries
5. Sorts entries by creation date (newest first)

### Privacy Masking Patterns

Located in `jsonl-reader.ts`, the `SENSITIVE_PATTERNS` array defines what to mask:

- User directories: `/Users/username` → `/Users/***`
- Workspace paths: `/Workspace/project` → `/Workspace/***project***`
- Email addresses → `***@***.com`
- Long tokens (40+ chars) → `***TOKEN***`
- IP addresses → `***.***.***.***`
- URLs → Keep structure but mask domain

Applied to both `firstUserMessage` and `lastAssistantMessage` fields.

### Session Selection Limit

When manually selecting sessions, only the first 50 are shown in the checkbox to prevent UI performance issues. This limit is in `selectSessions()` function in [src/index.ts](src/index.ts).

## Dependencies Note

Key libraries and their purposes:

- **commander**: CLI argument parsing with option support
- **@inquirer/prompts**: Interactive prompts (confirm, input, select, checkbox)
- **glob**: File pattern matching with `{ absolute: true }` to get full paths
- **csv-stringify**: CSV generation with automatic header detection
- **chalk**: Terminal colors (v5, ESM-only)
- **date-fns**: Date formatting (`formatDistanceStrict`, `differenceInMilliseconds`, `format`)
- **cli-table3**: Terminal table formatting for project summaries
- **tsx**: TypeScript execution for development (faster than tsc watch)
- **vitest**: Testing framework with coverage support

## Testing

The project uses Vitest for testing. Test files are located in the `tests/` directory:

- `tests/unit/analyzer.test.ts` - Tests for filtering, sorting, and enhancement logic
- `tests/unit/date-utils.test.ts` - Tests for inclusive date range parsing
- `tests/parser-discovery.test.ts` - Tests for smart project discovery
- `tests/session-index-validator.test.ts` - Tests for validation and repair logic

**Running specific tests:**

```bash
npm test -- analyzer.test.ts           # Run specific test file
npm run test:watch                     # Watch mode for TDD
npm run test:coverage                  # Generate coverage report
```

## Common Development Tasks

### Adding a New Filter Type

1. Add the filter parameter to `FilterOptions` in [src/types.ts](src/types.ts)
2. Add the filter logic to `filterSessions()` in [src/analyzer.ts](src/analyzer.ts)
3. Add the interactive prompt to `collectFilters()` in [src/index.ts](src/index.ts)
4. Write tests in `tests/unit/analyzer.test.ts`

### Adding a New Export Field

1. Add the field to `EnhancedSession` in [src/types.ts](src/types.ts)
2. Implement extraction logic in [src/jsonl-reader.ts](src/jsonl-reader.ts)
3. Call extraction function in `enhanceSession()` in [src/analyzer.ts](src/analyzer.ts)
4. The field will automatically appear in JSON exports
5. CSV export will auto-detect the new column

### Modifying Privacy Masking

Edit the `SENSITIVE_PATTERNS` array in [src/jsonl-reader.ts](src/jsonl-reader.ts). Each pattern is an object with:

- `pattern`: RegExp to match sensitive data
- `replacement`: String or function to replace matches

## Active Technologies
- TypeScript (ES2022 modules); `.js` extensions on all imports + Vitest (testing), csv-stringify (CSV export) — no new dependencies needed (001-message-count-breakdown)
- Filesystem (`.jsonl` session files); no index file changes (001-message-count-breakdown)
- TypeScript (ES2022 modules) — all imports use `.js` extensions + date-fns (`formatDistanceStrict`), commander (CLI flag), chalk (terminal output) (002-smart-duration-filter)
- `.jsonl` session files — read-only during enhancement pass (002-smart-duration-filter)

## Recent Changes
- 002-smart-duration-filter: Added `activeDuration` and `activeDurationFormatted` fields to `EnhancedSession` (enhancement-only, absent when skipped). Added `calculateActiveDuration()` in `src/analyzer.ts` that sums message-to-message intervals below the idle gap threshold (default 30 min). Added `--gap-threshold <minutes>` CLI flag. Added `timestamps: string[]` to `AllEnhancedData` return value from `readAllEnhancedData`. CSV columns appear immediately after `durationFormatted`.
- 001-message-count-breakdown: Added TypeScript (ES2022 modules); `.js` extensions on all imports + Vitest (testing), csv-stringify (CSV export) — no new dependencies needed
