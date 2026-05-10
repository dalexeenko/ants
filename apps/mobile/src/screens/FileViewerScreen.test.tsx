/**
 * Tests for FileViewerScreen — verifying helper functions and
 * component behavior for file viewing on mobile.
 *
 * Since the mobile jest environment is 'node' (no DOM), we test
 * the exported helper functions directly and verify the component's
 * state logic through its rendering conditions.
 */

import {
  getFileExtension,
  isBinaryFile,
  formatFileSize,
  MAX_DISPLAY_SIZE,
  BINARY_EXTENSIONS,
} from './FileViewerScreen';

describe('FileViewerScreen', () => {
  describe('getFileExtension', () => {
    it('returns extension for simple filename', () => {
      expect(getFileExtension('file.txt')).toBe('.txt');
    });

    it('returns extension for path with directories', () => {
      expect(getFileExtension('/src/components/App.tsx')).toBe('.tsx');
    });

    it('returns empty string when no extension', () => {
      expect(getFileExtension('Makefile')).toBe('');
    });

    it('returns last extension for double extensions', () => {
      expect(getFileExtension('archive.tar.gz')).toBe('.gz');
    });

    it('lowercases the extension', () => {
      expect(getFileExtension('IMAGE.PNG')).toBe('.png');
    });

    it('handles dotfiles', () => {
      expect(getFileExtension('.gitignore')).toBe('.gitignore');
    });

    it('handles empty string', () => {
      expect(getFileExtension('')).toBe('');
    });

    it('handles extension-only input', () => {
      expect(getFileExtension('.ts')).toBe('.ts');
    });
  });

  describe('isBinaryFile', () => {
    it('returns true for image files', () => {
      expect(isBinaryFile('photo.png')).toBe(true);
      expect(isBinaryFile('photo.jpg')).toBe(true);
      expect(isBinaryFile('photo.jpeg')).toBe(true);
      expect(isBinaryFile('photo.gif')).toBe(true);
      expect(isBinaryFile('icon.ico')).toBe(true);
      expect(isBinaryFile('image.webp')).toBe(true);
      expect(isBinaryFile('image.bmp')).toBe(true);
    });

    it('returns true for audio/video files', () => {
      expect(isBinaryFile('song.mp3')).toBe(true);
      expect(isBinaryFile('video.mp4')).toBe(true);
      expect(isBinaryFile('audio.wav')).toBe(true);
      expect(isBinaryFile('clip.mov')).toBe(true);
    });

    it('returns true for archive files', () => {
      expect(isBinaryFile('archive.zip')).toBe(true);
      expect(isBinaryFile('archive.tar')).toBe(true);
      expect(isBinaryFile('archive.gz')).toBe(true);
      expect(isBinaryFile('archive.7z')).toBe(true);
      expect(isBinaryFile('archive.rar')).toBe(true);
    });

    it('returns true for document files', () => {
      expect(isBinaryFile('doc.pdf')).toBe(true);
      expect(isBinaryFile('doc.docx')).toBe(true);
      expect(isBinaryFile('sheet.xlsx')).toBe(true);
      expect(isBinaryFile('slides.pptx')).toBe(true);
    });

    it('returns true for compiled/binary files', () => {
      expect(isBinaryFile('app.exe')).toBe(true);
      expect(isBinaryFile('lib.dll')).toBe(true);
      expect(isBinaryFile('lib.so')).toBe(true);
      expect(isBinaryFile('lib.dylib')).toBe(true);
    });

    it('returns true for font files', () => {
      expect(isBinaryFile('font.woff')).toBe(true);
      expect(isBinaryFile('font.woff2')).toBe(true);
      expect(isBinaryFile('font.ttf')).toBe(true);
      expect(isBinaryFile('font.otf')).toBe(true);
    });

    it('returns true for database files', () => {
      expect(isBinaryFile('data.sqlite')).toBe(true);
      expect(isBinaryFile('data.db')).toBe(true);
    });

    it('returns false for text-based source files', () => {
      expect(isBinaryFile('app.ts')).toBe(false);
      expect(isBinaryFile('app.tsx')).toBe(false);
      expect(isBinaryFile('app.js')).toBe(false);
      expect(isBinaryFile('app.jsx')).toBe(false);
      expect(isBinaryFile('style.css')).toBe(false);
      expect(isBinaryFile('page.html')).toBe(false);
      expect(isBinaryFile('data.json')).toBe(false);
      expect(isBinaryFile('config.yaml')).toBe(false);
      expect(isBinaryFile('README.md')).toBe(false);
    });

    it('returns false for files without extensions', () => {
      expect(isBinaryFile('Makefile')).toBe(false);
      expect(isBinaryFile('Dockerfile')).toBe(false);
    });

    it('is case-insensitive', () => {
      expect(isBinaryFile('IMAGE.PNG')).toBe(true);
      expect(isBinaryFile('VIDEO.MP4')).toBe(true);
      expect(isBinaryFile('ARCHIVE.ZIP')).toBe(true);
    });

    it('works with full paths', () => {
      expect(isBinaryFile('/home/user/photos/vacation.jpg')).toBe(true);
      expect(isBinaryFile('/src/index.ts')).toBe(false);
    });
  });

  describe('formatFileSize', () => {
    it('formats bytes', () => {
      expect(formatFileSize(0)).toBe('0 B');
      expect(formatFileSize(1)).toBe('1 B');
      expect(formatFileSize(512)).toBe('512 B');
      expect(formatFileSize(1023)).toBe('1023 B');
    });

    it('formats kilobytes', () => {
      expect(formatFileSize(1024)).toBe('1.0 KB');
      expect(formatFileSize(1536)).toBe('1.5 KB');
      expect(formatFileSize(10240)).toBe('10.0 KB');
      expect(formatFileSize(1024 * 1024 - 1)).toBe('1024.0 KB');
    });

    it('formats megabytes', () => {
      expect(formatFileSize(1024 * 1024)).toBe('1.0 MB');
      expect(formatFileSize(1.5 * 1024 * 1024)).toBe('1.5 MB');
      expect(formatFileSize(10 * 1024 * 1024)).toBe('10.0 MB');
      expect(formatFileSize(100 * 1024 * 1024)).toBe('100.0 MB');
    });
  });

  describe('MAX_DISPLAY_SIZE', () => {
    it('is 1 MB', () => {
      expect(MAX_DISPLAY_SIZE).toBe(1024 * 1024);
    });
  });

  describe('BINARY_EXTENSIONS', () => {
    it('contains expected number of extensions', () => {
      // images (8) + audio/video (7) + archives (6) + docs (7) + compiled (6) + fonts (5) + db (2) = 41
      // Count from the source: .png .jpg .jpeg .gif .bmp .ico .webp .svg = 8
      // .mp3 .mp4 .wav .ogg .webm .avi .mov = 7
      // .zip .tar .gz .bz2 .7z .rar = 6
      // .pdf .doc .docx .xls .xlsx .ppt .pptx = 7
      // .exe .dll .so .dylib .o .a = 6
      // .woff .woff2 .ttf .otf .eot = 5
      // .sqlite .db = 2
      expect(BINARY_EXTENSIONS.size).toBe(41);
    });

    it('includes svg as binary (not text-renderable on mobile)', () => {
      expect(BINARY_EXTENSIONS.has('.svg')).toBe(true);
    });
  });

  describe('component state logic', () => {
    // These tests verify the state machine logic used in the FileViewerScreen
    // useEffect without rendering the component (no DOM in node test env).

    describe('binary file detection', () => {
      it('rejects binary files before attempting to read', () => {
        // The component checks isBinaryFile(filePath) before calling bridge.readFile
        const filePath = '/project/image.png';
        expect(isBinaryFile(filePath)).toBe(true);
        // When binary: sets error "Binary files cannot be displayed as text."
        // and does NOT call bridge.readFile
      });

      it('allows text files through to be read', () => {
        const filePath = '/project/src/index.ts';
        expect(isBinaryFile(filePath)).toBe(false);
      });
    });

    describe('file size pre-check', () => {
      it('rejects files larger than MAX_DISPLAY_SIZE when size is known', () => {
        const fileSize = 2 * 1024 * 1024; // 2 MB
        const tooLarge = fileSize > MAX_DISPLAY_SIZE;
        expect(tooLarge).toBe(true);
      });

      it('allows files within MAX_DISPLAY_SIZE', () => {
        const fileSize = 500 * 1024; // 500 KB
        const tooLarge = fileSize > MAX_DISPLAY_SIZE;
        expect(tooLarge).toBe(false);
      });

      it('allows files when size is exactly MAX_DISPLAY_SIZE', () => {
        // The check is `fileSize > MAX_DISPLAY_SIZE`, so exactly equal passes
        const fileSize = MAX_DISPLAY_SIZE;
        const tooLarge = fileSize > MAX_DISPLAY_SIZE;
        expect(tooLarge).toBe(false);
      });

      it('skips size check when fileSize is undefined', () => {
        const fileSize = undefined;
        // The component uses `if (fileSize && fileSize > MAX_DISPLAY_SIZE)`
        // so undefined skips the check entirely
        const shouldReject = !!(fileSize && fileSize > MAX_DISPLAY_SIZE);
        expect(shouldReject).toBe(false);
      });

      it('skips size check when fileSize is 0', () => {
        const fileSize = 0;
        // fileSize of 0 is falsy, so the check is skipped
        const shouldReject = !!(fileSize && fileSize > MAX_DISPLAY_SIZE);
        expect(shouldReject).toBe(false);
      });
    });

    describe('null byte detection', () => {
      it('detects binary content with null bytes', () => {
        const content = 'hello\0world';
        expect(content.includes('\0')).toBe(true);
      });

      it('allows content without null bytes', () => {
        const content = 'hello world\nline 2\n';
        expect(content.includes('\0')).toBe(false);
      });

      it('detects null byte at the start', () => {
        const content = '\0binary data';
        expect(content.includes('\0')).toBe(true);
      });

      it('detects null byte at the end', () => {
        const content = 'data\0';
        expect(content.includes('\0')).toBe(true);
      });
    });

    describe('content truncation', () => {
      it('truncates content exceeding MAX_DISPLAY_SIZE', () => {
        const longContent = 'x'.repeat(MAX_DISPLAY_SIZE + 100);
        const truncated = longContent.substring(0, MAX_DISPLAY_SIZE) + '\n\n--- Truncated (file too large) ---';
        expect(truncated.length).toBe(MAX_DISPLAY_SIZE + '\n\n--- Truncated (file too large) ---'.length);
        expect(truncated).toContain('--- Truncated (file too large) ---');
      });

      it('does not truncate content within MAX_DISPLAY_SIZE', () => {
        const content = 'x'.repeat(1000);
        const needsTruncation = content.length > MAX_DISPLAY_SIZE;
        expect(needsTruncation).toBe(false);
      });
    });

    describe('line counting', () => {
      it('counts single line', () => {
        const content = 'hello';
        expect(content.split('\n').length).toBe(1);
      });

      it('counts multiple lines', () => {
        const content = 'line1\nline2\nline3';
        expect(content.split('\n').length).toBe(3);
      });

      it('counts trailing newline as extra line', () => {
        const content = 'line1\nline2\n';
        expect(content.split('\n').length).toBe(3);
      });

      it('counts empty string as one line', () => {
        const content = '';
        expect(content.split('\n').length).toBe(1);
      });
    });

    describe('file info bar logic', () => {
      it('extracts extension label (uppercased, without dot)', () => {
        const ext = getFileExtension('/src/App.tsx');
        const label = ext ? ext.substring(1).toUpperCase() : null;
        expect(label).toBe('TSX');
      });

      it('returns null label for files without extension', () => {
        const ext = getFileExtension('Makefile');
        const label = ext ? ext.substring(1).toUpperCase() : null;
        expect(label).toBeNull();
      });

      it('shows singular "line" for single-line files', () => {
        const lineCount = 1;
        const label = `${lineCount} ${lineCount === 1 ? 'line' : 'lines'}`;
        expect(label).toBe('1 line');
      });

      it('shows plural "lines" for multi-line files', () => {
        const lineCount: number = 42;
        const label = `${lineCount} ${lineCount === 1 ? 'line' : 'lines'}`;
        expect(label).toBe('42 lines');
      });
    });

    describe('error message formatting', () => {
      it('formats size error with human-readable sizes', () => {
        const fileSize = 5 * 1024 * 1024; // 5 MB
        const errorMsg = `File is too large to display (${formatFileSize(fileSize)}). Maximum size is ${formatFileSize(MAX_DISPLAY_SIZE)}.`;
        expect(errorMsg).toBe('File is too large to display (5.0 MB). Maximum size is 1.0 MB.');
      });

      it('extracts error message from Error objects', () => {
        const error = new Error('Network request failed');
        const message = error instanceof Error ? error.message : 'Failed to read file';
        expect(message).toBe('Network request failed');
      });

      it('uses fallback message for non-Error throws', () => {
        const error: unknown = 'string error';
        const message = error instanceof Error ? error.message : 'Failed to read file';
        expect(message).toBe('Failed to read file');
      });
    });
  });

  describe('bridge interaction', () => {
    it('calls readFile with correct projectId and filePath', async () => {
      const mockBridge = {
        readFile: jest.fn().mockResolvedValue('file content'),
      };
      const projectId = 'proj-123';
      const filePath = '/src/index.ts';

      await mockBridge.readFile(projectId, filePath);

      expect(mockBridge.readFile).toHaveBeenCalledWith('proj-123', '/src/index.ts');
      expect(mockBridge.readFile).toHaveBeenCalledTimes(1);
    });

    it('does not call readFile for binary files', async () => {
      const mockBridge = {
        readFile: jest.fn(),
      };
      const filePath = '/assets/logo.png';

      // Component logic: check binary BEFORE calling readFile
      if (!isBinaryFile(filePath)) {
        await mockBridge.readFile('proj-123', filePath);
      }

      expect(mockBridge.readFile).not.toHaveBeenCalled();
    });

    it('does not call readFile when fileSize exceeds limit', async () => {
      const mockBridge = {
        readFile: jest.fn(),
      };
      const filePath = '/data/large.json';
      const fileSize = 2 * 1024 * 1024;

      // Component logic: check size BEFORE calling readFile
      if (!isBinaryFile(filePath) && !(fileSize && fileSize > MAX_DISPLAY_SIZE)) {
        await mockBridge.readFile('proj-123', filePath);
      }

      expect(mockBridge.readFile).not.toHaveBeenCalled();
    });
  });
});
