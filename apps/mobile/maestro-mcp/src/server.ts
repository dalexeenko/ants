#!/usr/bin/env node
/**
 * Maestro MCP Server
 *
 * A Model Context Protocol server that wraps Maestro CLI and simulator
 * management commands, enabling AI agents to interact with the OpenMgr
 * React Native mobile app on iOS Simulator and Android Emulator.
 *
 * Usage:
 *   node dist/server.js
 *
 * MCP config:
 *   {
 *     "mcpServers": {
 *       "mobile-testing": {
 *         "command": "node",
 *         "args": ["./app/packages/mobile/maestro-mcp/dist/server.js"]
 *       }
 *     }
 *   }
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { exec, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

const APP_ID = 'host.exp.Exponent';

// ---------------------------------------------------------------------------
// Helper: run a command and return stdout/stderr
// ---------------------------------------------------------------------------

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

// Detect JAVA_HOME for Maestro (Homebrew OpenJDK on macOS)
function getJavaHome(): string | undefined {
  if (process.env.JAVA_HOME) return process.env.JAVA_HOME;
  // Common Homebrew OpenJDK paths on macOS
  const candidates = [
    '/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home',
    '/usr/local/opt/openjdk/libexec/openjdk.jdk/Contents/Home',
    '/Library/Java/JavaVirtualMachines/openjdk.jdk/Contents/Home',
  ];
  for (const p of candidates) {
    try {
      require('node:fs').accessSync(p);
      return p;
    } catch { /* not found */ }
  }
  return undefined;
}

const JAVA_HOME = getJavaHome();

function getEnv(): Record<string, string | undefined> {
  return { ...process.env, ...(JAVA_HOME ? { JAVA_HOME } : {}) };
}

async function run(command: string, args: string[] = [], timeoutMs = 120_000): Promise<RunResult> {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024, // 10 MB
      env: getEnv(),
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? String(err),
      exitCode: e.code ?? 1,
    };
  }
}

