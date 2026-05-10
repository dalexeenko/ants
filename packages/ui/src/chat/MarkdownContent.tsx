import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from '../primitives/Text';
import { CodeBlock } from './CodeBlock';
import { useTheme } from '../styles/theme';
import { spacing, fontSize } from '../styles/tokens';
import { createLogger } from '../utils/logger';

const log = createLogger('MarkdownContent');

export interface MarkdownContentProps {
  content: string;
  /** If true, use light text colors (for user messages) */
  inverted?: boolean;
}

// Token types for parsed markdown
type Token =
  | { type: 'text'; content: string }
  | { type: 'code-block'; code: string; language?: string }
  | { type: 'inline-code'; content: string }
  | { type: 'bold'; content: string }
  | { type: 'italic'; content: string }
  | { type: 'link'; text: string; url: string }
  | { type: 'heading'; level: number; content: string }
  | { type: 'list-item'; content: string; ordered: boolean; index?: number }
  | { type: 'blockquote'; content: string }
  | { type: 'hr' }
  | { type: 'paragraph'; content: string };

/**
 * Simple markdown parser that handles common patterns:
 * - Code blocks (```)
 * - Inline code (`)
 * - Bold (**text**)
 * - Italic (*text* or _text_)
 * - Links ([text](url))
 * - Headings (# ## ###)
 * - Lists (- or 1.)
 * - Blockquotes (>)
 * - Horizontal rules (---)
 */
function parseMarkdown(content: string): Token[] {
  const tokens: Token[] = [];
  const lines = content.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Code block
    if (line.startsWith('```')) {
      const language = line.slice(3).trim() || undefined;
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      tokens.push({ type: 'code-block', code: codeLines.join('\n'), language });
      i++; // Skip closing ```
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      tokens.push({
        type: 'heading',
        level: headingMatch[1].length,
        content: headingMatch[2],
      });
      i++;
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|_{3,}|\*{3,})$/.test(line.trim())) {
      tokens.push({ type: 'hr' });
      i++;
      continue;
    }

    // Blockquote
    if (line.startsWith('>')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].startsWith('>')) {
        quoteLines.push(lines[i].slice(1).trim());
        i++;
      }
      tokens.push({ type: 'blockquote', content: quoteLines.join('\n') });
      continue;
    }

    // Unordered list item
    const ulMatch = line.match(/^[-*+]\s+(.+)$/);
    if (ulMatch) {
      tokens.push({ type: 'list-item', content: ulMatch[1], ordered: false });
      i++;
      continue;
    }

    // Ordered list item
    const olMatch = line.match(/^(\d+)\.\s+(.+)$/);
    if (olMatch) {
      tokens.push({
        type: 'list-item',
        content: olMatch[2],
        ordered: true,
        index: parseInt(olMatch[1], 10),
      });
      i++;
      continue;
    }

    // Empty line
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Regular paragraph - collect consecutive non-empty lines
    const paragraphLines: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].startsWith('```') &&
      !lines[i].startsWith('#') &&
      !lines[i].startsWith('>') &&
      !lines[i].match(/^[-*+]\s+/) &&
      !lines[i].match(/^\d+\.\s+/)
    ) {
      paragraphLines.push(lines[i]);
      i++;
    }
    tokens.push({ type: 'paragraph', content: paragraphLines.join(' ') });
  }

  return tokens;
}

// Common TLDs for bare-domain URL detection. Kept intentionally short to
// minimise false positives on prose like "e.g." or "i.e.".
const TLDS = 'com|org|net|io|dev|app|co|me|info|xyz|ai|gg|sh|rs|to|cc|tv|edu|gov|mil|uk|de|fr|jp|au|ca|nl|se|no|fi|ch|at|be|es|it|br|in|ru|pl|cz|eu|us';

// Matches bare domain URLs that are NOT already prefixed with a protocol.
// Requires a known TLD and either a port or path to reduce false positives
// (plain "example.com" in prose is too ambiguous, but "example.com/path" or
// "example.com:8080" is almost certainly a URL).
// Also matches localhost with a port/path.
const BARE_URL_RE = new RegExp(
  '(?<=^|[\\s(\\[])' +                               // preceded by start, whitespace, or opening bracket
  '(' +
    '(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\\.)+' + // subdomains
    '(?:' + TLDS + ')' +                               // TLD
    '(?::\\d{1,5})?' +                                 // optional port
    '(?:/[^\\s)\\]>,]*)?' +                            // optional path
  '|' +
    'localhost(?::\\d{1,5})(?:/[^\\s)\\]>,]*)?' +      // localhost:port[/path]
  ')',
  'g'
);

