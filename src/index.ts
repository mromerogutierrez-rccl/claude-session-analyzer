#!/usr/bin/env node

import { Command } from 'commander';
import { input, select, confirm, checkbox } from '@inquirer/prompts';
import chalk from 'chalk';
import { format } from 'date-fns';
import path from 'path';
import {
  getUniqueBranches,
  discoverProjects,
  displayProjectsSummary,
  loadSessionsFromProjects
} from './parser.js';
import {
  filterSessions,
  sortSessionsByDate,
  enhanceSessions,
} from './analyzer.js';
import { exportSessions } from './exporters.js';
import { parseStartOfDay, parseEndOfDay, isValidDateRange, formatDateRange } from './date-utils.js';
import { validateAndRepairProjects } from './session-index-validator.js';
import {
  checkClaudeOnPath,
  summarizeSessions,
  DEFAULT_SUMMARY_PROMPT,
  SUMMARY_TIMEOUT_MS,
} from './session-summarizer.js';
import type { SessionEntry, FilterOptions, ExportFormat, EnhancedSession } from './types.js';

const program = new Command();

program
  .name('claude-logs')
  .description(
    'Interactive CLI to analyze and export Claude session logs.\n' +
    'Exports use a fixed 15-column schema: sessionId, gitBranch, projectName,\n' +
    'messageCount, userMessageCount, assistantMessageCount, toolMessageCount,\n' +
    'duration, durationFormatted, activeDuration, activeDurationFormatted,\n' +
    'summary, accurateFirstTimestamp, accurateLastTimestamp, aiSummary.\n' +
    'Enhancement-only fields are null/omitted when enhanced metadata is skipped.'
  )
  .version('2.0.0')
  .argument(
    '[path]',
    'Project directory, sessions-index.json file, or glob pattern (default: ~/.claude/projects)',
    undefined
  )
  .option('--validate', 'Validate session indexes before analysis (default: true)', true)
  .option('--auto-repair', 'Automatically repair indexes without prompting', false)
  .option('--no-validate', 'Skip validation (faster but may miss sessions)')
  .option('--gap-threshold <minutes>', 'Idle gap threshold in minutes for active duration calculation (default: 30)', '30')
  .option('--summary-prompt <text>', 'Custom prompt for AI session summaries')
  .option('--max-concurrency <number>', 'Maximum number of parallel claude subprocess calls for summarization (default: 5)', '5')
  .action(async (inputPath: string | undefined, options: { validate: boolean; autoRepair: boolean; gapThreshold: string; summaryPrompt?: string; maxConcurrency: string }) => {
    // Validate --gap-threshold before any async I/O
    // String comparison catches decimals: parseInt('1.5') === 1 but String(1) !== '1.5'
    const parsedThreshold = parseInt(options.gapThreshold, 10);
    if (
      !Number.isInteger(parsedThreshold) ||
      parsedThreshold <= 0 ||
      String(parsedThreshold) !== options.gapThreshold.trim()
    ) {
      console.error(
        chalk.red(`Error: --gap-threshold must be a positive integer (minutes). Received: "${options.gapThreshold}"`)
      );
      process.exit(1);
    }
    const gapThresholdMs = parsedThreshold * 60 * 1_000;

    // Validate --max-concurrency before any async I/O
    const parsedConcurrency = parseInt(options.maxConcurrency, 10);
    if (
      !Number.isInteger(parsedConcurrency) ||
      parsedConcurrency <= 0 ||
      String(parsedConcurrency) !== options.maxConcurrency.trim()
    ) {
      console.error(
        chalk.red(`Error: --max-concurrency must be a positive integer. Received: "${options.maxConcurrency}"`)
      );
      process.exit(1);
    }

    try {
      console.log(chalk.blue('🔍 Discovering session files...\n'));

      // PHASE 1: Discovery
      const projects = await discoverProjects(inputPath);

      if (projects.length === 0) {
        console.log(chalk.red('No projects found. Exiting.'));
        return;
      }

      console.log(
        chalk.gray(`Found ${projects.length} project${projects.length > 1 ? 's' : ''}\n`)
      );

      // Display projects summary
      displayProjectsSummary(projects);

      // PHASE 2: Validation (if enabled)
      if (options.validate) {
        await validateAndRepairProjects(projects, options.autoRepair);
      }

      // PHASE 3: Load Sessions
      console.log(chalk.blue('📖 Loading sessions...\n'));
      const allSessions = await loadSessionsFromProjects(projects);

      if (allSessions.length === 0) {
        console.log(chalk.red('No sessions found. Exiting.'));
        return;
      }

      console.log(chalk.green(`✓ Loaded ${allSessions.length} sessions\n`));

      // Sort sessions by date
      const sortedSessions = sortSessionsByDate(allSessions);

      // Interactive filtering
      const filters = await collectFilters(sortedSessions);

      // Apply filters
      let filteredSessions = filterSessions(sortedSessions, filters);
      console.log(
        chalk.yellow(`\n📊 ${filteredSessions.length} sessions after filtering\n`)
      );

      if (filteredSessions.length === 0) {
        console.log(chalk.red('No sessions match the filters. Exiting.'));
        return;
      }

      // Select specific sessions
      const selectedSessions = await selectSessions(filteredSessions);

      if (selectedSessions.length === 0) {
        console.log(chalk.red('No sessions selected. Exiting.'));
        return;
      }

      // Ask about enhanced metadata
      const includeEnhanced = await confirm({
        message: 'Include enhanced metadata (accurate duration from .jsonl files)?',
        default: true,
      });

      // Prepare sessions for export
      let sessionsToExport: SessionEntry[] | EnhancedSession[];
      let aiSummaryStatus: 'none' | 'declined' | 'no_claude' | { generated: number; skipped: number } = 'none';

      if (includeEnhanced) {
        console.log(chalk.blue('\n⏱️  Calculating accurate durations from .jsonl files...\n'));
        const enhancementResults = await enhanceSessions(selectedSessions, gapThresholdMs);
        const enhancedSessions: EnhancedSession[] = enhancementResults.map(r => r.session);
        sessionsToExport = enhancedSessions;

        // Summarization block
        const generateSummaries = await confirm({
          message: 'Generate AI summaries for selected sessions using claude CLI?',
          default: true,
        });

        if (!generateSummaries) {
          aiSummaryStatus = 'declined';
        } else {
          const claudeAvailable = await checkClaudeOnPath();
          if (!claudeAvailable) {
            console.log(chalk.yellow('\n  ⚠  claude CLI not found on PATH. Skipping AI summaries.\n'));
            aiSummaryStatus = 'no_claude';
          } else {
            console.log(chalk.blue('\n🤖 Generating AI summaries...\n'));
            const pairs = enhancementResults.map(r => ({ session: r.session, rawData: r.rawData }));
            let generated = 0;
            let skipped = 0;

            const results = await summarizeSessions(
              pairs,
              options.summaryPrompt ?? DEFAULT_SUMMARY_PROMPT,
              parsedConcurrency,
              SUMMARY_TIMEOUT_MS,
              (result, session) => {
                const date = format(new Date(session.created), 'yyyy-MM-dd HH:mm');
                const preview = session.summary.slice(0, 50);
                if (result.status === 'generated') {
                  console.log(chalk.green(`  ✓ [${date}] ${preview} (summary generated)`));
                } else if (result.status === 'skipped_low_count') {
                  console.log(chalk.yellow(`  ⚠ [${date}] ${preview} (skipped — fewer than 3 user messages)`));
                } else if (result.status === 'failed_timeout') {
                  console.log(chalk.yellow(`  ⚠ [${date}] ${preview} (failed — timed out after 60s)`));
                } else if (result.status === 'failed_exit') {
                  console.log(chalk.yellow(`  ⚠ [${date}] ${preview} (failed — code ${result.exitCode})`));
                }
              }
            );

            // Merge aiSummary back onto sessionsToExport (index-aligned)
            for (let i = 0; i < results.length; i++) {
              if (results[i].status === 'generated' && results[i].aiSummary) {
                enhancedSessions[i].aiSummary = results[i].aiSummary;
                generated++;
              } else {
                skipped++;
              }
            }

            aiSummaryStatus = { generated, skipped };

            if (skipped > 0) {
              console.log(chalk.gray(`\n  Generated ${generated} of ${results.length} summaries (${skipped} skipped)\n`));
            } else {
              console.log(chalk.gray(`\n  Generated ${generated} of ${results.length} summaries\n`));
            }
          }
        }
      } else {
        sessionsToExport = selectedSessions;
      }

      // Export options
      const exportFormat = await select<ExportFormat>({
        message: 'Select export format:',
        choices: [
          { name: 'JSON', value: 'json' },
          { name: 'CSV', value: 'csv' },
        ],
      });

      const defaultFileName = `claude-sessions-${format(new Date(), 'yyyy-MM-dd-HHmmss')}.${exportFormat}`;
      const outputFileName = await input({
        message: 'Output filename:',
        default: defaultFileName,
      });

      const outputDirectory = await input({
        message: 'Output directory:',
        default: process.cwd(),
      });

      const outputPath = path.join(outputDirectory, outputFileName);

      // Export
      console.log(
        chalk.cyan(
          '\nℹ  Export schema changed: fullPath, fileMtime, firstPrompt, firstUserMessage,\n' +
          '   lastAssistantMessage, created, modified, projectPath, and isSidechain are\n' +
          '   no longer exported. The new fixed schema has 15 columns.\n' +
          '   Run with --help to see the full column list.\n'
        )
      );
      console.log(chalk.blue('📝 Exporting sessions...\n'));
      await exportSessions(sessionsToExport, exportFormat, outputPath);

      console.log(chalk.green(`✓ Successfully exported to: ${outputPath}`));
      console.log(
        chalk.gray(`  Sessions exported: ${selectedSessions.length}`)
      );
      console.log(chalk.gray(`  Format: ${exportFormat.toUpperCase()}`));
      console.log(chalk.gray(`  Schema: 15 columns (sessionId → aiSummary)`));
      console.log(chalk.gray(`  Enhanced metadata: ${includeEnhanced ? 'Yes' : 'No'}`));

      // AI summary status line (only when enhanced)
      if (includeEnhanced) {
        if (aiSummaryStatus === 'declined') {
          console.log(chalk.gray(`  AI summaries: No`));
        } else if (aiSummaryStatus === 'no_claude') {
          console.log(chalk.gray(`  AI summaries: Skipped (claude not found)`));
        } else if (typeof aiSummaryStatus === 'object') {
          console.log(chalk.gray(`  AI summaries: ${aiSummaryStatus.generated} generated, ${aiSummaryStatus.skipped} skipped`));
        }
      }

      // Show gap threshold line only when explicitly passed by the user
      if (includeEnhanced && options.gapThreshold !== '30') {
        console.log(chalk.gray(`  Gap threshold: ${parsedThreshold} min`));
      }

      // Show note when at least one session had idle gaps removed
      if (includeEnhanced && Array.isArray(sessionsToExport)) {
        const enhancedExported = sessionsToExport as EnhancedSession[];
        const sessionsWithGaps = enhancedExported.filter(
          s =>
            s.activeDuration !== undefined &&
            s.duration !== undefined &&
            s.activeDuration < s.duration
        );
        if (sessionsWithGaps.length > 0) {
          console.log(
            chalk.gray(
              `  Note: ${sessionsWithGaps.length} session(s) had idle gaps removed. activeDuration < duration for those sessions.`
            )
          );
        }
      }
    } catch (error) {
      console.error(chalk.red('\n❌ Error:'), error);
      process.exit(1);
    }
  });

