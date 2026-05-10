// Core types
export * from './types.js';

// Adapter interface and registry
export { ChannelAdapter, AdapterRegistry } from './adapter.js';

// Router
export { ChannelRouter } from './router.js';

// Markdown utilities
export { markdownToMrkdwn, mrkdwnToMarkdown, stripLeadingMention, mrkdwnToPlainText } from './markdown.js';

// Adapters
export { SlackAdapter, DiscordAdapter, TelegramAdapter } from './adapters/index.js';
