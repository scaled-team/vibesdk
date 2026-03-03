/**
 * TS2551: Property 'X' does not exist on type 'Y'. Did you mean 'Z'?
 * Uses the compiler's own suggestion to rename the identifier.
 */

import type { CodeIssue } from '../../sandbox/sandboxTypes';
import { FixerContext, FixResult, FixedIssue, UnfixableIssue, FileObject } from '../types';
import { getFileContent } from '../utils/imports';
import { handleFixerError } from '../utils/helpers';
import { createObjectLogger } from '../../../logger';

const logger = createObjectLogger({ name: 'TS2551Fixer' }, 'TS2551Fixer');

/**
 * Extract the typo and suggestion from TS2551 error message.
 * Message format: "Property 'X' does not exist on type 'Y'. Did you mean 'Z'?"
 */
function extractTypoAndSuggestion(message: string): { typo: string; suggestion: string } | null {
    // Match: Property 'X' does not exist ... Did you mean 'Z'?
    const match = message.match(/Property '([^']+)' does not exist.*Did you mean '([^']+)'/);
    if (match) return { typo: match[1], suggestion: match[2] };

    // Also handle: "Did you mean 'X'?" without "Property" prefix (TS2551 variant)
    const altMatch = message.match(/'([^']+)'.*does not exist.*Did you mean '([^']+)'/);
    if (altMatch) return { typo: altMatch[1], suggestion: altMatch[2] };

    return null;
}

/**
 * Fix TS2551 "Did you mean?" errors by renaming the typo to the suggestion.
 */
export function fixDidYouMeanTypo(
    context: FixerContext,
    issues: CodeIssue[]
): FixResult {
    logger.info(`TS2551Fixer: Processing ${issues.length} issue(s)`);

    const fixedIssues: FixedIssue[] = [];
    const unfixableIssues: UnfixableIssue[] = [];
    const modifiedFilesMap = new Map<string, FileObject>();
    const newFiles: FileObject[] = [];

    // Group by file
    const issuesByFile = new Map<string, CodeIssue[]>();
    for (const issue of issues) {
        const arr = issuesByFile.get(issue.filePath) || [];
        arr.push(issue);
        issuesByFile.set(issue.filePath, arr);
    }

    for (const [filePath, fileIssues] of issuesByFile) {
        try {
            let fileContent = getFileContent(filePath, context.files);
            if (!fileContent) {
                for (const issue of fileIssues) {
                    unfixableIssues.push({
                        issueCode: 'TS2551',
                        filePath: issue.filePath,
                        line: issue.line,
                        column: issue.column,
                        originalMessage: issue.message,
                        reason: 'File content not available',
                    });
                }
                continue;
            }

            const lines = fileContent.split('\n');
            let modified = false;

            // Process issues in reverse line order to preserve line numbers
            const sorted = [...fileIssues].sort((a, b) => b.line - a.line);

            for (const issue of sorted) {
                const extracted = extractTypoAndSuggestion(issue.message);
                if (!extracted) {
                    unfixableIssues.push({
                        issueCode: 'TS2551',
                        filePath: issue.filePath,
                        line: issue.line,
                        column: issue.column,
                        originalMessage: issue.message,
                        reason: 'Could not extract typo/suggestion from error message',
                    });
                    continue;
                }

                const { typo, suggestion } = extracted;
                const lineIdx = issue.line - 1;

                if (lineIdx < 0 || lineIdx >= lines.length) {
                    unfixableIssues.push({
                        issueCode: 'TS2551',
                        filePath: issue.filePath,
                        line: issue.line,
                        column: issue.column,
                        originalMessage: issue.message,
                        reason: 'Line number out of range',
                    });
                    continue;
                }

                // Replace the typo on the specific line, respecting word boundaries
                const before = lines[lineIdx];
                const regex = new RegExp(`\\b${escapeRegex(typo)}\\b`, 'g');
                const after = before.replace(regex, suggestion);

                if (before !== after) {
                    lines[lineIdx] = after;
                    modified = true;
                    fixedIssues.push({
                        issueCode: 'TS2551',
                        filePath: issue.filePath,
                        line: issue.line,
                        column: issue.column,
                        originalMessage: issue.message,
                        fixApplied: `Renamed '${typo}' to '${suggestion}'`,
                        fixType: 'typo_correction',
                    });
                    logger.info(`Fixed: '${typo}' → '${suggestion}' at ${filePath}:${issue.line}`);
                } else {
                    unfixableIssues.push({
                        issueCode: 'TS2551',
                        filePath: issue.filePath,
                        line: issue.line,
                        column: issue.column,
                        originalMessage: issue.message,
                        reason: `Could not find '${typo}' on line ${issue.line}`,
                    });
                }
            }

            if (modified) {
                modifiedFilesMap.set(filePath, {
                    filePath,
                    fileContents: lines.join('\n'),
                });
            }
        } catch (error) {
            for (const issue of fileIssues) {
                unfixableIssues.push(handleFixerError(issue, error as Error, 'TS2551'));
            }
        }
    }

    return { fixedIssues, unfixableIssues, modifiedFiles: Array.from(modifiedFilesMap.values()), newFiles };
}

function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