async function runShell(command: string, timeoutMs = 120_000): Promise<RunResult> {
  try {
    const { stdout, stderr } = await execAsync(command, {
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
      env: getEnv(),
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? String(err),
      exitCode: e.code ?? 1,
    };
  }
}

// ---------------------------------------------------------------------------
// Helper: run a single inline Maestro command
// ---------------------------------------------------------------------------

async function runMaestroCommand(yamlContent: string): Promise<RunResult> {
  const tmpDir = await mkdtemp(join(tmpdir(), 'maestro-mcp-'));
  const flowFile = join(tmpDir, 'command.yaml');
  const { writeFile } = await import('node:fs/promises');
  await writeFile(flowFile, yamlContent, 'utf-8');
  try {
    return await run('maestro', ['test', flowFile], 60_000);
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: 'mobile_launch_simulator',
    description:
      'Boot an iOS Simulator or Android Emulator. For iOS, provide a device name (e.g., "iPhone 16"). For Android, provide an AVD name (e.g., "Pixel_8_API_35").',
    inputSchema: {
      type: 'object' as const,
      properties: {
        platform: {
          type: 'string',
          enum: ['ios', 'android'],
          description: 'Target platform',
        },
        device: {
          type: 'string',
          description: 'Device/AVD name (e.g., "iPhone 16" or "Pixel_8_API_35")',
        },
      },
      required: ['platform', 'device'],
    },
  },
  {
    name: 'mobile_list_devices',
    description: 'List available iOS Simulators or Android Emulators.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        platform: {
          type: 'string',
          enum: ['ios', 'android'],
          description: 'Target platform',
        },
      },
      required: ['platform'],
    },
  },
  {
    name: 'mobile_install_app',
    description:
      'Build and install the OpenMgr app on the running simulator/emulator using Expo.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        platform: {
          type: 'string',
          enum: ['ios', 'android'],
          description: 'Target platform',
        },
        device: {
          type: 'string',
          description: 'Optional: specific device name',
        },
      },
      required: ['platform'],
    },
  },
  {
    name: 'mobile_launch_app',
    description: 'Launch the OpenMgr app on the running simulator/emulator.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'mobile_stop_app',
    description: 'Force stop the OpenMgr app.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'mobile_tap',
    description:
      'Tap on an element by testID or visible text. Prefer testID for deterministic selection.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: {
          type: 'string',
          description: 'testID of the element to tap (e.g., "openmgr-drawer-toggle")',
        },
        text: {
          type: 'string',
          description: 'Visible text of the element to tap (alternative to id)',
        },
      },
    },
  },
  {
    name: 'mobile_type',
    description: 'Type text into the currently focused input field, or into a field identified by testID.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        text: {
          type: 'string',
          description: 'Text to type',
        },
        id: {
          type: 'string',
          description: 'Optional: testID of the input field to focus first',
        },
      },
      required: ['text'],
    },
  },
  {
    name: 'mobile_swipe',
    description: 'Swipe in a direction on the screen.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        direction: {
          type: 'string',
          enum: ['up', 'down', 'left', 'right'],
          description: 'Swipe direction',
        },
      },
      required: ['direction'],
    },
  },
  {
    name: 'mobile_scroll',
    description: 'Scroll the screen in a direction.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        direction: {
          type: 'string',
          enum: ['up', 'down'],
          description: 'Scroll direction',
        },
      },
      required: ['direction'],
    },
  },
  {
    name: 'mobile_assert_visible',
    description: 'Assert that an element is visible on screen by testID or text.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: {
          type: 'string',
          description: 'testID of the element',
        },
        text: {
          type: 'string',
          description: 'Visible text of the element',
        },
      },
    },
  },
  {
    name: 'mobile_screenshot',
    description:
      'Capture a screenshot of the current screen. Returns the screenshot as a base64-encoded image.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        platform: {
          type: 'string',
          enum: ['ios', 'android'],
          description: 'Target platform (default: ios)',
        },
      },
    },
  },
  {
    name: 'mobile_hierarchy',
    description:
      'Get the view/accessibility hierarchy of the current screen. Returns a structured text representation of all visible elements.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        platform: {
          type: 'string',
          enum: ['ios', 'android'],
          description: 'Target platform (default: ios)',
        },
      },
    },
  },
  {
    name: 'mobile_run_flow',
    description:
      'Execute a named Maestro YAML flow file. Flow files are in app/packages/mobile/maestro/flows/.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        flow: {
          type: 'string',
          description:
            'Path to the flow file, relative to maestro/flows/ (e.g., "app-launch.yaml")',
        },
      },
      required: ['flow'],
    },
  },
  {
    name: 'mobile_back',
    description: 'Press the back button (Android) or swipe back (iOS).',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
];

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

