/**
 * TS7006: Parameter 'x' implicitly has an 'any' type.
 * Adds explicit `: any` type annotation to the parameter.
 */

import type { CodeIssue } from '../../sandbox/sandboxTypes';
import { FixerContext, FixResult, FixedIssue, UnfixableIssue, FileObject } from '../types';
import { getFileContent } from '../utils/imports';
import { handleFixerError } from '../utils/helpers';
import { createObjectLogger } from '../../../logger';

const logger = createObjectLogger({ name: 'TS7006Fixer' }, 'TS7006Fixer');

/**
 * Extract parameter name from TS7006 message.
 * Format: "Parameter 'x' implicitly has an 'any' type."
 */
function extractParamName(message: string): string | null {
    const match = message.match(/Parameter '([^']+)' implicitly has an 'any' type/);
    return match ? match[1] : null;
}

/**
 * Fix TS7006 by adding `: any` annotation to the parameter.
 */
export function fixImplicitAnyParam(
    context: FixerContext,
    issues: CodeIssue[]
): FixResult {
    logger.info(`TS7006Fixer: Processing ${issues.length} issue(s)`);

    const fixedIssues: FixedIssue[] = [];
    const unfixableIssues: UnfixableIssue[] = [];
    const modifiedFilesMap = new Map<string, FileObject>();
    const newFiles: FileObject[] = [];

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
                        issueCode: 'TS7006',
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

            // Process in reverse order to preserve line numbers
            const sorted = [...fileIssues].sort((a, b) => b.line - a.line);

            for (const issue of sorted) {
                const paramName = extractParamName(issue.message);
                if (!paramName) {
                    unfixableIssues.push({
                        issueCode: 'TS7006',
                        filePath: issue.filePath,
                        line: issue.line,
                        column: issue.column,
                        originalMessage: issue.message,
                        reason: 'Could not extract parameter name from error message',
                    });
                    continue;
                }

                const lineIdx = issue.line - 1;
                if (lineIdx < 0 || lineIdx >= lines.length) {
                    unfixableIssues.push({
                        issueCode: 'TS7006',
                        filePath: issue.filePath,
                        line: issue.line,
                        column: issue.column,
                        originalMessage: issue.message,
                        reason: 'Line number out of range',
                    });
                    continue;
                }

                const line = lines[lineIdx];
                const escaped = paramName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

                // Match parameter name NOT already followed by `:` (already typed)
                // Handles: (x) (x, y) (x = default) ({x}) — but only bare identifiers
                const regex = new RegExp(
                    `(\\b${escaped})(?=\\s*[,)=}])`,
                    'g'
                );

                // Only replace the FIRST occurrence if column is available, otherwise all
                let replaced = false;
                const newLine = line.replace(regex, (_match, name, offset) => {
                    // If column hint is available, prefer the match closest to it
                    if (issue.column && !replaced) {
                        const col0 = issue.column - 1;
                        if (Math.abs(offset - col0) > paramName.length + 5) {
                            return _match; // wrong occurrence
                        }
                    }
                    replaced = true;
                    return `${name}: any`;
                });

                if (newLine !== line) {
                    lines[lineIdx] = newLine;
                    modified = true;
                    fixedIssues.push({
                        issueCode: 'TS7006',
                        filePath: issue.filePath,
                        line: issue.line,
                        column: issue.column,
                        originalMessage: issue.message,
                        fixApplied: `Added ': any' annotation to parameter '${paramName}'`,
                        fixType: 'annotation_fix',
                    });
                    logger.info(`Fixed: added ': any' to '${paramName}' at ${filePath}:${issue.line}`);
                } else {
                    unfixableIssues.push({
                        issueCode: 'TS7006',
                        filePath: issue.filePath,
                        line: issue.line,
                        column: issue.column,
                        originalMessage: issue.message,
                        reason: `Could not find unannotated parameter '${paramName}' on line ${issue.line}`,
                    });
                }
            }

            if (modified) {
                modifiedFilesMap.set(filePath, { filePath, fileContents: lines.join('\n') });
            }
        } catch (error) {
            for (const issue of fileIssues) {
                unfixableIssues.push(handleFixerError(issue, error as Error, 'TS7006'));
            }
        }
    }

    return { fixedIssues, unfixableIssues, modifiedFiles: Array.from(modifiedFilesMap.values()), newFiles };
}

