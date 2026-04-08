# Changelog

All notable changes to the Claude Session Analyzer project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - 2026-04-08 — Ordered Export Fields (003-scoped-export)

### BREAKING CHANGE — Fixed 14-Column Export Schema

The CSV (and JSON) export schema is now fixed and deterministic. The following columns have been **removed**:
`fullPath`, `fileMtime`, `firstPrompt`, `firstUserMessage`, `lastAssistantMessage`, `created`, `modified`, `projectPath`, `isSidechain`

The new fixed schema (in order): `sessionId`, `gitBranch`, `projectName`, `messageCount`, `userMessageCount`, `assistantMessageCount`, `toolMessageCount`, `duration`, `durationFormatted`, `activeDuration`, `activeDurationFormatted`, `summary`, `accurateFirstTimestamp`, `accurateLastTimestamp`

**Migration**: Update downstream spreadsheet formulas and BI tool queries to use the new column names and positions.

### Added
- `EXPORT_COLUMNS` constant in `src/exporters.ts` — single source of truth for column order
- `mapSessionToExportRow()` helper — maps any session (base or enhanced) to a 14-field ExportRow with null coalescing
- `projectName` computed column — human-readable project label derived via `path.basename(projectPath)`
- Breaking change notice printed to stdout before every export run
- Schema summary line in export success output: `Schema: 14 columns (sessionId → accurateLastTimestamp)`
- 16 unit tests in `tests/unit/exporters.test.ts` covering all three user stories

### Changed
- `exportToCsv()` — replaced dynamic Set-based column discovery with fixed `EXPORT_COLUMNS` schema
- `exportToJson()` — now maps to `ExportRow` before serializing (consistent schema with CSV)
- `--help` description updated to list all 14 column names
- Version bumped to 2.0.0

---

## [2.0.0] - 2026-02-16

### Added - Task 2: Smart Directory Discovery

#### Major Features
- **Smart directory discovery** - Tool now intelligently detects and scans Claude Code projects without requiring exact file paths
- **Multi-project support** - Automatically discovers and processes all projects in `~/.claude/projects` by default
- **Glob pattern support** - Supports wildcards for matching multiple projects (e.g., `work-*`, `client-*`)
- **Tilde expansion** - Automatically expands `~` and `~/` to home directory in all paths
- **Input type detection** - Automatically determines if input is a directory, file, glob pattern, or default scan

#### New CLI Behavior
- Running `npm run dev` without arguments now scans all projects in `~/.claude/projects`
- Accepts project directory paths directly: `npm run dev ~/.claude/projects/my-project`
- Supports directory glob patterns: `npm run dev ~/.claude/projects/work-*`
- Maintains backwards compatibility with file paths: `npm run dev ~/.claude/projects/my-project/sessions-index.json`

#### New Functions (src/parser.ts)
- `discoverProjects(input?: string)` - Main discovery orchestrator
- `displayProjectsSummary(projects: ProjectInfo[])` - Visual project summary display
- `loadSessionsFromProjects(projects: ProjectInfo[])` - Loads sessions from discovered projects
- `expandTilde(filePath: string)` - Path expansion utility
- `detectInputType(input: string)` - Input type detection
- `scanAllProjects(basePath: string)` - Scans subdirectories for projects
- `scanSingleDirectory(dirPath: string)` - Scans single project directory
- `handleDirectFilePath(filePath: string)` - Legacy file path handler
- `handleGlobPattern(pattern: string)` - Glob pattern handler

#### User Experience Improvements
- Visual project discovery summary with color-coded status (✓ for valid, ⚠ for missing/invalid)
- Projects without session files are automatically filtered out
- Clear, contextual error messages for common issues
- Progress indicators showing project count and session count

### Changed

#### Breaking Changes
- CLI argument description changed from "Glob pattern for sessions-index.json files" to "Project directory, sessions-index.json file, or glob pattern"
- Default behavior changed from searching `*.json` in current directory to scanning `~/.claude/projects`

#### Internal Changes
- Refactored main CLI workflow to use 3-phase architecture:
  1. Discovery phase (find projects)
  2. Validation phase (repair indexes)
  3. Loading phase (parse sessions)
- Removed `findAndParseSessions` from primary workflow (still available for legacy use)
- Enhanced `validateAndRepairProjects` to update `ProjectInfo.indexPath` after repair

