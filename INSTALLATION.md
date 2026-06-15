# INFINITY VSCode Extension - Installation Guide

## Issues Fixed

The extension was not working due to the following issues:

1. **Missing dependencies** - `node_modules` folder was not installed
2. **Not compiled** - TypeScript source was not compiled to JavaScript
3. **Deprecated activation event** - Changed from `onDebug` to specific debug events
4. **Deprecated packages** - Updated to modern package names:
   - `vsce` → `@vscode/vsce`
   - `vscode-test` → `@vscode/test-electron`

## Changes Made

### package.json Updates

1. **Activation Events** - More specific debug activation:
   ```json
   "activationEvents": [
     "onDebugResolve:infinity",
     "onDebugDynamicConfigurations:infinity"
   ]
   ```

2. **Dependencies Updated**:
   - Replaced deprecated `vsce` with `@vscode/vsce`
   - Replaced deprecated `vscode-test` with `@vscode/test-electron`

3. **Package script** - Updated to use npx:
   ```json
   "package": "npx @vscode/vsce package"
   ```

## Installation

### Option 1: Install from VSIX (Recommended)

1. Open VSCode
2. Go to Extensions (Ctrl+Shift+X)
3. Click the "..." menu at the top
4. Select "Install from VSIX..."
5. Navigate to `infinity-1.0.12.vsix`
6. Click "Install"
7. Reload VSCode when prompted

### Option 2: Development Mode

1. Open the `vscode-extension` folder in VSCode
2. Press F5 to launch Extension Development Host
3. This will open a new VSCode window with the extension loaded

## Usage

### Quick Start

1. Open an INFINITY.JS project in VSCode
2. Press F5 or go to Run and Debug
3. Select an INFINITY configuration (or create one)
4. Set breakpoints in your TypeScript/JavaScript files
5. Start debugging

### Configuration Example

Add to `.vscode/launch.json`:

```json
{
  "type": "infinity",
  "request": "launch",
  "name": "INFINITY: Launch (win-x64)",
  "program": "${workspaceFolder}/js/main.js",
  "runtime": "${workspaceFolder}/../win-x64/infinity.exe"
}
```

## Development Commands

```bash
# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Watch mode (auto-compile)
npm run watch

# Lint code
npm run lint

# Package extension
npm run package
```

## Compatibility

- **VSCode**: ^1.96.0 or newer
- **Node.js**: Compatible with Node 20+
- **Platforms**: Windows, Linux, macOS

## Troubleshooting

### Extension doesn't activate
- Ensure the extension is properly installed
- Check that you have an INFINITY runtime binary available
- Verify your launch configuration paths are correct

### Breakpoints not working
- Ensure source maps are enabled in `tsconfig.json`
- Check that the `sourceMap` option is true in your debug configuration
- Verify the `sourceFolder` path is correct

### Runtime not found
- Update the `runtime` path in your launch configuration
- Make sure the INFINITY executable exists at the specified path
- Check file permissions on the executable

## Support

For issues or questions, please report at:
https://gitlab.infinity-technologies.li/tf/infinity-vscode-extension
