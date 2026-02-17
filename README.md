# Claude Session Analyzer

An interactive CLI tool to analyze and export Claude session logs with filtering, session selection, and enhanced metadata capabilities.

## Features

- 🔍 **Parse Claude session logs** from `sessions-index.json` files
- 🔧 **Auto-repair corrupted indexes** - automatically detects and fixes missing session entries
- 🎯 **Interactive filtering** by date range, git branches, message count, and text search
- ✅ **Session selection** - export all or choose specific sessions
- 📊 **Enhanced metadata** - calculate session duration (created to modified timestamps)
- 📤 **Multiple export formats** - JSON and CSV
- 🎨 **Beautiful CLI** with colored output and intuitive prompts

## Installation

### Local Development

```bash
git clone https://github.com/mromerogutierrez-rccl/claude-session-analyzer
```

```bash
npm run install & npm run build
```

### Run Locally

```bash
npm run dev -- "/path/to/sessions-index.json"
```

You can find your Claude's chat session in `~/.claude/projects/<PROYECT_NAME>/sessions-index.json`

## Usage

### Basic Usage

Analyze all sessions across all Claude Code projects:

```bash
npm run dev
```

By default, the tool scans `~/.claude/projects` and discovers all project directories automatically.

### Analyze a Specific Project

Provide a project directory path:

```bash
npm run dev ~/.claude/projects/my-project
```

The tool automatically finds the `sessions-index.json` file in the project directory. If it's missing or corrupted, it will offer to repair it.

### Advanced Patterns

**Analyze multiple projects with glob:**

```bash
npm run dev "~/.claude/projects/work-*"
```

**Legacy: Direct file path (still supported):**

```bash
npm run dev "~/.claude/projects/my-project/sessions-index.json"
```

**Glob pattern for multiple files:**

```bash
npm run dev "~/.claude/projects/*/sessions-index.json"
```

### CLI Options

The tool supports several command-line options to control validation and repair behavior:

```bash
npm run dev -- [pattern] [options]
```

**Options:**