/**
 * Pre-process text to prefix bare domain URLs with https:// (or http:// for
 * localhost) so the inline parser's existing URL matcher can linkify them.
 * Only converts URLs that contain a path or port to avoid false positives.
 */
function linkifyBareUrls(text: string): string {
  return text.replace(BARE_URL_RE, (match) => {
    // Only linkify if there's a port or path — bare "example.com" is skipped
    if (!/[:/]/.test(match)) return match;
    // Strip trailing punctuation that crept in
    const cleaned = match.replace(/[.),:;!?]+$/, '');
    const suffix = match.slice(cleaned.length);
    if (cleaned.startsWith('localhost')) {
      return 'http://' + cleaned + suffix;
    }
    return 'https://' + cleaned + suffix;
  });
}

/** Open a URL using the platform-appropriate method */
function openUrl(url: string) {
  // Use window.open for web, Linking for native
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const win = typeof globalThis !== 'undefined' ? (globalThis as any).window : undefined;
  if (win?.open) {
    win.open(url, '_blank');
  } else {
    // For native platforms, try to use Linking dynamically
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { Linking } = require('react-native');
      Linking.openURL(url).catch(() => {});
    } catch {
      // Linking not available
    }
  }
}

/**
 * Parse inline formatting within text (bold, italic, code, links)
 */
function parseInlineFormatting(
  text: string,
  colors: ReturnType<typeof useTheme>['colors'],
  palette: ReturnType<typeof useTheme>['palette'],
  inverted: boolean
): React.ReactNode[] {
  const textColor = inverted ? colors.text.inverse : colors.text.primary;
  const codeColor = inverted ? 'rgba(255,255,255,0.9)' : colors.text.primary;
  const codeBgColor = inverted ? 'rgba(255,255,255,0.15)' : colors.bg.tertiary;
  const linkColor = inverted ? palette.link : colors.primary;

  const elements: React.ReactNode[] = [];
  // Pre-process: convert bare domain URLs (github.com/path, localhost:3000)
  // into protocol-prefixed URLs so the https?:// matcher below picks them up.
  let remaining = linkifyBareUrls(text);
  let key = 0;

  while (remaining.length > 0) {
    // Inline code
    const codeMatch = remaining.match(/^`([^`]+)`/);
    if (codeMatch) {
      elements.push(
        <Text
          key={key++}
          style={{
            fontFamily: 'monospace',
            fontSize: fontSize.sm,
            backgroundColor: codeBgColor,
            color: codeColor,
            paddingHorizontal: 4,
            borderRadius: 3,
          }}
        >
          {codeMatch[1]}
        </Text>
      );
      remaining = remaining.slice(codeMatch[0].length);
      continue;
    }

    // Bold
    const boldMatch = remaining.match(/^\*\*([^*]+)\*\*/);
    if (boldMatch) {
      elements.push(
        <Text key={key++} style={{ fontWeight: '700', color: textColor }}>
          {boldMatch[1]}
        </Text>
      );
      remaining = remaining.slice(boldMatch[0].length);
      continue;
    }

    // Italic (asterisk)
    const italicMatch = remaining.match(/^\*([^*]+)\*/);
    if (italicMatch) {
      elements.push(
        <Text key={key++} style={{ fontStyle: 'italic', color: textColor }}>
          {italicMatch[1]}
        </Text>
      );
      remaining = remaining.slice(italicMatch[0].length);
      continue;
    }

    // Italic (underscore)
    const italicMatch2 = remaining.match(/^_([^_]+)_/);
    if (italicMatch2) {
      elements.push(
        <Text key={key++} style={{ fontStyle: 'italic', color: textColor }}>
          {italicMatch2[1]}
        </Text>
      );
      remaining = remaining.slice(italicMatch2[0].length);
      continue;
    }

    // Link (markdown syntax)
    const linkMatch = remaining.match(/^\[([^\]]+)\]\(([^)]+)\)/);
    if (linkMatch) {
      const url = linkMatch[2];
      elements.push(
        <Text
          key={key++}
          style={{ color: linkColor, textDecorationLine: 'underline' }}
          onPress={() => openUrl(url)}
        >
          {linkMatch[1]}
        </Text>
      );
      remaining = remaining.slice(linkMatch[0].length);
      continue;
    }

    // Raw URL (https://... or http://...)
    const urlMatch = remaining.match(/^(https?:\/\/[^\s\])>,]+)/);
    if (urlMatch) {
      const url = urlMatch[1];
      // Strip trailing punctuation that is likely not part of the URL
      const cleaned = url.replace(/[.),:;!?]+$/, '');
      elements.push(
        <Text
          key={key++}
          style={{ color: linkColor, textDecorationLine: 'underline' }}
          onPress={() => openUrl(cleaned)}
        >
          {cleaned}
        </Text>
      );
      remaining = remaining.slice(cleaned.length);
      continue;
    }

    // Regular text - find the next special character or URL start
    const nextSpecial = remaining.search(/[`*_\[]|https?:\/\//);
    if (nextSpecial === -1) {
      elements.push(
        <Text key={key++} style={{ color: textColor }}>
          {remaining}
        </Text>
      );
      break;
    } else if (nextSpecial === 0) {
      // Special character that didn't match a pattern - treat as regular text
      elements.push(
        <Text key={key++} style={{ color: textColor }}>
          {remaining[0]}
        </Text>
      );
      remaining = remaining.slice(1);
    } else {
      elements.push(
        <Text key={key++} style={{ color: textColor }}>
          {remaining.slice(0, nextSpecial)}
        </Text>
      );
      remaining = remaining.slice(nextSpecial);
    }
  }

  return elements;
}

