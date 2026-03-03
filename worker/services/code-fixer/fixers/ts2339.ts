/**
 * TS2339: Property 'X' does not exist on type 'Y'.
 * Adds optional chaining (?.) or type assertion (as any) depending on context.
 */

import type { CodeIssue } from '../../sandbox/sandboxTypes';
import { FixerContext, FixResult, FixedIssue, UnfixableIssue, FileObject } from '../types';
import { getFileContent } from '../utils/imports';
import { handleFixerError } from '../utils/helpers';
import { createObjectLogger } from '../../../logger';

const logger = createObjectLogger({ name: 'TS2339Fixer' }, 'TS2339Fixer');

/**
 * Extract property name from TS2339 error message.
 * Format: "Property 'X' does not exist on type 'Y'."
 */
function extractPropertyName(message: string): string | null {
    const match = message.match(/Property '([^']+)' does not exist on type/);
    return match ? match[1] : null;
}

/**
 * Fix TS2339 by adding `(expr as any).prop` assertion at the access site.
 * Prefers `as any` over optional chaining since the property genuinely doesn't
 * exist on the declared type (optional chaining would still fail type check).
 */
export function fixPropertyDoesNotExist(
    context: FixerContext,
    issues: CodeIssue[]
): FixResult {
    logger.info(`TS2339Fixer: Processing ${issues.length} issue(s)`);

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
                        issueCode: 'TS2339', filePath: issue.filePath, line: issue.line,
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
                const propName = extractPropertyName(issue.message);
                if (!propName) {
                    unfixableIssues.push({
                        issueCode: 'TS2339', filePath: issue.filePath, line: issue.line,
                        column: issue.column, originalMessage: issue.message,
                        reason: 'Could not extract property name from error message',
                    });
                    continue;
                }

                const lineIdx = issue.line - 1;
                if (lineIdx < 0 || lineIdx >= lines.length) {
                    unfixableIssues.push({
                        issueCode: 'TS2339', filePath: issue.filePath, line: issue.line,
                        column: issue.column, originalMessage: issue.message,
                        reason: 'Line number out of range',
                    });
                    continue;
                }

                const line = lines[lineIdx];
                const escaped = propName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

                // Pattern: someExpr.propName or someExpr?.propName
                // Replace: (someExpr as any).propName
                // We look for `identifier.propName` or `identifier?.propName` or `).propName` etc.
                const accessRegex = new RegExp(
                    `([a-zA-Z_$][a-zA-Z0-9_$]*|\\)|\\])(\\.|\\.\\?)${escaped}\\b`
                );
                const accessMatch = line.match(accessRegex);

                if (accessMatch && accessMatch.index !== undefined) {
                    // Find the object expression before the dot
                    const dotStart = accessMatch.index + accessMatch[1].length;
                    const dotEnd = dotStart + accessMatch[2].length;
                    
                    // Insert `as any` cast: wrap the preceding token
                    // Simple approach: add `as any` before the dot
                    const newLine = line.slice(0, accessMatch.index) +
                        `(${accessMatch[1]} as any)` +
                        line.slice(dotStart, dotEnd) +
                        propName +
                        line.slice(dotEnd + propName.length);

                    if (newLine !== line) {
                        lines[lineIdx] = newLine;
                        modified = true;
                        fixedIssues.push({
                            issueCode: 'TS2339', filePath: issue.filePath, line: issue.line,
                            column: issue.column, originalMessage: issue.message,
                            fixApplied: `Added '(... as any).${propName}' assertion`,
                            fixType: 'type_assertion',
                        });
                        logger.info(`Fixed: added 'as any' for '.${propName}' at ${filePath}:${issue.line}`);
                        continue;
                    }
                }

                unfixableIssues.push({
                    issueCode: 'TS2339', filePath: issue.filePath, line: issue.line,
                    column: issue.column, originalMessage: issue.message,
                    reason: `Could not find property access '.${propName}' on line ${issue.line}`,
                });
            }

            if (modified) {
                modifiedFilesMap.set(filePath, { filePath, fileContents: lines.join('\n') });
            }
        } catch (error) {
            for (const issue of fileIssues) {
                unfixableIssues.push(handleFixerError(issue, error as Error, 'TS2339'));
            }
        }
    }

    return { fixedIssues, unfixableIssues, modifiedFiles: Array.from(modifiedFilesMap.values()), newFiles };
}

