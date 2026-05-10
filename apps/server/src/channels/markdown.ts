/**
 * Markdown conversion utilities for Slack mrkdwn <-> standard markdown
 * 
 * Slack mrkdwn differences from standard markdown:
 * - Bold: *text* instead of **text**
 * - Italic: _text_ instead of *text*
 * - Strike: ~text~ (same)
 * - Links: <url|text> instead of [text](url)
 * - Code: `code` (same)
 * - Code blocks: ```code``` (same)
 * - Lists: Same
 * - Blockquotes: > (same)
 */

/**
 * Convert standard markdown to Slack mrkdwn
 */
export function markdownToMrkdwn(markdown: string): string {
  let result = markdown;

  // Protect code blocks from conversion
  const codeBlocks: string[] = [];
  result = result.replace(/```[\s\S]*?```/g, (match) => {
    codeBlocks.push(match);
    return `__CODE_BLOCK_${codeBlocks.length - 1}__`;
  });

  // Protect inline code from conversion
  const inlineCode: string[] = [];
  result = result.replace(/`[^`]+`/g, (match) => {
    inlineCode.push(match);
    return `__INLINE_CODE_${inlineCode.length - 1}__`;
  });

  // Convert links first
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<$2|$1>');

  // Convert bold+italic: ***text*** -> *_text_*
  result = result.replace(/\*\*\*([^*]+)\*\*\*/g, '*_$1_*');

  // Convert bold: **text** -> *text*
  result = result.replace(/\*\*([^*]+)\*\*/g, '*$1*');

  // Convert italic: *text* -> _text_ (single asterisks only)
  // Need to be careful not to match the bold we just created
  // Use a regex that matches single * not preceded or followed by *
  result = result.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '_$1_');

  // Convert strikethrough: ~~text~~ -> ~text~
  result = result.replace(/~~([^~]+)~~/g, '~$1~');

  // Restore code blocks
  for (let i = codeBlocks.length - 1; i >= 0; i--) {
    result = result.replace(`__CODE_BLOCK_${i}__`, codeBlocks[i]);
  }

  // Restore inline code
  for (let i = inlineCode.length - 1; i >= 0; i--) {
    result = result.replace(`__INLINE_CODE_${i}__`, inlineCode[i]);
  }

  return result;
}

/**
 * Convert Slack mrkdwn to standard markdown
 */
export function mrkdwnToMarkdown(mrkdwn: string): string {
  let result = mrkdwn;

  // Protect code blocks from conversion
  const codeBlocks: string[] = [];
  result = result.replace(/```[\s\S]*?```/g, (match) => {
    codeBlocks.push(match);
    return `__CODE_BLOCK_${codeBlocks.length - 1}__`;
  });

  // Protect inline code from conversion
  const inlineCode: string[] = [];
  result = result.replace(/`[^`]+`/g, (match) => {
    inlineCode.push(match);
    return `__INLINE_CODE_${inlineCode.length - 1}__`;
  });

  // Convert Slack links: <url|text> -> [text](url)
  // Also handle <url> without text
  result = result.replace(/<([^|>]+)\|([^>]+)>/g, '[$2]($1)');
  result = result.replace(/<(https?:\/\/[^>]+)>/g, '$1');

  // Convert Slack user mentions: <@U123456> -> @user
  // We can't resolve the actual username without API calls, so keep as-is
  // result = result.replace(/<@([A-Z0-9]+)>/g, '@$1');

  // Convert Slack channel mentions: <#C123456|channel-name> -> #channel-name
  result = result.replace(/<#[A-Z0-9]+\|([^>]+)>/g, '#$1');

  // Convert bold+italic: *_text_* -> ***text***
  result = result.replace(/\*_([^_]+)_\*/g, '***$1***');

  // Convert bold: *text* -> **text**
  // Be careful not to convert italic underscores
  result = result.replace(/(?<!_)\*([^*_]+)\*(?!_)/g, '**$1**');

  // Convert italic: _text_ -> *text*
  result = result.replace(/_([^_]+)_/g, '*$1*');

  // Convert strikethrough: ~text~ -> ~~text~~
  result = result.replace(/~([^~]+)~/g, '~~$1~~');

  // Restore code blocks
  for (let i = codeBlocks.length - 1; i >= 0; i--) {
    result = result.replace(`__CODE_BLOCK_${i}__`, codeBlocks[i]);
  }

  // Restore inline code
  for (let i = inlineCode.length - 1; i >= 0; i--) {
    result = result.replace(`__INLINE_CODE_${i}__`, inlineCode[i]);
  }

  return result;
}

/**
 * Strip @mentions from the beginning of a message
 * Used to clean up the trigger mention before sending to agent
 */
export function stripLeadingMention(text: string, botUserId: string): string {
  // Remove leading <@BOTID> mention
  const mentionPattern = new RegExp(`^\\s*<@${botUserId}>\\s*`, 'i');
  return text.replace(mentionPattern, '').trim();
}

/**
 * Extract plain text from Slack mrkdwn (remove all formatting)
 */
export function mrkdwnToPlainText(mrkdwn: string): string {
  let result = mrkdwn;

  // Remove code blocks
  result = result.replace(/```[\s\S]*?```/g, '[code]');

  // Remove inline code
  result = result.replace(/`([^`]+)`/g, '$1');

  // Convert links to just the text
  result = result.replace(/<([^|>]+)\|([^>]+)>/g, '$2');
  result = result.replace(/<(https?:\/\/[^>]+)>/g, '$1');

  // Remove user mentions display
  result = result.replace(/<@[A-Z0-9]+>/g, '@user');

  // Remove channel mentions
  result = result.replace(/<#[A-Z0-9]+\|([^>]+)>/g, '#$1');

  // Remove formatting
  result = result.replace(/\*([^*]+)\*/g, '$1');
  result = result.replace(/_([^_]+)_/g, '$1');
  result = result.replace(/~([^~]+)~/g, '$1');

  return result.trim();
}