- `--validate` - Validate session indexes before analysis (default: true)
- `--auto-repair` - Automatically repair indexes without prompting (default: false)
- `--no-validate` - Skip validation for faster startup (not recommended if you've experienced index issues)

**Examples:**

```bash
# Auto-repair mode (no prompts, useful for scripts/automation)
npm run dev -- "~/.claude/projects/*/sessions-index.json" --auto-repair

# Skip validation for faster startup
npm run dev -- "~/.claude/projects/*/sessions-index.json" --no-validate
```

## Smart Directory Discovery

The tool intelligently discovers Claude Code projects and session files without requiring you to specify exact paths.

### How Discovery Works

1. **Default Behavior** - Scans `~/.claude/projects` for all project directories
2. **Single Project** - Accepts a project directory path directly
3. **Glob Patterns** - Supports wildcards for matching multiple projects
4. **Legacy Support** - Still accepts direct `sessions-index.json` file paths

### Discovery Examples

**Scan all projects (default):**

```bash
npm run dev
# Automatically discovers all projects in ~/.claude/projects
```

**Scan a specific project:**

```bash
npm run dev ~/.claude/projects/my-work-project
# Discovers sessions-index.json in the specified directory
```

**Scan projects matching a pattern:**

```bash
npm run dev ~/.claude/projects/client-*
# Discovers all projects starting with "client-"
```

**Use tilde expansion:**

```bash
npm run dev ~/custom-claude-projects
# Expands ~ to your home directory
```

### What Gets Discovered

The tool shows you what it found:

```text
📁 Discovered Projects:

  ✓ project-1 - index found
  ⚠ project-2 - no index (will validate)
  ✓ project-3 - index found
```

- ✓ Green checkmark = Valid `sessions-index.json` found
- ⚠ Yellow warning = No index or corrupted (will be repaired if validation enabled)

Projects without any session files (`.jsonl` files) are automatically skipped.

## Session Index Validation & Repair

### The Problem

Claude Code has a known bug ([issue #25032](https://github.com/anthropics/claude-code/issues/25032)) where `sessions-index.json` stops being updated while `.jsonl` session files continue to be created. This causes:

- Sessions missing from the index even though `.jsonl` files exist on disk
- `/resume` command failures with "Session was not found"
- Incomplete data when analyzing sessions

### Automatic Detection & Repair

This tool automatically detects and repairs corrupted session indexes:

1. **Validation Phase**: Scans for `.jsonl` files not listed in `sessions-index.json`
2. **Detection**: Identifies orphaned sessions and missing files
3. **User Prompt**: Asks if you want to repair the index (unless using `--auto-repair`)
4. **Repair**: Adds missing sessions and removes stale entries
5. **Backup**: Creates a backup file before making changes (`sessions-index.json.bak-{timestamp}`)

**What gets repaired:**

- ✅ Adds sessions found in `.jsonl` files but missing from index
- ✅ Removes index entries where `.jsonl` files no longer exist
- ✅ Rebuilds the entire index if it's missing or corrupted
- ✅ Preserves all existing valid entries

**Example output:**

```bash
🔎 Validating session indexes...
  ⚠️  my-project: 5 sessions not in index
  ⚠️  my-project: 2 index entries have missing files

? Repair session indexes? › Yes

📝 Repairing indexes...
  ✓ my-project: +5 added, -2 removed
  Backups saved as sessions-index.json.bak-{timestamp}
```

### When to Use Validation

**Always enabled by default** - The tool validates indexes before analysis to ensure you get complete data.

**Skip validation** (`--no-validate`) only when:

- You're certain your indexes are up to date
- You need faster startup times
- You're running on a read-only filesystem

**Auto-repair mode** (`--auto-repair`) is useful for:

- Scripts and automation (no manual prompts)
- CI/CD pipelines
- Batch processing multiple projects

### Interactive Workflow

The tool will guide you through:

1. **Filtering options:**
   - **Date range (from/to)**: Both dates are INCLUSIVE. Selecting `From: 2026-02-01` and `To: 2026-02-05` includes all sessions from the beginning of Feb 1st through the end of Feb 5th (UTC timezone). Perfect for "sprint cut" workflows where you want to capture all work within specific date boundaries.
   - Git branches (multi-select)
   - Minimum message count
   - Text search in summaries/prompts

2. **Session selection:**
   - Export all filtered sessions
   - Manually select specific sessions

3. **Enhanced metadata:**
   - Choose to include accurate duration calculations
   - Reads actual `.jsonl` files to get first and last message timestamps
   - Duration in milliseconds and human-readable format
   - Extracts first user message and last assistant message
   - More accurate than sessions-index.json metadata

4. **Export configuration:**
   - Format: JSON or CSV
   - Output filename (with timestamp default)
   - Output directory (defaults to current directory)

## Session Metadata

### Base Metadata (from sessions-index.json)

- `sessionId` - Unique session identifier
- `fullPath` - Full path to the session .jsonl file
- `fileMtime` - File modification time (Unix timestamp)
- `firstPrompt` - First user prompt in the session
- `summary` - Session summary
- `messageCount` - Number of messages in the session
- `created` - Session creation timestamp (ISO 8601)
- `modified` - Session last modification timestamp (ISO 8601)
- `gitBranch` - Git branch during the session
- `projectPath` - Project path
- `isSidechain` - Whether this is a sidechain session

### Enhanced Metadata (optional)

When you enable enhanced metadata, the tool reads the actual `.jsonl` session files to extract precise information:

- `duration` - **Accurate** duration in milliseconds (calculated from first to last message)
- `durationFormatted` - Human-readable duration (e.g., "2 hours", "45 minutes", "2 days")
- `accurateFirstTimestamp` - Actual timestamp of the first message from .jsonl file
- `accurateLastTimestamp` - Actual timestamp of the last message from .jsonl file
- `firstUserMessage` - The actual first user message text (extracted and privacy-protected)
- `lastAssistantMessage` - The final assistant response text (extracted and privacy-protected, excludes tool use)

**Why accurate timestamps matter:** The `created` and `modified` fields in `sessions-index.json` may not reflect the actual first and last message times. This tool parses each session's `.jsonl` file to get the precise timestamps, ensuring accurate duration calculations.

#### Privacy Protection

Both `firstUserMessage` and `lastAssistantMessage` fields automatically mask sensitive information to protect privacy:

- User directories (`/Users/username` → `/Users/***`)
- Workspace/project names (`/Workspace/project-name` → `/Workspace/***project***`)
- Email addresses (`user@company.com` → `***@***.com`)
- API keys and long tokens (40+ character strings)
- IP addresses
- Domain names in URLs

Code file paths and relative paths within the project are preserved to maintain context.

## Examples

### Export all sessions with duration data to CSV

```bash
npm run dev
# Discovers all projects automatically
# Select "No" for all filters
# Select "Export all filtered sessions"
# Select "Yes" for enhanced metadata
# Select "CSV" format
# Accept default filename and directory
```

### Export specific sessions from a date range

```bash
npm run dev
# Filter by date: Yes
#   From: 2026-01-01
#   To: 2026-01-31
# Filter by branch: No
# Filter by message count: Yes
#   Minimum: 5
# Select specific sessions from the list
# Include enhanced metadata: Yes
# Format: JSON
```

### Search sessions and export as JSON

```bash
npm run dev
# Filter by date: No
# Filter by branch: No
# Filter by message count: No
# Search text: Yes
#   Search: "authentication"
# Export all filtered sessions
# Enhanced metadata: Yes
# Format: JSON
```

## Output Format Examples

### JSON Output (with enhanced metadata)

```json
[
  {
    "sessionId": "18d0ad4a-073d-43e3-9767-2dfd2e8d6f63",
    "fullPath": "/Users/***/projects/.../18d0ad4a-073d-43e3-9767-2dfd2e8d6f63.jsonl",
    "fileMtime": 1769009515468,
    "firstPrompt": "No prompt",
    "summary": "Fix invalid ARIA roles and attributes for WCAG compliance",
    "messageCount": 6,
    "created": "2026-01-09T18:10:56.061Z",
    "modified": "2026-01-09T18:34:26.232Z",
    "gitBranch": "fix/BFMC-1806--aria-controls-reference-invalid-id",
    "projectPath": "/Users/***/Workspace/***project***/project-name",
    "isSidechain": false,
    "duration": 1410221,
    "durationFormatted": "24 minutes",
    "accurateFirstTimestamp": "2026-01-09T18:10:56.011Z",
    "accurateLastTimestamp": "2026-01-09T18:34:26.232Z",
    "firstUserMessage": "As a developer the next issue was assigned to me. Help me to implement the correct solution by understanding the requirements..."
  }
]
```

**Note:**

- The `accurateFirstTimestamp` and `accurateLastTimestamp` fields show the exact timestamps extracted from the `.jsonl` file, which may differ slightly from the `created` and `modified` fields in the index.
- The `firstUserMessage` field contains the actual first user message with sensitive information masked for privacy protection.

### CSV Output

Opens easily in Excel or Google Sheets with all metadata as columns.

## Sprint Cut Workflow

This tool is designed specifically for generating sprint reports to track AI tool usage and its impact on your team's work. The most common workflow is exporting all sessions within a specific date range.

### Quick Start: Generate Sprint Report

Simply run without arguments to analyze all projects:

```bash
npm run dev
```

The tool automatically:

- Discovers all Claude Code projects
- Validates and repairs any corrupted indexes
- Loads all sessions from all projects

When prompted:

1. **Filter by date range?** → **Yes**
   - **From date:** `2026-02-01` (sprint start date)
   - **To date:** `2026-02-14` (sprint end date - inclusive!)
2. **Filter by git branch?** → No (or select specific branches)
3. **Filter by minimum message count?** → No (or set minimum to filter out trivial sessions)
4. **Search in summaries and prompts?** → No
5. **How would you like to select sessions?** → **Export all filtered sessions**
6. **Include enhanced metadata?** → **Yes** (to get accurate durations and message data)
7. **Select export format:** → **CSV** (for Excel/Google Sheets analysis)
8. Accept default filename and directory

This generates a comprehensive report of all AI interactions during the sprint, perfect for:

- Tracking AI tool adoption and usage patterns
- Measuring time saved through AI assistance
- Identifying most common use cases
- Generating metrics for management reports
- Understanding team productivity improvements

### Business Metrics from Exports

The enhanced metadata provides valuable business intelligence:

- **Duration metrics:** See `duration` and `durationFormatted` to understand time invested
- **Session count:** Total sessions = total AI interactions during sprint
- **Message count:** `messageCount` indicates conversation depth and complexity
- **Git branch analysis:** Track AI usage across different features/branches
- **First user message:** Understand what questions developers are asking
- **Last assistant message:** See the final AI responses and solutions provided

Export to CSV and analyze in Excel/Google Sheets to generate charts and pivot tables for sprint reviews and retrospectives.

## Project Structure

```
claude-session-analyzer/
├── src/
│   ├── index.ts          # CLI entry point with interactive prompts
│   ├── parser.ts         # Parse sessions-index.json files
│   ├── analyzer.ts       # Duration calculation and filtering logic
│   ├── exporters.ts      # JSON and CSV export functionality
│   └── types.ts          # TypeScript type definitions
├── package.json
├── tsconfig.json
└── README.md
```

## Development

### Build

```bash
npm run build
```

### Run in Development Mode

```bash
npm run dev
```

### Testing with Your Own Data

```bash
npm run dev -- "/Users/miguel.romero/.claude/projects/-Users-miguel-romero-Workspace-royal-caribbean-rcg-room-selection/sessions-index.json"
```