export function MarkdownContent({ content, inverted = false }: MarkdownContentProps) {
  const { colors, palette } = useTheme();
  
  // Guard against non-string content
  if (typeof content !== 'string' || !content) {
    return null;
  }
  
  const tokens = useMemo(() => {
    try {
      return parseMarkdown(content);
    } catch (e) {
      log.error('Failed to parse markdown:', e, content);
      return [{ type: 'paragraph' as const, content }];
    }
  }, [content]);

  const textColor = inverted ? colors.text.inverse : colors.text.primary;
  const mutedColor = inverted ? 'rgba(255,255,255,0.7)' : colors.text.muted;
  const borderColor = inverted ? 'rgba(255,255,255,0.2)' : colors.border.light;
  const bgColor = inverted ? 'rgba(255,255,255,0.1)' : colors.bg.secondary;

  const isLast = (index: number) => index === tokens.length - 1;

  return (
    <View style={styles.container}>
      {tokens.map((token, index) => {
        switch (token.type) {
          case 'code-block':
            return (
              <CodeBlock
                key={index}
                code={token.code}
                language={token.language}
              />
            );

          case 'heading':
            const headingSize =
              token.level === 1
                ? fontSize.xl
                : token.level === 2
                ? fontSize.lg
                : fontSize.base;
            return (
              <Text
                key={index}
                selectable
                style={[
                  styles.heading,
                  {
                    fontSize: headingSize,
                    color: textColor,
                    marginTop: index > 0 ? spacing[3] : 0,
                  },
                ]}
              >
                {token.content}
              </Text>
            );

          case 'hr':
            return (
              <View
                key={index}
                style={[styles.hr, { backgroundColor: borderColor }]}
              />
            );

          case 'blockquote':
            return (
              <View
                key={index}
                style={[
                  styles.blockquote,
                  { borderLeftColor: borderColor, backgroundColor: bgColor },
                ]}
              >
                <Text selectable style={{ color: mutedColor, fontStyle: 'italic' }}>
                  {token.content}
                </Text>
              </View>
            );

          case 'list-item':
            return (
              <View key={index} style={[styles.listItem, !isLast(index) && { marginBottom: spacing[1] }]}>
                <Text style={[styles.bullet, { color: mutedColor }]}>
                  {token.ordered ? `${token.index}.` : '\u2022'}
                </Text>
                <Text selectable style={[styles.listText, { color: textColor }]}>
                  {parseInlineFormatting(token.content, colors, palette, inverted)}
                </Text>
              </View>
            );

          case 'paragraph':
            return (
              <Text key={index} selectable style={[styles.paragraph, { color: textColor }, !isLast(index) && { marginBottom: spacing[2] }]}>
                {parseInlineFormatting(token.content, colors, palette, inverted)}
              </Text>
            );

          default:
            return null;
        }
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    // Using marginBottom on children instead of gap for React Native Web compatibility
  },
  heading: {
    fontWeight: '600',
    marginBottom: spacing[1],
  },
  paragraph: {
    lineHeight: 22,
  },
  hr: {
    height: 1,
    marginVertical: spacing[2],
  },
  blockquote: {
    paddingLeft: spacing[3],
    paddingVertical: spacing[2],
    borderLeftWidth: 3,
    marginVertical: spacing[1],
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginVertical: spacing[0.5],
  },
  bullet: {
    width: 20,
    marginRight: spacing[1],
  },
  listText: {
    flex: 1,
    lineHeight: 22,
  },
});