async function handleTool(
  name: string,
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: string; text?: string; data?: string; mimeType?: string }> }> {
  switch (name) {
    // -----------------------------------------------------------------------
    case 'mobile_launch_simulator': {
      const platform = args.platform as string;
      const device = args.device as string;

      if (platform === 'ios') {
        const result = await run('xcrun', ['simctl', 'boot', device]);
        if (result.exitCode !== 0 && !result.stderr.includes('current state: Booted')) {
          return { content: [{ type: 'text', text: `Failed to boot iOS Simulator "${device}": ${result.stderr}` }] };
        }
        return { content: [{ type: 'text', text: `iOS Simulator "${device}" is booted.` }] };
      } else {
        // Android: launch emulator in background
        const result = await runShell(`emulator -avd ${device} -no-window -no-audio &`);
        // Wait a bit for the emulator to start
        await new Promise((resolve) => setTimeout(resolve, 5000));
        return { content: [{ type: 'text', text: `Android Emulator "${device}" launch initiated. ${result.stdout}` }] };
      }
    }

    // -----------------------------------------------------------------------
    case 'mobile_list_devices': {
      const platform = args.platform as string;

      if (platform === 'ios') {
        const result = await run('xcrun', ['simctl', 'list', 'devices', 'available']);
        return { content: [{ type: 'text', text: result.stdout || result.stderr }] };
      } else {
        const result = await run('emulator', ['-list-avds']);
        return { content: [{ type: 'text', text: result.stdout || result.stderr }] };
      }
    }

    // -----------------------------------------------------------------------
    case 'mobile_install_app': {
      const platform = args.platform as string;
      const device = args.device as string | undefined;

      const cmdArgs = platform === 'ios' ? ['expo', 'run:ios'] : ['expo', 'run:android'];
      if (device) {
        cmdArgs.push('--device', device);
      }

      const result = await run('npx', cmdArgs, 300_000); // 5 min timeout for builds
      return {
        content: [{
          type: 'text',
          text: result.exitCode === 0
            ? `App installed successfully on ${platform}.`
            : `Failed to install app: ${result.stderr}\n${result.stdout}`,
        }],
      };
    }

    // -----------------------------------------------------------------------
    case 'mobile_launch_app': {
      const yaml = `appId: ${APP_ID}\n---\n- launchApp\n`;
      const result = await runMaestroCommand(yaml);
      return {
        content: [{
          type: 'text',
          text: result.exitCode === 0
            ? 'App launched successfully.'
            : `Failed to launch app: ${result.stderr}\n${result.stdout}`,
        }],
      };
    }

    // -----------------------------------------------------------------------
    case 'mobile_stop_app': {
      const yaml = `appId: ${APP_ID}\n---\n- stopApp\n`;
      const result = await runMaestroCommand(yaml);
      return {
        content: [{
          type: 'text',
          text: result.exitCode === 0
            ? 'App stopped.'
            : `Failed to stop app: ${result.stderr}\n${result.stdout}`,
        }],
      };
    }

    // -----------------------------------------------------------------------
    case 'mobile_tap': {
      const id = args.id as string | undefined;
      const text = args.text as string | undefined;

      if (!id && !text) {
        return { content: [{ type: 'text', text: 'Error: provide either "id" or "text" to tap.' }] };
      }

      let tapStep: string;
      if (id) {
        tapStep = `- tapOn:\n    id: "${id}"`;
      } else {
        tapStep = `- tapOn:\n    text: "${text}"`;
      }

      const yaml = `appId: ${APP_ID}\n---\n${tapStep}\n`;
      const result = await runMaestroCommand(yaml);
      return {
        content: [{
          type: 'text',
          text: result.exitCode === 0
            ? `Tapped ${id ? `id="${id}"` : `text="${text}"`}.`
            : `Failed to tap: ${result.stderr}\n${result.stdout}`,
        }],
      };
    }

    // -----------------------------------------------------------------------
    case 'mobile_type': {
      const text = args.text as string;
      const id = args.id as string | undefined;

      let steps = '';
      if (id) {
        steps += `- tapOn:\n    id: "${id}"\n`;
      }
      steps += `- inputText: "${text.replace(/"/g, '\\"')}"`;

      const yaml = `appId: ${APP_ID}\n---\n${steps}\n`;
      const result = await runMaestroCommand(yaml);
      return {
        content: [{
          type: 'text',
          text: result.exitCode === 0
            ? `Typed "${text}"${id ? ` into id="${id}"` : ''}.`
            : `Failed to type: ${result.stderr}\n${result.stdout}`,
        }],
      };
    }

    // -----------------------------------------------------------------------
    case 'mobile_swipe': {
      const direction = args.direction as string;
      const yaml = `appId: ${APP_ID}\n---\n- swipe:\n    direction: "${direction.toUpperCase()}"\n`;
      const result = await runMaestroCommand(yaml);
      return {
        content: [{
          type: 'text',
          text: result.exitCode === 0
            ? `Swiped ${direction}.`
            : `Failed to swipe: ${result.stderr}\n${result.stdout}`,
        }],
      };
    }

    // -----------------------------------------------------------------------
    case 'mobile_scroll': {
      const direction = args.direction as string;
      // Maestro uses swipe for scrolling — swipe UP to scroll down
      const swipeDir = direction === 'down' ? 'UP' : 'DOWN';
      const yaml = `appId: ${APP_ID}\n---\n- scroll:\n    direction: "${swipeDir}"\n`;
      const result = await runMaestroCommand(yaml);
      return {
        content: [{
          type: 'text',
          text: result.exitCode === 0
            ? `Scrolled ${direction}.`
            : `Failed to scroll: ${result.stderr}\n${result.stdout}`,
        }],
      };
    }

    // -----------------------------------------------------------------------
    case 'mobile_assert_visible': {
      const id = args.id as string | undefined;
      const text = args.text as string | undefined;

      if (!id && !text) {
        return { content: [{ type: 'text', text: 'Error: provide either "id" or "text" to assert.' }] };
      }

      let assertStep: string;
      if (id) {
        assertStep = `- assertVisible:\n    id: "${id}"`;
      } else {
        assertStep = `- assertVisible:\n    text: "${text}"`;
      }

      const yaml = `appId: ${APP_ID}\n---\n${assertStep}\n`;
      const result = await runMaestroCommand(yaml);
      return {
        content: [{
          type: 'text',
          text: result.exitCode === 0
            ? `Assertion passed: ${id ? `id="${id}"` : `text="${text}"`} is visible.`
            : `Assertion failed: ${id ? `id="${id}"` : `text="${text}"`} is NOT visible.\n${result.stderr}`,
        }],
      };
    }

    // -----------------------------------------------------------------------
    case 'mobile_screenshot': {
      const platform = (args.platform as string) || 'ios';
      const tmpDir = await mkdtemp(join(tmpdir(), 'maestro-mcp-screenshot-'));
      const screenshotPath = join(tmpDir, 'screenshot.png');

      let result: RunResult;
      if (platform === 'ios') {
        result = await run('xcrun', ['simctl', 'io', 'booted', 'screenshot', screenshotPath]);
      } else {
        result = await runShell(`adb exec-out screencap -p > "${screenshotPath}"`);
      }

      if (result.exitCode !== 0) {
        await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
        return { content: [{ type: 'text', text: `Failed to capture screenshot: ${result.stderr}` }] };
      }

      try {
        const imageData = await readFile(screenshotPath);
        const base64 = imageData.toString('base64');
        return {
          content: [{
            type: 'image',
            data: base64,
            mimeType: 'image/png',
          }],
        };
      } finally {
        await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      }
    }

    // -----------------------------------------------------------------------
    case 'mobile_hierarchy': {
      const platform = (args.platform as string) || 'ios';

      if (platform === 'ios') {
        // Use Maestro's hierarchy dump — more useful than raw simctl output
        const result = await run('maestro', ['hierarchy']);
        return { content: [{ type: 'text', text: result.stdout || result.stderr }] };
      } else {
        const result = await runShell('adb shell uiautomator dump /dev/tty');
        return { content: [{ type: 'text', text: result.stdout || result.stderr }] };
      }
    }

    // -----------------------------------------------------------------------
    case 'mobile_run_flow': {
      const flow = args.flow as string;
      // Resolve relative to the maestro/flows/ directory
      const flowPath = flow.startsWith('/')
        ? flow
        : join(process.cwd(), 'maestro', 'flows', flow);

      const result = await run('maestro', ['test', flowPath], 120_000);
      return {
        content: [{
          type: 'text',
          text: result.exitCode === 0
            ? `Flow "${flow}" passed.\n${result.stdout}`
            : `Flow "${flow}" failed.\n${result.stderr}\n${result.stdout}`,
        }],
      };
    }

    // -----------------------------------------------------------------------
    case 'mobile_back': {
      const yaml = `appId: ${APP_ID}\n---\n- back\n`;
      const result = await runMaestroCommand(yaml);
      return {
        content: [{
          type: 'text',
          text: result.exitCode === 0 ? 'Pressed back.' : `Failed: ${result.stderr}`,
        }],
      };
    }

    // -----------------------------------------------------------------------
    default:
      return { content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
  }
}

// ---------------------------------------------------------------------------
// MCP Server setup
// ---------------------------------------------------------------------------

const server = new Server(
  {
    name: 'maestro-mcp',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: TOOLS };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  return handleTool(name, (args ?? {}) as Record<string, unknown>);
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Maestro MCP server running on stdio');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
