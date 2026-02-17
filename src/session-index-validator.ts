import { readFile, writeFile, stat, readdir, copyFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { glob } from 'glob';
import chalk from 'chalk';
import { confirm } from '@inquirer/prompts';
import type { SessionEntry, SessionsIndex, ValidationResult, RepairResult, ProjectInfo } from './types.js';

/**
 * Check if a file exists
 */
async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Find all .jsonl files in a project directory
 */
async function findJsonlFiles(projectDir: string): Promise<string[]> {
  const files = await glob('*.jsonl', {
    cwd: projectDir,
    absolute: true,
  });
  return files;
}

/**
 * Parse a single .jsonl file to extract metadata for index entry
 */
async function parseJsonlMetadata(filePath: string): Promise<Partial<SessionEntry>> {
  const sessionId = path.basename(filePath, '.jsonl');
  const content = await readFile(filePath, 'utf-8');
  const lines = content.split('\n').filter(line => line.trim().length > 0);

  let firstPrompt = '';
  let messageCount = 0;
  let created: string | null = null;
  let modified: string | null = null;
  let customTitle = '';

  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      const msgType = obj.type;

      // Count messages
      if (msgType === 'user' || msgType === 'assistant') {
        messageCount++;
      }

      // Extract first user prompt
      if (msgType === 'user' && !firstPrompt) {
        const msg = obj.message;
        if (msg && Array.isArray(msg.content)) {
          for (const block of msg.content) {
            if (block.type === 'text' && block.text) {
              // Skip system messages and IDE artifacts
              if (
                !block.text.includes('<ide_opened_file>') &&
                !block.text.includes('<ide_selection>') &&
                !block.text.includes('<command-name>') &&
                !block.text.includes('<system-reminder>') &&
                block.text.trim().length > 0
              ) {
                firstPrompt = block.text.slice(0, 200);
                break;
              }
            }
          }
        } else if (typeof msg === 'string') {
          firstPrompt = msg.slice(0, 200);
        }
      }

      // Extract custom title
      if (msgType === 'custom-title') {
        customTitle = obj.title || '';
      }

      // Extract timestamps
      if (obj.message?.timestamp) {
        const ts = obj.message.timestamp;
        if (!created) created = ts;
        modified = ts;
      }
    } catch (error) {
      // Skip malformed lines
      continue;
    }
  }

  // Fallback to file timestamps if not found in content
  const stats = await stat(filePath);
  if (!created) {
    // Use birthtime if available (macOS, Windows), otherwise ctime
    const birthtime = (stats as any).birthtime || stats.ctime;
    created = birthtime.toISOString();
  }
  if (!modified) {
    modified = stats.mtime.toISOString();
  }

  return {
    sessionId,
    fullPath: filePath,
    fileMtime: Math.floor(stats.mtimeMs),
    firstPrompt,
    summary: customTitle || firstPrompt, // Use custom title if available, otherwise first prompt
    messageCount,
    created: created || new Date().toISOString(),
    modified: modified || new Date().toISOString(),
    gitBranch: '', // Can't determine from .jsonl
    projectPath: path.dirname(filePath),
    isSidechain: false,
  };
}

/**
 * Create a backup of the sessions-index.json file
 */
