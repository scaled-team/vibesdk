import type { ChatMessage } from './message-helpers';

/**
 * Deduplicates consecutive messages with identical content per role.
 *
 * This handles cases where the backend sends duplicate responses after tool execution,
 * even when tool messages appear between them, AND where user messages appear twice
 * (e.g. from optimistic UI + conversation_state restoration).
 *
 * Algorithm:
 * - For each assistant message, checks if the last assistant (not necessarily adjacent) has identical content
 * - For each user message, checks if the last user (not necessarily adjacent) has identical content
 * - If duplicate found, skips the current message
 * - All other message types are kept as-is
 *
 * @param messages - Array of chat messages to deduplicate
 * @returns Deduplicated array of messages
 */
export function deduplicateMessages(messages: readonly ChatMessage[]): ChatMessage[] {
    if (messages.length === 0) return [];

    const result: ChatMessage[] = [];
    let lastAssistantContent: string | null = null;
    let lastUserContent: string | null = null;

    for (const msg of messages) {
        if (msg.role === 'assistant') {
            if (lastAssistantContent !== null && msg.content === lastAssistantContent) {
                continue; // Skip duplicate assistant message
            }
            result.push(msg);
            lastAssistantContent = msg.content;
        } else if (msg.role === 'user') {
            if (lastUserContent !== null && msg.content === lastUserContent) {
                continue; // Skip duplicate user message
            }
            result.push(msg);
            lastUserContent = msg.content;
        } else {
            // Keep all other message types (tool, system, etc.)
            result.push(msg);
        }
    }

    return result;
}

/**
 * Check if a new assistant message would be a duplicate of the last assistant message.
 * Used for live streaming to prevent adding duplicates.
 * 
 * @param messages - Current messages array
 * @param newContent - Content of the new assistant message
 * @returns true if this would be a duplicate, false otherwise
 */
export function isAssistantMessageDuplicate(
    messages: readonly ChatMessage[],
    newContent: string
): boolean {
    // Find the last assistant message
    for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'assistant') {
            return messages[i].content === newContent;
        }
    }
    return false; // No previous assistant message found
}