### Fixed
- **Bug**: Glob patterns like `*/sessions-index.json` were incorrectly detected as file paths instead of globs
  - **Fix**: Check for glob characters (`*`, `?`, `[`) before checking file extension
- **Bug**: After repairing an index, `ProjectInfo.indexPath` remained `null`, causing "no valid index" warnings
  - **Fix**: Update `ProjectInfo.indexPath` in validator after successful repair

### Documentation
- Added "Smart Directory Discovery" section to README
- Updated "Usage" section with new directory-based examples
- Updated "Sprint Cut Workflow" to use default discovery
- Added comprehensive examples for all discovery modes
- Created TASK-2-IMPLEMENTATION-SUMMARY.md with full technical details

### Testing
- Added 20 new unit tests for discovery functionality
- All 78 tests passing (58 existing + 20 new)
- Test coverage for:
  - Default behavior (scanning all projects)
  - Single directory handling
  - Direct file path support (backwards compatibility)
  - Glob patterns (files and directories)
  - Tilde expansion
  - Edge cases and error handling
  - Multiple project scenarios

### Performance
- Discovery phase: ~50ms for 6 projects
- Total workflow (discovery + validation + loading): ~2.5 seconds for 6 projects with 50 orphaned sessions
- Performance scales linearly with project count

---

## [1.0.0] - 2026-02-16

### Added - Task 1: Session Index Validator & Auto-Repair

#### Major Features
- **Automatic index validation** - Detects orphaned `.jsonl` files not listed in `sessions-index.json`
- **Auto-repair functionality** - Rebuilds missing or corrupted session indexes automatically
- **Backup system** - Creates timestamped backups before modifying any index files
- **Batch validation** - Validates and repairs multiple projects at once
- **Missing file detection** - Identifies and removes stale index entries

#### CLI Options
- `--validate` - Validate session indexes before analysis (default: true)
- `--auto-repair` - Automatically repair indexes without prompting (default: false)
- `--no-validate` - Skip validation for faster startup

#### New Module: src/session-index-validator.ts
- `validateSessionIndex(projectDir: string)` - Validates index against actual files
- `repairSessionIndex(projectDir: string, validationResult: ValidationResult)` - Repairs corrupted index
- `createIndexFromScratch(projectDir: string)` - Builds index from `.jsonl` files
- `validateAndRepairProjects(projects: ProjectInfo[], autoRepair: boolean)` - Batch validation
- `parseJsonlMetadata(filePath: string)` - Extracts metadata from session files
- `backupIndexFile(indexPath: string)` - Creates timestamped backup

#### New Types (src/types.ts)
- `ProjectInfo` - Project directory information
- `ValidationResult` - Validation results with detailed diagnostics
- `RepairResult` - Repair operation results and statistics

#### Metadata Extraction
Extracts comprehensive metadata from `.jsonl` files:
- Session ID
- Message count (user + assistant messages)
- First user prompt
- Custom title (if present)
- Created timestamp (from first message or file creation)
- Modified timestamp (from last message or file modification)
- Full path, file mtime, project path

### Changed

#### Safety Features
- All index modifications create timestamped backups (`sessions-index.json.bak-{timestamp}`)
- Never deletes `.jsonl` files, only modifies indexes
- Preserves all valid existing entries during repair
- Gracefully handles malformed JSON lines in session files

#### User Experience
- Color-coded output (warnings in yellow, success in green)
- Clear status messages for each project
- Interactive prompt for repair confirmation (unless using `--auto-repair`)
- Detailed statistics (sessions added/removed)
- Progress indicators during parsing

### Fixed
- **Issue #25032**: Workaround for Claude Code bug where `sessions-index.json` stops being updated
  - Session files (`.jsonl`) continue to be created but aren't added to the index
  - This causes `/resume` command failures and incomplete session data
  - Tool automatically detects and repairs these corrupted indexes

### Performance
- Validation (synced index): <50ms
- Repair (10 sessions): ~200ms
- Full rebuild (10 sessions): ~250ms
- Parallel parsing overhead: minimal (using `Promise.all`)

### Documentation
- Added "Session Index Validation & Repair" section to README
- Documented CLI options and flags
- Provided example output for validation and repair
- Created TASK-1-IMPLEMENTATION-SUMMARY.md with full technical details