/**
 * Collect filters from user input
 */
async function collectFilters(
  sessions: SessionEntry[]
): Promise<FilterOptions> {
  const filters: FilterOptions = {};

  // Date filter
  const useDateFilter = await confirm({
    message: 'Filter by date range?',
    default: false,
  });

  if (useDateFilter) {
    // FROM DATE with validation
    let dateFrom: Date | null = null;
    while (true) {
      const dateFromStr = await input({
        message: 'From date (YYYY-MM-DD, leave empty for no start date):',
      });

      if (!dateFromStr) {
        break; // No start date
      }

      dateFrom = parseStartOfDay(dateFromStr);
      if (dateFrom) {
        break; // Valid date
      } else {
        console.log(chalk.red('❌ Invalid date format. Please use YYYY-MM-DD (e.g., 2026-02-01)'));
      }
    }

    // TO DATE with validation
    let dateTo: Date | null = null;
    while (true) {
      const dateToStr = await input({
        message: 'To date (YYYY-MM-DD, leave empty for no end date):',
      });

      if (!dateToStr) {
        break; // No end date
      }

      dateTo = parseEndOfDay(dateToStr); // KEY CHANGE: Use parseEndOfDay
      if (dateTo) {
        // Validate date range if both dates provided
        if (dateFrom && !isValidDateRange(dateFrom, dateTo)) {
          console.log(chalk.red('❌ End date must be on or after start date. Please try again.'));
          dateTo = null; // Reset and retry
          continue;
        }
        break; // Valid date and range
      } else {
        console.log(chalk.red('❌ Invalid date format. Please use YYYY-MM-DD (e.g., 2026-02-05)'));
      }
    }

    // Set filters if dates were provided
    if (dateFrom) {
      filters.dateFrom = dateFrom;
    }
    if (dateTo) {
      filters.dateTo = dateTo;
    }

    // Display the selected range
    if (dateFrom || dateTo) {
      console.log(chalk.gray(`  Selected range: ${formatDateRange(dateFrom, dateTo)}`));
    }
  }

  // Git branch filter
  const uniqueBranches = getUniqueBranches(sessions);

  if (uniqueBranches.length > 0) {
    const useBranchFilter = await confirm({
      message: 'Filter by git branch?',
      default: false,
    });

    if (useBranchFilter) {
      const selectedBranches = await checkbox({
        message: 'Select branches (space to select, enter to confirm):',
        choices: uniqueBranches.map(branch => ({
          name: branch,
          value: branch,
        })),
      });

      if (selectedBranches.length > 0) {
        filters.gitBranches = selectedBranches;
      }
    }
  }

  // Message count filter
  const useMessageFilter = await confirm({
    message: 'Filter by minimum message count?',
    default: false,
  });

  if (useMessageFilter) {
    const minCount = await input({
      message: 'Minimum message count:',
      default: '1',
    });

    filters.minMessageCount = parseInt(minCount, 10);
  }

  // Text search filter
  const useTextSearch = await confirm({
    message: 'Search in summaries and prompts?',
    default: false,
  });

  if (useTextSearch) {
    const searchText = await input({
      message: 'Search text:',
    });

    if (searchText) {
      filters.searchText = searchText;
    }
  }

  return filters;
}

/**
 * Allow user to select specific sessions
 */
async function selectSessions(
  sessions: SessionEntry[]
): Promise<SessionEntry[]> {
  const selectionMode = await select({
    message: 'How would you like to select sessions?',
    choices: [
      { name: 'Export all filtered sessions', value: 'all' },
      { name: 'Select specific sessions', value: 'specific' },
    ],
  });

  if (selectionMode === 'all') {
    return sessions;
  }

  // Create choices for checkbox
  const choices = sessions.slice(0, 50).map(session => {
    const date = format(new Date(session.created), 'yyyy-MM-dd HH:mm');
    const summary = session.summary.slice(0, 60);
    const label = `[${date}] ${summary} (${session.messageCount} msgs)`;

    return {
      name: label,
      value: session.sessionId,
    };
  });

  if (sessions.length > 50) {
    console.log(
      chalk.yellow(`\nNote: Showing first 50 sessions for selection.\n`)
    );
  }

  const selectedIds = await checkbox({
    message: 'Select sessions to export (space to select, enter to confirm):',
    choices,
    pageSize: 15,
  });

  return sessions.filter(session => selectedIds.includes(session.sessionId));
}

program.parse();
