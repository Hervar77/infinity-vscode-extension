# Change Log

## [1.0.12]

- Updated all npm dependencies to their latest versions (`@vscode/debugadapter`/`@vscode/debugprotocol` 1.68, `source-map` 0.7.6, TypeScript 6.0, ESLint 10, `@typescript-eslint` 8, `@vscode/vsce` 3.9).
- Migrated ESLint configuration to the flat-config format (`eslint.config.mjs`) required by ESLint 9+.
- Raised the minimum supported VS Code version to 1.96 and verified compatibility against the current API.
- Removed unused test scaffolding (`mocha`, `glob`, `@vscode/test-electron` and related types), clearing all known dependency vulnerabilities.
- No changes to debugger behavior.

## [1.0.11]

- **Breakpoints now work correctly**: Fixed file path translation to use relative paths matching INFINITY runtime expectations
- Removed duplicate response handling in configurationDone, threads, and disconnect requests
- Fixed TerminatedEvent suppression during intentional disconnects
- Improved connection state management and error handling
- Updated activation events for better VSCode compatibility (`onDebugResolve:infinity`, `onDebugDynamicConfigurations:infinity`)
- Migrated from deprecated `vsce` to `@vscode/vsce` and `vscode-test` to `@vscode/test-electron`
- Full compatibility with modern VSCode versions (tested with 1.109.0)

## [1.0.10]

- Development version with diagnostic logging (not released)


## [1.0.7]

- Fixed timing problem when starting the INFINITY runtime and connecing the debugger.


## [1.0.6]

- Fixed empty lines being swallowed in the debug console output.
- Fixed treatment of platform-dependant linebreaks.


## [1.0.5]

- Fixed debug console output buffering and made the debug console the default debugger output.


## [1.0.4]

- Fixed debug console output buffering. Fixed running INFINITY in a visual studio code integrated terminal.


## [1.0.3]

- Added the `consoleType` param for launching the runtime. The runtime will now be killed after the `timeout` when it
doesn't terminate properly after the debugger has been terminated.


## [1.0.2]

- Support for initial launch.json content, debugging without launch.json file, running without debugger.


## [1.0.1]

- Support for showing variable values and scopes.


## [1.0.0]

- Initial release. Support for breakpoints and breaking on exceptions. Support for launching the runtime in a visual studio code terminal session, as well as attaching to an external runtime.
