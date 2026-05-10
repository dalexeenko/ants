const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

// Find the project root (monorepo root)
const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// 1. Watch all files within the monorepo
config.watchFolders = [
  workspaceRoot,
];

// 2. Let Metro know where to resolve packages
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// 3. Enable symlink support for pnpm
config.resolver.unstable_enableSymlinks = true;

// 4. Ensure react-native condition is used for package exports
config.resolver.unstable_conditionNames = ['react-native', 'import', 'require'];

// 5. Force single copy of key packages to avoid duplicates
// Use a custom resolver that redirects specific packages
const originalResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  // Block modules that aren't compatible with React Native
  // These are Node.js-only dependencies from @modelcontextprotocol/sdk and other packages
  const blockedModules = [
    'pkce-challenge',
    '@hono/node-server',
    'eventsource',
    'express',
    'cross-spawn',
    'cors',
    'raw-body',
    'express-rate-limit',
  ];
  
  if (blockedModules.includes(moduleName)) {
    // Return an empty module stub
    return {
      filePath: path.resolve(projectRoot, 'src/stubs/empty-module.js'),
      type: 'sourceFile',
    };
  }
  
  // Stub out Node.js-only modules from @openmgr/agent-core that use
  // unsupported features like dynamic import(variable) or node:url
  if (
    moduleName === './plugins/manager.js' &&
    context.originModulePath &&
    context.originModulePath.includes('packages/core/')
  ) {
    return {
      filePath: path.resolve(projectRoot, 'src/stubs/empty-module.js'),
      type: 'sourceFile',
    };
  }
  
  // Packages that must come from the mobile app's node_modules
  const mobilePackages = [
    'react',
    'react-dom', 
    'react-native',
    'react-native-web',
    'react-native-svg',
    'expo',
    'expo-modules-core',
    '@react-native-async-storage/async-storage',
    'lucide-react-native',
  ];
  
  // Check if this is a package we want to redirect
  for (const pkg of mobilePackages) {
    if (moduleName === pkg || moduleName.startsWith(pkg + '/')) {
      // Only redirect if we're resolving from outside the mobile app's node_modules
      const isFromMobileNodeModules = context.originModulePath && 
        context.originModulePath.includes(projectRoot + '/node_modules');
      
      if (!isFromMobileNodeModules) {
        // Resolve directly to the mobile app's node_modules
        try {
          const resolved = require.resolve(moduleName, { 
            paths: [path.resolve(projectRoot, 'node_modules')] 
          });
          return {
            filePath: resolved,
            type: 'sourceFile',
          };
        } catch (e) {
          // Fall through to default resolution if not found
        }
      }
    }
  }
  
  // Force @openmgr/agent-core to use the native entry point
  if (moduleName === '@openmgr/agent-core') {
    const nativePath = path.resolve(workspaceRoot, 'packages/core/dist/index.native.js');
    // Only use native path if it exists
    try {
      require.resolve(nativePath);
      return {
        filePath: nativePath,
        type: 'sourceFile',
      };
    } catch (e) {
      // Fall through to default resolution
    }
  }
  
  // Fall back to default resolution
  if (originalResolveRequest) {
    return originalResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
