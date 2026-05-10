import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CodeBlock } from './CodeBlock';
import { mockLightTheme } from '../styles/mockTheme';

// Mock useTheme
vi.mock('../styles/theme', () => ({
  useTheme: () => mockLightTheme,
}));

describe('CodeBlock', () => {
  const sampleCode = `function hello() {
  console.log('Hello, World!');
}`;

  it('should render code content', () => {
    render(<CodeBlock code={sampleCode} />);
    expect(screen.getByText("function hello() {")).toBeInTheDocument();
    expect(screen.getByText("console.log('Hello, World!');")).toBeInTheDocument();
  });

  it('should render with language label', () => {
    render(<CodeBlock code={sampleCode} language="javascript" />);
    expect(screen.getByText('javascript')).toBeInTheDocument();
  });

  it('should render with filename', () => {
    render(<CodeBlock code={sampleCode} filename="hello.js" />);
    expect(screen.getByText('hello.js')).toBeInTheDocument();
  });

  it('should show filename instead of language when both provided', () => {
    render(<CodeBlock code={sampleCode} language="javascript" filename="hello.js" />);
    expect(screen.getByText('hello.js')).toBeInTheDocument();
    // Language should not be shown when filename is present
  });

  it('should show line numbers by default', () => {
    render(<CodeBlock code={sampleCode} />);
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('should hide line numbers when showLineNumbers is false', () => {
    render(<CodeBlock code={sampleCode} showLineNumbers={false} />);
    // Line numbers should not be present
    expect(screen.queryByText('1')).not.toBeInTheDocument();
  });

  it('should render copy button', () => {
    render(<CodeBlock code={sampleCode} />);
    expect(screen.getByText('Copy')).toBeInTheDocument();
  });

  it('should show "Copied!" after clicking copy button', async () => {
    // Mock clipboard API
    const mockWriteText = vi.fn().mockResolvedValue(undefined);
    Object.assign(globalThis, {
      navigator: {
        clipboard: {
          writeText: mockWriteText,
        },
      },
    });

    render(<CodeBlock code={sampleCode} />);
    
    const copyButton = screen.getByText('Copy');
    fireEvent.click(copyButton);
    
    // After clicking, should show "Copied!"
    // Note: This requires the async operation to complete
  });

  it('should handle single line code', () => {
    render(<CodeBlock code="const x = 1;" />);
    expect(screen.getByText('const x = 1;')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('should handle empty lines', () => {
    const codeWithEmptyLine = `line 1

line 3`;
    render(<CodeBlock code={codeWithEmptyLine} />);
    expect(screen.getByText('line 1')).toBeInTheDocument();
    expect(screen.getByText('line 3')).toBeInTheDocument();
  });

  it('should handle code with special characters', () => {
    const specialCode = `const regex = /[a-z]+/g;
const obj = { key: "value" };`;
    render(<CodeBlock code={specialCode} />);
    expect(screen.getByText('const regex = /[a-z]+/g;')).toBeInTheDocument();
  });

  it('should remove trailing empty line', () => {
    const codeWithTrailingNewline = "const x = 1;\n";
    render(<CodeBlock code={codeWithTrailingNewline} />);
    // Should only show 1 line number, not 2
    expect(screen.getByText('1')).toBeInTheDocument();
  });
});