async function backupIndexFile(indexPath: string): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${indexPath}.bak-${timestamp}`;
  await copyFile(indexPath, backupPath);
  return backupPath;
}

/**
 * Validate a session index against actual .jsonl files on disk
 */
export async function validateSessionIndex(projectDir: string): Promise<ValidationResult> {
  const indexPath = path.join(projectDir, 'sessions-index.json');
  const indexExists = await exists(indexPath);

  // Find all .jsonl files
  const jsonlFiles = await findJsonlFiles(projectDir);
  const jsonlSessionIds = new Set(
    jsonlFiles.map(fp => path.basename(fp, '.jsonl'))
  );

  let indexEntries: SessionEntry[] = [];
  if (indexExists) {
    try {
      const content = await readFile(indexPath, 'utf-8');
      const data: SessionsIndex = JSON.parse(content);
      indexEntries = data.entries || [];
    } catch (error) {
      // Index file is corrupted, treat as if it doesn't exist
      console.warn(chalk.yellow(`Warning: Could not parse ${indexPath}, will rebuild`));
    }
  }

  const indexSessionIds = new Set(indexEntries.map(e => e.sessionId));

  // Find orphaned sessions (in .jsonl but not in index)
  const orphanedSessions = Array.from(jsonlSessionIds).filter(
    id => !indexSessionIds.has(id)
  );

  // Find missing files (in index but .jsonl missing)
  const missingFiles = Array.from(indexSessionIds).filter(
    id => !jsonlSessionIds.has(id)
  );

  return {
    isValid: orphanedSessions.length === 0 && missingFiles.length === 0 && indexExists,
    indexPath,
    projectDir,
    orphanedSessions,
    missingFiles,
    totalJsonlFiles: jsonlFiles.length,
    totalIndexEntries: indexEntries.length,
    indexExists,
  };
}

/**
 * Repair a session index by adding missing entries and removing stale ones
 */
export async function repairSessionIndex(
  projectDir: string,
  validationResult: ValidationResult
): Promise<RepairResult> {
  const { indexPath, orphanedSessions, missingFiles, indexExists } = validationResult;

  // Create backup if index exists
  let backupPath: string | null = null;
  if (indexExists) {
    backupPath = await backupIndexFile(indexPath);
  }

  // Load existing index or create new structure
  let index: SessionsIndex;
  if (indexExists) {
    try {
      const content = await readFile(indexPath, 'utf-8');
      index = JSON.parse(content);
    } catch {
      // Corrupted index, create from scratch
      index = { version: 1, entries: [] };
    }
  } else {
    index = { version: 1, entries: [] };
  }

  // Remove entries with missing files
  const originalLength = index.entries.length;
  index.entries = index.entries.filter(
    e => !missingFiles.includes(e.sessionId)
  );
  const sessionsRemoved = originalLength - index.entries.length;

  // Add orphaned sessions
  const existingIds = new Set(index.entries.map(e => e.sessionId));
  let sessionsAdded = 0;

  for (const sessionId of orphanedSessions) {
    if (existingIds.has(sessionId)) continue;

    const filePath = path.join(projectDir, `${sessionId}.jsonl`);
    try {
      const metadata = await parseJsonlMetadata(filePath);
      index.entries.push(metadata as SessionEntry);
      sessionsAdded++;
    } catch (error) {
      console.warn(chalk.yellow(`Warning: Could not parse ${filePath}:`), error);
    }
  }

  // Sort entries by creation date (newest first)
  index.entries.sort((a, b) => {
    return new Date(b.created).getTime() - new Date(a.created).getTime();
  });

  // Write repaired index
  await writeFile(indexPath, JSON.stringify(index, null, 2), 'utf-8');

  return {
    sessionsAdded,
    sessionsRemoved,
    backupPath,
    createdFromScratch: !indexExists,
    indexPath,
  };
}

/**
 * Create a new sessions-index.json from scratch by scanning all .jsonl files
 */
export async function createIndexFromScratch(projectDir: string): Promise<RepairResult> {
  const indexPath = path.join(projectDir, 'sessions-index.json');

  // Check if index already exists (backup if it does)
  let backupPath: string | null = null;
  const indexExists = await exists(indexPath);
  if (indexExists) {
    backupPath = await backupIndexFile(indexPath);
  }

  // Find all .jsonl files
  const jsonlFiles = await findJsonlFiles(projectDir);

  if (jsonlFiles.length === 0) {
    throw new Error(`No .jsonl session files found in ${projectDir}`);
  }

  // Parse metadata from all .jsonl files in parallel
  console.log(chalk.blue(`\n📝 Parsing ${jsonlFiles.length} session files...\n`));

  const metadataPromises = jsonlFiles.map(filePath =>
    parseJsonlMetadata(filePath).catch(error => {
      console.warn(chalk.yellow(`Warning: Could not parse ${path.basename(filePath)}:`), error);
      return null;
    })
  );

  const metadataResults = await Promise.all(metadataPromises);
  const validMetadata = metadataResults.filter(m => m !== null) as SessionEntry[];

  // Create index structure
  const index: SessionsIndex = {
    version: 1,
    entries: validMetadata,
  };

  // Sort entries by creation date (newest first)
  index.entries.sort((a, b) => {
    return new Date(b.created).getTime() - new Date(a.created).getTime();
  });

  // Write index to disk
  await writeFile(indexPath, JSON.stringify(index, null, 2), 'utf-8');

  return {
    sessionsAdded: validMetadata.length,
    sessionsRemoved: 0,
    backupPath,
    createdFromScratch: true,
    indexPath,
  };
}

/**
 * Batch validate and repair multiple projects
 */
export async function validateAndRepairProjects(
  projects: ProjectInfo[],
  autoRepair: boolean
): Promise<void> {
  console.log(chalk.blue('\n🔎 Validating session indexes...\n'));

  const validationResults: ValidationResult[] = [];
  let needsRepair = false;

  // Validate all projects
  for (const project of projects) {
    const result = await validateSessionIndex(project.projectDir);
    validationResults.push(result);

    if (!result.isValid) {
      needsRepair = true;
      const projectName = path.basename(project.projectDir);

      if (!result.indexExists) {
        console.log(
          chalk.yellow(`  ⚠️  ${projectName}: No index found (${result.totalJsonlFiles} .jsonl files)`)
        );
      } else {
        if (result.orphanedSessions.length > 0) {
          console.log(
            chalk.yellow(`  ⚠️  ${projectName}: ${result.orphanedSessions.length} sessions not in index`)
          );
        }
        if (result.missingFiles.length > 0) {
          console.log(
            chalk.yellow(`  ⚠️  ${projectName}: ${result.missingFiles.length} index entries have missing files`)
          );
        }
      }
    } else {
      const projectName = path.basename(project.projectDir);
      console.log(chalk.green(`  ✓ ${projectName}: Index valid`));
    }
  }

  // If repairs needed, prompt user (unless auto-repair)
  if (needsRepair) {
    let shouldRepair = autoRepair;

    if (!autoRepair) {
      console.log(); // blank line
      shouldRepair = await confirm({
        message: 'Repair session indexes?',
        default: true,
      });
    }

    if (shouldRepair) {
      console.log(chalk.blue('\n📝 Repairing indexes...\n'));

      for (let i = 0; i < validationResults.length; i++) {
        const result = validationResults[i];
        if (!result.isValid) {
          const repairResult = await repairSessionIndex(result.projectDir, result);
          const projectName = path.basename(result.projectDir);

          if (repairResult.createdFromScratch) {
            console.log(
              chalk.green(`  ✓ ${projectName}: Created index with ${repairResult.sessionsAdded} sessions`)
            );
          } else {
            const changes = [];
            if (repairResult.sessionsAdded > 0) {
              changes.push(`+${repairResult.sessionsAdded} added`);
            }
            if (repairResult.sessionsRemoved > 0) {
              changes.push(`-${repairResult.sessionsRemoved} removed`);
            }
            console.log(chalk.green(`  ✓ ${projectName}: ${changes.join(', ')}`));
          }

          // Update the project's indexPath to reflect the repaired index
          const projectIndex = projects.findIndex(p => p.projectDir === result.projectDir);
          if (projectIndex !== -1) {
            projects[projectIndex].indexPath = repairResult.indexPath;
          }
        }
      }

      console.log(chalk.gray('\n  Backups saved as sessions-index.json.bak-{timestamp}'));
    } else {
      console.log(chalk.yellow('\n⚠️  Continuing with potentially incomplete data\n'));
    }
  } else {
    console.log(chalk.green('\n✓ All session indexes are valid\n'));
  }
}
