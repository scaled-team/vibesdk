/**
 * TS2322: Type 'X' is not assignable to type 'Y'.
 * Adds `as Y` type assertion to the assignment value.
 */

import type { CodeIssue } from '../../sandbox/sandboxTypes';
import { FixerContext, FixResult, FixedIssue, UnfixableIssue, FileObject } from '../types';
import { getFileContent } from '../utils/imports';
import { handleFixerError } from '../utils/helpers';
import { createObjectLogger } from '../../../logger';

const logger = createObjectLogger({ name: 'TS2322Fixer' }, 'TS2322Fixer');

/**
 * Extract target type from TS2322 error message.
 * Format: "Type 'X' is not assignable to type 'Y'."
 */
function extractTargetType(message: string): string | null {
    const match = message.match(/is not assignable to type '([^']+)'/);
    return match ? match[1] : null;
}

/**
 * Fix TS2322 type assignment errors by adding `as TargetType` assertion.
 * This is a pragmatic fix — it silences the error while preserving runtime behavior.
 */
export function fixTypeAssignmentMismatch(
    context: FixerContext,
    issues: CodeIssue[]
): FixResult {
    logger.info(`TS2322Fixer: Processing ${issues.length} issue(s)`);

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
                        issueCode: 'TS2322', filePath: issue.filePath, line: issue.line,
                        column: issue.column, originalMessage: issue.message,
                        reason: 'File content not available',
                    });
                }
                continue;
            }

            const lines = fileContent.split('\n');
            let modified = false;

            // Process in reverse to preserve line numbers
            const sorted = [...fileIssues].sort((a, b) => b.line - a.line);

            for (const issue of sorted) {
                const targetType = extractTargetType(issue.message);
                if (!targetType) {
                    unfixableIssues.push({
                        issueCode: 'TS2322', filePath: issue.filePath, line: issue.line,
                        column: issue.column, originalMessage: issue.message,
                        reason: 'Could not extract target type from error message',
                    });
                    continue;
                }

                // Skip complex union/intersection types — assertion would be messy
                if (targetType.includes('|') || targetType.includes('&') || targetType.length > 80) {
                    unfixableIssues.push({
                        issueCode: 'TS2322', filePath: issue.filePath, line: issue.line,
                        column: issue.column, originalMessage: issue.message,
                        reason: `Target type too complex for assertion: '${targetType}'`,
                    });
                    continue;
                }

                const lineIdx = issue.line - 1;
                if (lineIdx < 0 || lineIdx >= lines.length) {
                    unfixableIssues.push({
                        issueCode: 'TS2322', filePath: issue.filePath, line: issue.line,
                        column: issue.column, originalMessage: issue.message,
                        reason: 'Line number out of range',
                    });
                    continue;
                }

                const line = lines[lineIdx];

                // Find the assignment: `= <value>` and wrap value with `as Type`
                // Handles: const x: Type = value; | x = value; | prop: value
                const assignMatch = line.match(/^(.*?=\s*)(.+?)(\s*[;,]?\s*)$/);
                if (assignMatch && !assignMatch[2].includes(' as ')) {
                    const [, prefix, value, suffix] = assignMatch;
                    const trimmedValue = value.trim();
                    // Wrap in parens if it's a complex expression
                    const needsParens = trimmedValue.includes('?') || trimmedValue.includes('||') || trimmedValue.includes('&&');
                    const wrapped = needsParens ? `(${trimmedValue}) as ${targetType}` : `${trimmedValue} as ${targetType}`;
                    lines[lineIdx] = `${prefix}${wrapped}${suffix}`;
                    modified = true;
                    fixedIssues.push({
                        issueCode: 'TS2322', filePath: issue.filePath, line: issue.line,
                        column: issue.column, originalMessage: issue.message,
                        fixApplied: `Added 'as ${targetType}' assertion`,
                        fixType: 'type_assertion',
                    });
                    logger.info(`Fixed: added 'as ${targetType}' at ${filePath}:${issue.line}`);
                } else {
                    unfixableIssues.push({
                        issueCode: 'TS2322', filePath: issue.filePath, line: issue.line,
                        column: issue.column, originalMessage: issue.message,
                        reason: 'Could not identify assignment expression on this line',
                    });
                }
            }

            if (modified) {
                modifiedFilesMap.set(filePath, { filePath, fileContents: lines.join('\n') });
            }
        } catch (error) {
            for (const issue of fileIssues) {
                unfixableIssues.push(handleFixerError(issue, error as Error, 'TS2322'));
            }
        }
    }

    return { fixedIssues, unfixableIssues, modifiedFiles: Array.from(modifiedFilesMap.values()), newFiles };
}

