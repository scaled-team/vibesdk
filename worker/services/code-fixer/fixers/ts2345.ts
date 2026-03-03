/**
 * TS2345: Argument of type 'X' is not assignable to parameter of type 'Y'.
 * Adds `as Y` type assertion to the argument.
 */

import type { CodeIssue } from '../../sandbox/sandboxTypes';
import { FixerContext, FixResult, FixedIssue, UnfixableIssue, FileObject } from '../types';
import { getFileContent } from '../utils/imports';
import { handleFixerError } from '../utils/helpers';
import { createObjectLogger } from '../../../logger';

const logger = createObjectLogger({ name: 'TS2345Fixer' }, 'TS2345Fixer');

/**
 * Extract source and target types from TS2345 error message.
 * Format: "Argument of type 'X' is not assignable to parameter of type 'Y'."
 */
function extractTypes(message: string): { sourceType: string; targetType: string } | null {
    const match = message.match(
        /Argument of type '([^']+)' is not assignable to parameter of type '([^']+)'/
    );
    return match ? { sourceType: match[1], targetType: match[2] } : null;
}

/**
 * Fix TS2345 by adding `as TargetType` assertion to the argument.
 */
export function fixArgumentTypeMismatch(
    context: FixerContext,
    issues: CodeIssue[]
): FixResult {
    logger.info(`TS2345Fixer: Processing ${issues.length} issue(s)`);

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
                        issueCode: 'TS2345', filePath: issue.filePath, line: issue.line,
                        column: issue.column, originalMessage: issue.message,
                        reason: 'File content not available',
                    });
                }
                continue;
            }

            const lines = fileContent.split('\n');
            let modified = false;
            const sorted = [...fileIssues].sort((a, b) => b.line - a.line);

            for (const issue of sorted) {
                const types = extractTypes(issue.message);
                if (!types) {
                    unfixableIssues.push({
                        issueCode: 'TS2345', filePath: issue.filePath, line: issue.line,
                        column: issue.column, originalMessage: issue.message,
                        reason: 'Could not extract types from error message',
                    });
                    continue;
                }

                const { targetType } = types;

                // Skip very complex types
                if (targetType.includes('|') || targetType.includes('&') || targetType.length > 80) {
                    unfixableIssues.push({
                        issueCode: 'TS2345', filePath: issue.filePath, line: issue.line,
                        column: issue.column, originalMessage: issue.message,
                        reason: `Target type too complex for assertion: '${targetType}'`,
                    });
                    continue;
                }

                const lineIdx = issue.line - 1;
                if (lineIdx < 0 || lineIdx >= lines.length) {
                    unfixableIssues.push({
                        issueCode: 'TS2345', filePath: issue.filePath, line: issue.line,
                        column: issue.column, originalMessage: issue.message,
                        reason: 'Line number out of range',
                    });
                    continue;
                }

                const line = lines[lineIdx];

                // If we have a column, try to insert `as TargetType` right before the next , or )
                if (issue.column && issue.column > 0) {
                    const col = issue.column - 1;
                    // Walk forward from column to find the argument boundary (, or ))
                    let depth = 0;
                    let endIdx = -1;
                    for (let i = col; i < line.length; i++) {
                        const ch = line[i];
                        if (ch === '(' || ch === '[' || ch === '{') depth++;
                        else if (ch === ')' || ch === ']' || ch === '}') {
                            if (depth === 0) { endIdx = i; break; }
                            depth--;
                        } else if (ch === ',' && depth === 0) { endIdx = i; break; }
                    }

                    if (endIdx > col) {
                        const argText = line.slice(col, endIdx).trim();
                        if (argText && !argText.includes(' as ')) {
                            const newLine = line.slice(0, col) + argText + ` as ${targetType}` + line.slice(endIdx);
                            lines[lineIdx] = newLine;
                            modified = true;
                            fixedIssues.push({
                                issueCode: 'TS2345', filePath: issue.filePath, line: issue.line,
                                column: issue.column, originalMessage: issue.message,
                                fixApplied: `Added 'as ${targetType}' to argument`,
                                fixType: 'type_assertion',
                            });
                            logger.info(`Fixed: added 'as ${targetType}' at ${filePath}:${issue.line}`);
                            continue;
                        }
                    }
                }

                unfixableIssues.push({
                    issueCode: 'TS2345', filePath: issue.filePath, line: issue.line,
                    column: issue.column, originalMessage: issue.message,
                    reason: 'Could not identify argument boundary on this line',
                });
            }

            if (modified) {
                modifiedFilesMap.set(filePath, { filePath, fileContents: lines.join('\n') });
            }
        } catch (error) {
            for (const issue of fileIssues) {
                unfixableIssues.push(handleFixerError(issue, error as Error, 'TS2345'));
            }
        }
    }

    return { fixedIssues, unfixableIssues, modifiedFiles: Array.from(modifiedFilesMap.values()), newFiles };
}