### Testing
- Added 18 unit tests for validator functionality
- All tests passing with 100% coverage of validator module
- Test coverage for:
  - Orphaned session detection
  - Missing file detection
  - Index repair and backup creation
  - Metadata extraction accuracy
  - Error handling for malformed data
  - Sorting by creation date
  - Batch validation

---

## [0.1.0] - Initial Release

### Added
- Interactive CLI for analyzing Claude session logs
- Parse `sessions-index.json` files from Claude Code
- Interactive filtering by:
  - Date range (inclusive from/to dates)
  - Git branches (multi-select)
  - Minimum message count
  - Text search in summaries and prompts
- Session selection (export all or choose specific sessions)
- Enhanced metadata extraction:
  - Accurate duration calculation from `.jsonl` files
  - First user message with privacy protection
  - Last assistant message with privacy protection
  - Precise first/last timestamps from message data
- Multiple export formats (JSON and CSV)
- Privacy protection for sensitive data:
  - User directories masked
  - Email addresses masked
  - API keys and tokens masked
  - IP addresses masked
  - Domain names in URLs masked
- Beautiful CLI with colored output
- Date utilities for inclusive date range filtering
- Comprehensive test suite (39 tests)

### Files
- `src/index.ts` - CLI entry point with interactive prompts
- `src/parser.ts` - Session file parsing
- `src/analyzer.ts` - Duration calculation and filtering
- `src/exporters.ts` - JSON and CSV export
- `src/jsonl-reader.ts` - Enhanced metadata extraction
- `src/types.ts` - TypeScript type definitions
- `src/date-utils.ts` - Date parsing and formatting utilities

---

## Version History Summary

- **v2.0.0** (2026-02-16): Smart Directory Discovery + Session Index Validator
  - 78 total tests, all passing
  - ~370 lines of new discovery code
  - ~375 lines of validator code
  - Major UX improvements with automatic project discovery
  - Real-world impact: Found 50 orphaned sessions across 6 projects (102% increase)

- **v1.0.0** (2026-02-16): Session Index Validator & Auto-Repair
  - 58 total tests, all passing
  - Automatic detection and repair of corrupted indexes
  - Batch validation for multiple projects
  - Comprehensive backup system

- **v0.1.0**: Initial Release
  - Core functionality for session analysis
  - Interactive filtering and export
  - Enhanced metadata with privacy protection

---

## Migration Guide

### Upgrading from v1.0.0 to v2.0.0

**No breaking changes for existing usage patterns.** All previous commands still work.

**New recommended usage:**
```bash
# Old way (still works)
npm run dev "~/.claude/projects/*/sessions-index.json"

# New way (simpler)
npm run dev
```

**Benefits of upgrading:**
- Simpler CLI usage (no need to specify paths)
- Automatic multi-project discovery
- Better error messages and user feedback
- Visual project summary
- More efficient project scanning

### Upgrading from v0.1.0 to v1.0.0+

**Benefits:**
- Automatic detection of missing sessions
- Index repair functionality
- Better data completeness
- No manual intervention needed

**To enable validation:**
```bash
# Validation is enabled by default in v1.0.0+
npm run dev

# To skip validation (faster but may miss sessions)
npm run dev --no-validate

# To auto-repair without prompts
npm run dev --auto-repair
```

---

## Known Issues

### Resolved
- ✅ **Issue #25032** (Claude Code): Corrupted session indexes - Fixed with Task 1 validator
- ✅ **Discovery UX**: Had to specify exact file paths - Fixed with Task 2 directory discovery
- ✅ **ProjectInfo state**: Not updated after repair - Fixed in Task 2 implementation

### Limitations
- Git branch detection not available from `.jsonl` files (field remains empty when creating indexes)
- Large `.jsonl` files (>100MB) may take longer to parse
- Session metadata may not fully preserve all Claude-specific fields

### Workarounds
- For git branch data, ensure indexes are created by Claude Code rather than rebuilt from scratch
- For large files, consider using `--no-validate` if indexes are known to be valid

---

## Contributing

For bug reports and feature requests, please create an issue in the project repository with:
- Version number
- Steps to reproduce
- Expected vs actual behavior
- Relevant log output

## Credits

Developed by: Miguel Romero
Claude Code bug workaround inspired by: `repair-sessions-index.py` script

## License

MIT License - See LICENSE file for details
