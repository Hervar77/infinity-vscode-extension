# Info

This file contains information and hints about editing the project files for this extension.

## INFINITY Debug Port

The INFINITY runtime can be started with the following command line parameters to open a debug port:

```
infinity.exe -console -reportMemoryLeaks -disableScriptCache -disableOpcodeCache -debug ../app/js/main.js

```

The debugger supports the following commands:

- `HALT`: terminate process
- `ADDBP [filename] [line]`: Add a breakpoint
- `DELBP [filename] [line]`: Delete a breakpoint. If the line parameter is omitted, then all breakpoints of that file will be deleted. If the filename parameter is omitted, then all breakpoints in all files will be deleted.
- `GETBP [filename]`: Lists all breakpoints in the source file.
- `CO`: Continue execution (only available in pause/break state).
- `SI`: Step into function (only available in pause/break state).
- `SO`: Step over function (only available in pause/break state).


## CHANGELOG.md

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

