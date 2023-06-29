# Change Log

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
