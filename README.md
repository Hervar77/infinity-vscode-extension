# INFINITY Extension

The INFINITY extension provides a Visual Studio Code debugger, so that you can run and debug your INFINITY applications
directly from the IDE.


## Features

- JavaScript and TypeScript debugging.
- Pause, debugger statements, breakpoints and break on exceptions are supported.
- An infinity application can be launched from within visual studio code, allowing to debug the application you are working on.
- The debugger can also attach to an already running, external INFINITY runtime, if it has been started with the `-debug` option. This allows you to debug an application running on another machine.


## Requirements

The INFINITY runtime is required to run and debug INFINITY applications.


## Extension Settings

This extension doesn't have any configurable settings. All settings can be configured in the launch configuration of your project (`.vscode/launch.json`).

When using the recommended folder structure for your INFINITY project, then most of the launch options will be determined automatically. In the recommended structure, you put your application inside INFINITY's `bin` folder:

```
infinity/
+ bin/
  + my-app/
    + ts/
      main.ts
    + js/
      main.js
    tsconfig.json
  + logs
  + resources
  + linux-x64
  + osx-x64
  + win-x64
```

This means that the folders with the INFINITY executables for the Linux, Mac OS and Windows platforms are next to your application's folder and within your application's folder, there is a `ts` folder with the typescript source code files and a `js` folder, to which the typescript files are compiled. You will also need to set `"sourceMap": true` in your `tsconfig.json` file, which will generate `.js.map` files in the `js` folder, along with the `.js` files. The INFINITY debugger needs these source maps to match breakpoints in your typescript source files to the compiled javascript files running in the INFINITY runtime.


### Launching INFINITY within visual studio code

Launch configuration parameters for automatically launching the INFINITY runtime within visual studio code, when you run your application in the debugger:

- `type`: must be `infinity`.
- `request`: must be `launch` to launch the runtime from within visual studio code.
- `name`: visual studio code will show the name in the debugger configurations, so pick one you will easily recognize.
- `program`: your application's main javascript file. When using typescript, you will also need to specify the main (compiled) javascript file, since INFINITY uses a javascript runtime.
- `args`: an optional array of additional command line arguments for your application (or the INFINITY runtime).
- `runtime`: the INFINITY runtime executable. When using the recommended folder structure, you don't need to specify the runtime - the debugger will automatically find it.
- `noDebug`: if set to true, then your application will be started without debugging. You can use this to simply run your application from within Visual Studio Code.
- `port`: the port number that the INFINITY runtime will listen on for debugging requests. Default is `9090`, but you can choose a different port, if that one is already taken.
- `timeout`: the number of milliseconds that the debugger will wait to connect to the INFINITY runtime when it is launched. The default of `5000` milliseconds should usually be enough.
- `console`: if false, then the INFINITY runtime will not output anything to the Visual Studio Code terminal. Default is: `true`.
- `disableScriptCache`: if true, then script caching will be disabled in INFINITY. When running in debug mode, then the script cache will automatically be disabled and this option will be ignored.
- `disableOpcodeCache`: if true, then opcode caching will be disabled in INFINITY. When running in debug mode, then the opcode cache will automatically be disabled and this option will be ignored.
- `reportMemoryLeaks`: if false, then memory leaks won't be reported in the Visual Studio Code terminal. Default is: `true`.
- `sourceFolder`: if you are using typescript, then you can specify the folder that contains your typescript source files. You only need to set this option if the extension fails to detect the source folder automatically.
- `sourceMapFolder`: if you are using typescript, then you can specify the folder that contains the source map files generated when compiling to javascript. You only need to set this option if your source map files are not located next to your javascript files.
- `noSourceMaps`: if you are using typescript, then leave this on the default value (`false`) and make sure you have `"sourceMaps": true` in your `tsconfig.json`. For javascript-only projects, you need to disable source maps (setting this value to `true`), since they are only necessary for typescript projects. Default is: `false`.


Basic example:

```json
        {
            "type": "infinity",
            "request": "launch",
            "name": "INFINITY: Launch",
            "program": "${workspaceFolder}/js/main.js"
        }
```

Complex example:

```json
        {
            "type": "infinity",
            "request": "launch",
            "name": "INFINITY: Launch with global runtime",
            "program": "${workspaceFolder}/js/main.js",
            "runtime": "/home/johndoe/infinity/bin/linux-x64/infinity",
            "port": 10090,
            "timeout": 10000,
            "sourceFolder": "${workspaceFolder}/ts",
            "sourceMapFolder": "${workspaceFolder}/tmp"
        }
```


### Attaching to an external INFINITY runtime

Launch configuration parameters for attaching the debugger to an external INFINITY runtime:

- `type`: must be `infinity`.
- `request`: must be `attach` to attach to an external INFINITY runtime.
- `name`: visual studio code will show the name in the debugger configurations, so pick one you will easily recognize.
- `program`: your application's main javascript file. When using typescript, you will also need to specify the main (compiled) javascript file, since INFINITY uses a javascript runtime.
- `host`: the host name or ip address of the INFINITY runtime that you want to connect to.
- `port`: the port number of the INFINITY runtime that you want to connect to.
- `timeout`: the number of milliseconds that the debugger will wait to connect to the INFINITY runtime. The default of `5000` milliseconds should usually be enough.
- `sourceFolder`: if you are using typescript, then you can specify the folder that contains your typescript source files. You only need to set this option if the extension fails to detect the source folder automatically.
- `sourceMapFolder`: if you are using typescript, then you can specify the folder that contains the source map files generated when compiling to javascript. You only need to set this option if your source map files are not located next to your javascript files.
- `noSourceMaps`: if you are using typescript, then leave this on the default value (`false`) and make sure you have `"sourceMaps": true` in your `tsconfig.json`. For javascript-only projects, you need to disable source maps (setting this value to `true`), since they are only necessary for typescript projects. Default is: `false`.


Basic example (INFINITY running on localhost at port 9090):

```json
        {
            "type": "infinity",
            "request": "attach",
            "name": "INFINITY: Attach (localhost)",
            "program": "${workspaceFolder}/js/main.js",
            "host": "localhost"
        }
```

Complex example (INFINITY running on infinity.local at port 10090):

```json
        {
            "type": "infinity",
            "request": "attach",
            "name": "INFINITY: Attach (infinity.local:10090)",
            "program": "${workspaceFolder}/js/main.js",
            "host": "infinity.local",
            "port": 10090,
            "timeout": 10000,
            "sourceFolder": "${workspaceFolder}/ts",
            "sourceMapFolder": "${workspaceFolder}/tmp"
        }
```


## Known Issues

None.
