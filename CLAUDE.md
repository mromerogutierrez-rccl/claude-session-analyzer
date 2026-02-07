# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Claude Session Analyzer is an interactive CLI tool that analyzes and exports Claude Code session logs. It parses `sessions-index.json` files, applies filters, and exports session data in JSON or CSV formats with enhanced metadata including accurate duration calculations from `.jsonl` files.

## Development Commands

### Local Development
```bash
npm install           # Install dependencies
npm run dev           # Run in development mode with tsx
npm run build         # Compile TypeScript to JavaScript (outputs to dist/)
npm start             # Run compiled code from dist/
```

### Running with Arguments
```bash
npm run dev -- "/path/to/sessions-index.json"
npm run dev -- "~/.claude/projects/*/sessions-index.json"
```

### CLI Usage
The main entry point is `src/index.ts` which is registered as the `claude-logs` binary in package.json.

## Architecture

### High-Level Flow

The application follows a pipeline architecture:
1. **Discovery & Parsing** → Find and parse `sessions-index.json` files
2. **Interactive Filtering** → User selects filters (date, branch, message count, search)
3. **Session Selection** → User chooses to export all or specific sessions
4. **Enhancement** → Optionally read `.jsonl` files for accurate metadata
5. **Export** → Write to JSON or CSV format

### Module Responsibilities

**`src/index.ts`** (CLI Entry Point)
- Orchestrates the entire workflow using Commander.js
- Handles all user interaction via @inquirer/prompts
- Coordinates between parser, analyzer, and exporters

**`src/parser.ts`** (Session Discovery)
- Uses glob to find `sessions-index.json` files
- Parses JSON files into `SessionEntry` objects
- Extracts unique git branches for filtering

**`src/analyzer.ts`** (Data Processing)
- Filters sessions by date, branch, message count, and search text
- Sorts sessions by creation date
- Enhances sessions with accurate duration calculations

**`src/jsonl-reader.ts`** (Enhanced Metadata)
- Reads raw `.jsonl` session files line-by-line
- Extracts first/last message timestamps for accurate duration
- Extracts first user message with privacy protection (masks emails, paths, tokens, IPs)
- Privacy masking uses regex patterns in `SENSITIVE_PATTERNS`

**`src/exporters.ts`** (Data Export)
- Exports to JSON with pretty printing
- Exports to CSV using csv-stringify with dynamic column detection
- Handles both `SessionEntry` and `EnhancedSession` types

**`src/types.ts`** (Type Definitions)
- `SessionEntry`: Base structure from sessions-index.json
- `EnhancedSession`: Extends SessionEntry with duration, accurate timestamps, and first user message
- `FilterOptions`: User-selected filtering criteria
- `ExportFormat`: 'json' | 'csv'

### Key Design Patterns

**Two-Phase Metadata Strategy**: Sessions have base metadata from the index file and optional enhanced metadata from reading the actual `.jsonl` files. Enhanced metadata is opt-in because it's slower (requires reading full session files).

**Progressive Disclosure**: The CLI uses sequential prompts to avoid overwhelming users. Filters are asked one at a time, with sensible defaults.

**Privacy by Default**: When extracting first user messages, sensitive information is automatically masked using pattern matching before export.

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

### Date Filtering
All date comparisons use the `created` field. Date inputs from users are parsed as `new Date(string)` and compared directly.

### Privacy Masking Patterns
Located in `jsonl-reader.ts`, the `SENSITIVE_PATTERNS` array defines what to mask:
- User directories: `/Users/username` → `/Users/***`
- Workspace paths: `/Workspace/project` → `/Workspace/***project***`
- Email addresses → `***@***.com`
- Long tokens (40+ chars) → `***TOKEN***`
- IP addresses → `***.***.***.***`
- URLs → Keep structure but mask domain

### Session Selection Limit
When manually selecting sessions, only the first 50 are shown in the checkbox to prevent UI performance issues. This limit is in `selectSessions()` function.

## Dependencies Note

Key libraries and their purposes:
- **commander**: CLI argument parsing
- **@inquirer/prompts**: Interactive prompts (confirm, input, select, checkbox)
- **glob**: File pattern matching with `{ absolute: true }` to get full paths
- **csv-stringify**: CSV generation with automatic header detection
- **chalk**: Terminal colors (v5, ESM-only)
- **date-fns**: Date formatting (`formatDistanceStrict`, `differenceInMilliseconds`, `format`)
- **tsx**: TypeScript execution for development (faster than tsc watch)
