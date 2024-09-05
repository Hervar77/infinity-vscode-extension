import { ContinuedEvent, Event, InitializedEvent, Logger, LoggingDebugSession, OutputEvent, Scope, Source, StackFrame, StoppedEvent, TerminatedEvent, Thread } from '@vscode/debugadapter';
import * as vscode from 'vscode';
import { Uri, workspace } from 'vscode';
import { logger } from '@vscode/debugadapter/lib/logger';
import { DebugProtocol } from '@vscode/debugprotocol';
import { SourceMapConsumer } from 'source-map';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as childProcess from 'child_process';
import { InfinityConnection } from './infinityConnection';
import { LineBuffer } from './lineBuffer';
import buffer = require( 'buffer' );
import { EOL } from 'os';

/**
 * Launch arguments for launching the INFINITY runtime from visual studio code.
 */
interface LaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
    program: string;
    args: string[];
    runtime: string;
    noDebug?: boolean;
    port: number;
    timeout: number;
    console?: boolean;
    consoleType?: string;
    disableScriptCache?: boolean;
    disableOpcodeCache?: boolean;
    reportMemoryLeaks?: boolean;
    sourceFolder?: string;
    sourceMapsFolder?: string;
    noSourceMaps?: boolean;
}

/**
 * Launch arguments for attaching the debugger to an INFINITY runtime.
 */
interface AttachRequestArguments extends DebugProtocol.AttachRequestArguments {
    program: string;
    host: string;
    port?: number;
    timeout?: number;
    sourceFolder?: string;
    sourceMapsFolder?: string;
    noSourceMaps?: boolean;
}

/**
 * Runtime variable scope.
 */
interface InfinityScope {
    id: number;
    name: string;
    type: string;
    value?: string;
    children: InfinityScope[];
}

/**
 * Mapping from typescript source code lines to transpiled javascript lines.
 */
interface SourceMapping {
    sourceFile: string;
    debuggerFile: string;
    sourceToDebuggerLines: any;
    debuggerToSourceLines: any;
}

/**
 * Debugger breakpoint location.
 */
interface BreakpointLocation extends DebugProtocol.BreakpointLocation {}

/**
 * Status of launching and connecting to the INFINITY runtime.
 */
interface InfinityStatus {
    connected: boolean,
    initialized: boolean,
    paused: boolean,
    frontendReady: boolean
};

enum InfinityConsoleType {unknown, debug, terminal};

/**
 * Launched INFINITY runtime process data.
 */
class InfinityProcess {
    public active: boolean = false;
    public noDebug: boolean = false;
    public consoleType: InfinityConsoleType = InfinityConsoleType.debug;
    public terminal?: vscode.Terminal;
    public process?: childProcess.ChildProcess;
    public timeout: number = 5000;
    public timeoutId?: any;
    public response?: DebugProtocol.Response;
}

/**
 * Debug session.
 */
export class InfinityDebugSession extends LoggingDebugSession {

    private programFolder: string = '';
    private sourceFolder: string = '';
    private sourceMapsFolder: string = '';
    private noSourceMaps: boolean = false;
    private infinity: InfinityConnection = new InfinityConnection();
    private status: InfinityStatus = { connected: false, initialized: false, paused: false, frontendReady: false };
    private threads: any[] = [];
    private mainThreadId: number = 0;
    private currentThreadId: number = 0;
    private nextScopeId: number = 0;
    private scopes: Map<number, InfinityScope> = new Map<number, InfinityScope>();
    private debuggerMappings: Map<string, SourceMapping> = new Map<string, SourceMapping>();
    private sourceMappings: Map<string, SourceMapping> = new Map<string, SourceMapping>();
    private sourceBreakpoints: Map<string, BreakpointLocation[]> = new Map<string, BreakpointLocation[]>();
    private pendingFrontendEvents: Event[] = [];
    private infinityProcess: InfinityProcess = new InfinityProcess();
    private infinityOutput: LineBuffer = new LineBuffer();
    private infinityErrorOutput: LineBuffer = new LineBuffer();

    /**
     * Constructor.
     */
    public constructor() {
        super( 'infinity.txt' );

        this.setDebuggerLinesStartAt1( true );
        this.setDebuggerColumnsStartAt1( true );

        this.infinityOutput.on( (data: string) => {
            this.sendEvent( new OutputEvent( data + EOL, 'stdout' ) );
        } );

        this.infinityErrorOutput.on( (data: string) => {
            this.sendEvent( new OutputEvent( data + EOL, 'stderr' ) );
        } );

        this.infinity.on( 'connected', () => {
            // Connection to the INFINITY debug port has been established.
            this.status.connected = true;

            if ( !this.status.paused ) {
                this.status.initialized = true;
                this.sendEvent( new InitializedEvent() );
                this.sendEvent( new ContinuedEvent( this.currentThreadId, true ) );
            }
        } );

        this.infinity.on( 'disconnected', () => {
            // The script running in INFINITY has finished execution and the runtime is terminating.
            this.status.connected = false;
            this.sendEvent( new TerminatedEvent() );
        } );

        // The INFINITY runtime is paused and ready to receive requests.
        this.infinity.on( 'stopped', this.onInfinityStopped );

        this.infinity.on( 'error', error => {
            vscode.window.showErrorMessage( 'Debugger error: ' + this.getErrorMessage( error ) );
        } );

        // Terminate debugger when the connection to the INFINITY runtime has been closed:
        this.infinity.on( 'connectionClosed', () => {
            this.sendEvent( new TerminatedEvent() );
        } );

        this.infinity.on( 'connectionError', () => {
            this.sendEvent( new TerminatedEvent() );
        } );
    }

    /**
     * Initialize debug request.
     * 
     * @param response {DebugProtocol.InitializeResponse}
     * @param args {DebugProtocol.InitializeRequestArguments}
     */
    protected initializeRequest( response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments ) {
        response.body = response.body || {};

        response.body.supportsConfigurationDoneRequest = true;
        response.body.supportsEvaluateForHovers = false;
        response.body.supportsBreakpointLocationsRequest = true;
        response.body.supportsTerminateRequest = true;
		response.body.exceptionBreakpointFilters = [{
			label: "All Exceptions",
			filter: "exceptions",
		}];

        this.sendResponse( response );
        // The initialized event is fired when the INFINITY runtime is ready to accept commands ("initialized" event).
    }

    /**
     * Launch debug request.
     * 
     * @param response {DebugProtocol.LaunchResponse}
     * @param args {LaunchRequestArguments}
     */
    protected launchRequest( response: DebugProtocol.LaunchResponse, args: LaunchRequestArguments ) {
        ( new Promise<void>( async ( resolve, reject ) => {
            try {
                this.infinityProcess.noDebug = !!args.noDebug;
                this.infinityProcess.consoleType = args.consoleType === 'terminal' ? InfinityConsoleType.terminal : InfinityConsoleType.debug;
                this.infinityProcess.timeout = args.timeout || 5000;
        
                this.status.paused = !this.infinityProcess.noDebug;
        
                try {
                    await this.initializeRuntimeArguments( args );
                } catch ( error ) {
                    reject( { code: 400, message: 'Invalid launch configuration: ' + this.getErrorMessage( error ) } );
                    return;
                }
        
                let port = args.port || 9090;
                let runtime: string | undefined = args.runtime;
                
                if ( !runtime ) {
                    runtime = workspace.getWorkspaceFolder( Uri.file( args.program ) )?.uri.fsPath;
        
                    if ( runtime ) {
                        switch ( process.platform ) {
                            case 'darwin':
                                runtime += '/../osx-x64/infinity';
                                break;
        
                            case 'win32':
                                runtime += '/../win-x64/infinity.exe';
                                break;
        
                            default:
                                runtime += '/../linux-x64/infinity';
                                break;
                        }
                    }
                }
        
                if ( runtime ) {
                    runtime = this.fixLocalPath( runtime );
                } else {
                    reject( { code: 400, message: 'Invalid launch configuration: Parameter "runtime" not specified' } );
                    return;
                }
        
                if ( !fs.existsSync( runtime ) ) {
                    reject( { code: 400, message: 'Invalid launch configuration: Parameter "runtime": file not found: ' + runtime } );
                    return;
                }
        
                logger.setup( Logger.LogLevel.Stop, false );
        
                // Gather command line arguments for the INFINITY runtime:
                let params: string[] = [];
        
                if ( !this.infinityProcess.noDebug ) {
                    params.push( '-debug' );
                    params.push( '-paused' );
                    params.push( '-port ' + port );
                }
        
                if ( args.console !== false ) {
                    params.push( '-console' );
                }
        
                if ( args.disableScriptCache !== false ) {
                    params.push( '-disableScriptCache' );
                }
        
                if ( args.disableOpcodeCache !== false ) {
                    params.push( '-disableOpcodeCache' );
                }
        
                if ( args.reportMemoryLeaks ) {
                    params.push( '-reportMemoryLeaks' );
                }
        
                if ( args.args && args.args.length ) {
                    for ( let arg of args.args ) {
                        params.push( arg );
                    }
                }
        
                params.push( args.program );
        
                // Start the INFINITY runtime:
                if ( this.infinityProcess.consoleType === InfinityConsoleType.terminal ) {
                    // Run the INFINITY runtime in a visual studio code terminal
                    for ( let terminal of vscode.window.terminals ) {
                        if ( terminal.name === 'INFINITY' ) {
                            this.infinityProcess.terminal = terminal;
                            break;
                        }
                    }
        
                    if ( !this.infinityProcess.terminal ) {
                        this.infinityProcess.terminal = vscode.window.createTerminal( {
                            name: 'INFINITY',
                            cwd: path.dirname( runtime )
                        } );
                    }
                    this.infinityProcess.terminal.show();
                    this.infinityProcess.active = true;
                    this.infinityProcess.terminal.sendText( '.' + path.sep + path.basename( runtime ) + ' ' + params.join( ' ' ) );
                } else {
                    // Run the INFINITY runtime as a child process and connect its output to visual studio codes debug console
                    this.infinityProcess.active = true;
                    this.infinityOutput.clear();
                    this.infinityErrorOutput.clear();
        
                    this.infinityProcess.process = childProcess.spawn(
                        '.' + path.sep + path.basename( runtime ),
                        params,
                        {
                            cwd: path.dirname( runtime ),
                            env: {}
                        }
                    );
        
                    this.infinityProcess.process.on( 'error', error => {
                        reject( { code: 500, message: 'Failed to launch INFINITY: ' + this.getErrorMessage( error ) } );
                        this.sendEvent( new TerminatedEvent() );
                    } );
            
                    this.infinityProcess.process.on( 'exit', () => {
                        this.infinityTerminated();
                    } );
            
                    this.infinityProcess.process.on( 'close', () => {
                        this.infinityTerminated();
                    } );
            
                    // Capture console output and redirect it to the vscode debug console:
                    this.infinityProcess.process.stdout?.on( 'data', (data: Buffer) => {
                        this.infinityOutput.addData( buffer.transcode( data, 'latin1', 'utf8' ).toString() );
                    } );
            
                    this.infinityProcess.process.stderr?.on( 'data', (data: Buffer) => {
                        this.infinityErrorOutput.addData( buffer.transcode( data, 'latin1', 'utf8' ).toString() );
                    } );
                }
        
                // Try to connect to the INFINITY runtime:
                if ( this.infinityProcess.noDebug ) {
                    resolve();
                } else {
                    try {
                        this.infinity.connect( 'localhost', port, this.infinityProcess.timeout );
                        resolve();
                    } catch ( error ) {
                        reject( { code: 500, message: 'Could not connect to INFINITY at localhost:' + port + ' (' + this.getErrorMessage( error ) + ')' } );
                    }
                }
            } catch ( error ) {
                reject( { code: 500, message: this.getErrorMessage( error ) } );
            }
        } ) ).then( () => {
            this.sendResponse( response );
        } ).catch ( error => {
            this.sendErrorResponse( response, error.code, this.getErrorMessage( error.message ) );
        } );
    }

    /**
     * Attach debug request.
     * 
     * @param response {DebugProtocol.AttachResponse}
     * @param args {AttachRequestArguments}
     */
    protected attachRequest( response: DebugProtocol.AttachResponse, args: AttachRequestArguments ) {
        ( new Promise<void>( async ( resolve, reject ) => {
            try {
                try {
                    await this.initializeRuntimeArguments( args );
                } catch ( error ) {
                    reject( { code: 400, message: 'Invalid attach configuration: ' + this.getErrorMessage( error ) } );
                    return;
                }
        
                let host: string = args.host || 'localhost';
                let port: number = args.port || 9090;
        
                logger.setup( Logger.LogLevel.Stop, false );
        
                try {
                    await this.infinity.connect( host, port, args.timeout || 5000 );
                    resolve();
                } catch ( error ) {
                    reject( { code: 500, message: 'Could not connect to INFINITY at ' + host + ':' + port + ' (' + this.getErrorMessage( error ) + ')' } );
               }

               resolve();
            } catch ( error ) {
                reject( { code: 500, message: this.getErrorMessage( error ) } );
            }
        } ) ).then( () => {
            this.sendResponse( response );
        } ).catch( error => {
            this.sendErrorResponse( response, error.code, this.getErrorMessage( error.message ) );
        } );
    }

    /**
     * Initializes the launch or attach request arguments and sets up the debug session properties.
     * 
     * @param args {LaunchRequestArguments|AttachRequestArguments}
     * @return Promise<void>
     */
    private async initializeRuntimeArguments( args: LaunchRequestArguments | AttachRequestArguments ): Promise<void> {
        if ( !args.program ) {
            throw new Error( 'Parameter "program" not specified' );
        }

        if ( !fs.existsSync( args.program ) ) {
            throw new Error( 'Parameter "program": file not found: ' + args.program );
        }

        this.programFolder = path.normalize( path.dirname( args.program ) + '/' );
        this.noSourceMaps = Boolean(args.noSourceMaps);

        if ( !this.noSourceMaps ) {
            if ( args.sourceMapsFolder ) {
                if ( !fs.existsSync( args.sourceMapsFolder ) ) {
                    throw new Error( 'Parameter "sourceMapsFolder": folder not found: ' + args.sourceMapsFolder );
                }

                this.sourceMapsFolder = path.normalize( args.sourceMapsFolder + '/' );
            } else {
                this.sourceMapsFolder = this.programFolder;
            }
        }

        if ( args.sourceFolder ) {
            if ( !fs.existsSync( args.sourceFolder ) ) {
                throw new Error( 'Parameter "sourceFolder": folder not found: ' + args.sourceFolder );
            }

            this.sourceFolder = this.fixLocalPath( args.sourceFolder + '/' );
        } else if ( this.noSourceMaps ) {
            this.sourceFolder = this.fixLocalPath( this.programFolder );
        } else {
            // Initializing the source mapping for the main program file will also set up the source folder, if typescript and source maps are being used:
            await this.initMapping( '', path.basename( args.program ) );

            // If no source folder has been set, then this is obviously a plain javascript project and we can use the program folder as source folder:
            if ( !this.sourceFolder ) {
                this.sourceFolder = this.fixLocalPath( this.programFolder );
            }
        }

        // If no source folder has been specified, it will be determined later on through the source map files.
    }

    /**
     * ConfigurationDone debug request.
     * 
     * @param response {DebugProtocol.ConfigurationDoneResponse}
     * @param args {DebugProtocol.ConfigurationDoneArguments}
     */
    protected configurationDoneRequest( response: DebugProtocol.ConfigurationDoneResponse, args: DebugProtocol.ConfigurationDoneArguments ) {
        super.configurationDoneRequest( response, args );

        this.status.frontendReady = true;

        if ( this.status.initialized && this.status.paused ) {
            this.infinity.send( 'continue' ).then( () => {
                this.status.paused = false;
                this.sendResponse( response );
                this.sendEvent( new ContinuedEvent( this.currentThreadId, true ) );
            } ).catch( error => {
                this.sendErrorResponse( response, 500, 'Could not start INFINITY debugger: ' + this.getErrorMessage( error ) );
            } );
        } else {
            this.sendResponse( response );
        }

        // Send any pending frontend events:
        for ( let event of this.pendingFrontendEvents ) {
            this.sendEvent( event );
        }
    }

    /**
     * SetExceptionBreakPoints debug request.
     * 
     * @param response {DebugProtocol.SetExceptionBreakpointsResponse}
     * @param args {DebugProtocol.SetExceptionBreakpointsArguments}
     */
    protected setExceptionBreakPointsRequest( response: DebugProtocol.SetExceptionBreakpointsResponse, args: DebugProtocol.SetExceptionBreakpointsArguments ) {
        // We currently define only one filter, so if a filter has been selected, then stop on exceptions:
        let stopOnExceptions = args.filters.length > 0;

        this.infinity.send( 'stopOnExceptions', stopOnExceptions ).then( () => {
            this.sendResponse( response );
        } ).catch( error => {
            this.sendErrorResponse( response, 500, 'Could not send stopOnException request: ' + this.getErrorMessage( error ) );
        } );
    }

    /**
     * SetBreakPoints debug request.
     * 
     * @param response {DebugProtocol.SetBreakpointsResponse}
     * @param args {DebugProtocol.SetBreakpointsArguments}
     */
    protected setBreakPointsRequest( response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments ) {
        response.body = {
            breakpoints: []
        };

        ( new Promise<void>( async ( resolve, reject ) => {
            try {
                let sourcePath: string = this.fixLocalPath( args.source.path || '' );
        
                if ( !this.infinity.isConnected() ) {
                    resolve();
                    return;
                }
        
                if ( !sourcePath ) {
                    reject( { code: 400, message: 'No path specified in setBreakPointsRequest' } );
                    return;
                }
        
                if ( !this.sourceFolder ) {
                    reject( { code: 500, message: 'Invalid source folder in setBreakPointsRequest' } );
                    return;
                }
        
                let file: string = sourcePath;
        
                if ( file.substring( 0, this.sourceFolder.length ) === this.sourceFolder ) {
                    file = file.substring( this.sourceFolder.length );
                } else {
                    reject( { code: 400, message: 'Invalid source file (for typescript projects: please put "sourceMap": true into your tsconfig.json, for javascript-only projects: please put "noSourceMaps": true into your launch config)' } );
                    return;
                }
        
                let debuggerFile = await this.translateSourceFileToDebugger( file );
                let debuggerLines: number[] = [];
                let source: Source = await this.getSource( debuggerFile );
                let sourceBreakpoints: BreakpointLocation[] = [];
                let params: any[] = [];
        
                for ( let breakpoint of args.breakpoints || [] ) {
                    let line: number = await this.translateSourceLineToDebugger( file, breakpoint.line );
                    debuggerLines.push( line );
                    params.push( { file: debuggerFile, line: line } );
                    let sourceBreakpoint = { verified: true, line: breakpoint.line, source: source };
                    sourceBreakpoints.push( sourceBreakpoint );
                    response.body.breakpoints.push( sourceBreakpoint );
                }
        
                if ( source.path ) {
                    this.sourceBreakpoints.set( this.fixLocalPath( source.path ), sourceBreakpoints );
                }
        
                this.infinity.send( 'setBreakpoints', params ).then( () => {
                    resolve();
                } ).catch( error => {
                    reject( { code: 500, message: 'setBreakpoints request failed: ' + this.getErrorMessage( error ) } );
                } );
            } catch ( error ) {
                reject( { code: 500, message: this.getErrorMessage( error ) } );
            }
        } ) ).then( () => {
            this.sendResponse( response );
        } ).catch( error => {
            this.sendErrorResponse( response, error.code, this.getErrorMessage( error.message ) );
        } );
    }

    /**
     * BreakpointLocation debug request.
     * 
     * @param response {DebugProtocol.BreakpointLocationsResponse}
     * @param args {DebugProtocol.BreakpointLocationsArguments}
     */
    protected breakpointLocationsRequest( response: DebugProtocol.BreakpointLocationsResponse, args: DebugProtocol.BreakpointLocationsArguments ) {
        response.body = {
            breakpoints: []
        };

        if ( args && args.source && args.source.path ) {
            let source: string = this.fixLocalPath( args.source.path );
            response.body.breakpoints = this.sourceBreakpoints.get( source ) || [];
        }

        this.sendResponse( response );
    }

    /**
     * Threads debug request.
     * 
     * @param response {DebugProtocol.ThreadsResponse}
     */
    protected threadsRequest( response: DebugProtocol.ThreadsResponse ) {
        response.body = {
            threads: []
        };

        ( new Promise<void>( async ( resolve, reject ) => {
            try {
                let data: any = await this.infinity.send( 'threads' );

                this.threads = data.response || [];
                this.currentThreadId = 0;
        
                for ( let thread of this.threads ) {
                    if ( thread.type === 'main' ) {
                        this.mainThreadId = thread.id;
                    }
        
                    if ( thread.debug ) {
                        this.currentThreadId = thread.id;
                    }
        
                    response.body.threads.push( new Thread( thread.id, await this.translateDebuggerFileToSource( thread.file ) ) );
                }
        
                if ( !this.currentThreadId ) {
                    this.currentThreadId = this.mainThreadId;
                }
        
                resolve();
            } catch ( error ) {
                reject( { code: 500, message: this.getErrorMessage( error ) } );
            }
        } ) ).then( () => {
            super.threadsRequest( response );
            this.sendResponse( response );
        } ).catch( error => {
            this.sendErrorResponse( response, error.code, this.getErrorMessage( error.message ) );
        } );
    }

    /**
     * StackTrace debug request.
     * 
     * @param response {DebugProtocol.StackTraceResponse}
     * @param args {DebugProtocol.StackTraceArguments}
     */
    protected stackTraceRequest( response: DebugProtocol.StackTraceResponse, args: DebugProtocol.StackTraceArguments ) {
        response.body = {
            stackFrames: [],
            totalFrames: 0
        };

        this.infinity.send( 'stacktrace' ).then( data => {
            new Promise<void>( async resolve => {
                let trace: any;
                let frameId: number = this.currentThreadId;
                let frames: any[] = data.response;

                // Remove last "native" stack frame:
                if ( frames && frames.length && frames[ frames.length - 1 ].file === 'native' ) {
                    frames.pop();
                }
    
                for ( trace of data.response || [] ) {
                    response.body.stackFrames.push( new StackFrame(
                        frameId,
                        trace.function,
                        await this.getSource( trace.file ),
                        this.convertDebuggerLineToClient( await this.translateDebuggerLineToSource( trace.file, trace.line ) )
                    ) );
                    frameId = 0;
                }
    
                response.body.totalFrames = response.body.stackFrames.length;
                resolve();
            } ).then( () => {
                this.sendResponse( response );
            } ).catch( error => {
                this.sendErrorResponse( response, 500, 'stackTrace request failed: ' + this.getErrorMessage( error ) );
            } );
        } ).catch( (error) => {
            this.sendErrorResponse( response, 500, 'stackTrace request failed: ' + this.getErrorMessage( error ) );
        } );
    }

    /**
     * Scopes debug request.
     * 
     * @param response {DebugProtocol.ScopesResponse}
     * @param args {DebugProtocol.ScopesArguments}
     */
    protected scopesRequest( response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments ) {
        response.body = {
            scopes: []
        };

        this.scopes.clear();
        this.nextScopeId = 1000;

        if ( args.frameId && args.frameId === this.currentThreadId ) {
            this.infinity.send( 'scopes' ).then( data => {
                for ( let scopeData of data.response ) {
                    let scope = this.parseScope( '', scopeData, 0 );

                    if ( scope ) {
                        response.body.scopes.push( new Scope( scope.name, scope.id, false ) );
                    }
                }

                // The first scope is the current local scope and the last is the global scope:
                if ( response.body.scopes.length > 0 ) {
                    response.body.scopes[ response.body.scopes.length - 1 ].name = 'Global';
                }

                if ( response.body.scopes.length > 1 ) {
                    response.body.scopes[ 0 ].name = 'Local';
                }

                this.sendResponse( response );
            } ).catch( error => {
                this.sendErrorResponse( response, 500, 'scopes request failed: ' + this.getErrorMessage( error ) );
            } );
        } else {
            this.sendResponse( response );
        }
    }

    /**
     * Variables debug request.
     * 
     * @param response {DebugProtocol.VariablesResponse}
     * @param args {DebugProtocol.VariablesArguments}
     */
    protected variablesRequest( response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments ) {
        response.body = {
            variables: []
        };

        let parent = this.scopes.get( args.variablesReference );
        let scope: InfinityScope;

        if ( parent ) {
            for ( scope of parent.children ) {
                response.body.variables.push( {
                    name: scope.name,
                    type: (scope.type || '' ).toLowerCase(),
                    value: scope.value || '',
                    variablesReference: scope.children.length ? scope.id : 0,
                    indexedVariables: 0,
                    namedVariables: scope.children.length
                 } );
            }
        }

        this.sendResponse( response );
    }

    /**
     * Pause debug request.
     * 
     * @param response {DebugProtocol.PauseResponse}
     * @param args {DebugProtocol.PauseArguments}
     */
    protected pauseRequest( response: DebugProtocol.PauseResponse, args: DebugProtocol.PauseArguments ) {
        this.infinity.send( 'pause' ).then( () => {
            this.sendResponse( response );
        } ).catch( (error) => {
            this.sendErrorResponse( response, 500, 'pause request failed: ' + this.getErrorMessage( error ) );
        } );
    }

    /**
     * Continue debug request.
     * 
     * @param response {DebugProtocol.ContinueResponse}
     * @param args {DebugProtocol.ContinueArguments}
     */
    protected continueRequest( response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments ) {
        this.infinity.send( 'continue' ).then( () => {
            this.sendResponse( response );
        } ).catch( (error) => {
            this.sendErrorResponse( response, 500, 'continue request failed: ' + this.getErrorMessage( error ) );
        } );
    }

    /**
     * Next debug request.
     * 
     * @param response {DebugProtocol.NextResponse}
     * @param args {DebugProtocol.NextArguments}
     */
    protected nextRequest( response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments ) {
        this.infinity.send( 'stepOver' ).then( () => {
            this.sendResponse( response );
        } ).catch( error => {
            this.sendErrorResponse( response, 500, 'next request failed: ' + this.getErrorMessage( error ) );
        } );
    }

    /**
     * StepIn debug request.
     * 
     * @param response {DebugProtocol.StepInResponse}
     * @param args {DebugProtocol.StepInArguments}
     */
    protected stepInRequest( response: DebugProtocol.StepInResponse, args: DebugProtocol.StepInArguments ) {
        this.infinity.send( 'stepIn' ).then( () => {
            this.sendResponse( response );
        } ).catch( error => {
            this.sendErrorResponse( response, 500, 'stepIn request failed: ' + this.getErrorMessage( error ) );
        } );
    }

    /**
     * StepOut debug request.
     * 
     * @param response {DebugProtocol.StepOutResponse}
     * @param args {DebugProtocol.StepOutArguments}
     */
    protected stepOutRequest( response: DebugProtocol.StepOutResponse, args: DebugProtocol.StepOutArguments ) {
        this.infinity.send( 'stepOut' ).then( () => {
            this.sendResponse( response );
        } ).catch( error => {
            this.sendErrorResponse( response, 500, 'stepOut request failed: ' + this.getErrorMessage( error ) );
        } );
    }

    /**
     * Cancel debug request.
     * 
     * @param response {DebugProtocol.CancelResponse}
     * @param args {DebugProtocol.CancelArguments}
     */
    protected cancelRequest( response: DebugProtocol.CancelResponse, args: DebugProtocol.CancelArguments ) {
        this.terminateInfinity( response );
    }

    /**
     * Terminate debug request.
     * 
     * @param response {DebugProtocol.TerminateResponse}
     * @param args {DebugProtocol.TerminateArguments}
     */
    protected terminateRequest( response: DebugProtocol.TerminateResponse, args: DebugProtocol.TerminateArguments ) {
        this.terminateInfinity( response );
    }

    /**
     * Disconnect debug request.
     * 
     * @param response {DebugProtocol.DisconnectResponse}
     * @param args {DebugProtocol.DisconnectArguments}
     */
    protected disconnectRequest( response: DebugProtocol.DisconnectResponse, args: DebugProtocol.DisconnectArguments ) {
        this.infinity.disconnect();

        super.disconnectRequest( response, args );
    }

    /**
     * Terminates the INFINITY runtime.
     * Tries to let the runtime terminate properly, but hard kills it after the timeout if it hasn't terminated properly.
     * 
     * @param response {DebugProtocol.Response}
     */
    private terminateInfinity( response: DebugProtocol.Response ) {
        if ( this.infinityProcess.active ) {
            // Check if the runtime has already terminated:
            if ( this.infinityProcess.process?.killed ) {
                this.infinityProcess.active = false;
                this.sendResponse( response );
                this.sendEvent( new TerminatedEvent() );
            } else {
                // Start a timeout to kill the runtime if it doesn't terminate properly.
                // We will try to terminate the runtime properly after starting the timeout, but if that fails,
                // then the timeout will try to kill the runtime eventually.
                this.infinityProcess.response = response;

                this.infinityProcess.timeoutId = setTimeout( () => {
                    this.infinityProcess.timeoutId = undefined;

                    if ( this.infinityProcess.active ) {
                        if ( this.infinityProcess.consoleType === InfinityConsoleType.terminal ) {
                            this.infinityProcess.terminal?.dispose();
                            this.infinityProcess.terminal = undefined;
                        } else if ( this.infinityProcess.process ) {
                            let pid = this.infinityProcess.process.pid;

                            if ( pid && !this.infinityProcess.process.killed ) {
                                // Hard kill the runtime process:
                                if ( process.platform === 'win32' ) {
                                    childProcess.spawn( 'taskkill', [ '/pid', '' + pid, '/f', '/t' ] );
                                } else {
                                    childProcess.spawn( 'kill', [ '-9', '' + pid ] );
                                }
                            }
                        }
                    }
                }, this.infinityProcess.timeout );

                // Try to terminate the runtime:
                if ( this.infinityProcess.noDebug ) {
                    // Not running in debug mode
                    if ( this.infinityProcess.consoleType === InfinityConsoleType.terminal ) {
                        // Send a ctrl+c key event to terminate the runtime:
                        this.infinityProcess.terminal?.sendText( '\u0003' );
                    } else if ( this.infinityProcess.process?.pid ) {
                        // Send a terminate/break signal to the runtime:
                        if ( process.platform === 'win32' ) {
                            this.infinityProcess.process.kill( os.constants.signals.SIGBREAK );
                        } else {
                            this.infinityProcess.process.kill( os.constants.signals.SIGTERM );
                        }
                    }
                } else {
                    // Debug mode. Send a terminate command to the runtime:
                    this.infinity.send( 'terminate' ).then( () => {
                    } ).catch( error => {
                        this.sendErrorResponse( response, 500, 'Could not terminate the INFINITY debugger: ' + this.getErrorMessage( error ) );
                    } );
                }
            }
        }

        // The this.infinityProcess property will be unset by the infinityTerminated() method,
        // when the runtime has actually terminated.
    }

    /**
     * Called when the INFINITY runtime has terminated.
     */
    private infinityTerminated = () => {
        if ( this.infinityProcess.active ) {
            if ( this.infinityProcess.timeoutId ) {
                clearTimeout( this.infinityProcess.timeoutId );
                this.infinityProcess.timeoutId = undefined;
            }

            if ( this.infinityProcess.active && this.infinityProcess.response ) {
                this.sendResponse( this.infinityProcess.response );
                this.infinityProcess.response = undefined;
            }
            
            let line: string = this.infinityOutput.getPendingData();

            if ( line.length ) {
                this.sendEvent( new OutputEvent( line + '\r\n', 'stdout' ) );
            }

            line = this.infinityErrorOutput.getPendingData();

            if ( line.length ) {
                this.sendEvent( new OutputEvent( line + '\r\n', 'stderr' ) );
            }

            this.sendEvent( new TerminatedEvent() );
            this.infinityProcess.active = false;
        }
    };

    /**
     * Called when the INFINITY runtime has halted in debug mode.
     * 
     * @param data {any}
     */
    private onInfinityStopped = ( data: any ) => {
        let reason = data.body ? data.body.reason : undefined;

        if ( data.body && data.body.threadId ) {
            this.currentThreadId = data.body.threadId;
        }

        let event: any = undefined;

        switch ( reason ) {
            case 'initialized':
                this.status.initialized = true;
                this.sendEvent( new InitializedEvent() );
                break;

            case 'stepIn':
            case 'stepOut':
            case 'stepOver':
                event = { event: 'stopped', body: { reason: 'step', threadId: this.currentThreadId, allThreadsStopped: true } };
                break;

            case 'debug':
                event = { event: 'stopped', body: { reason: 'debugger statement', threadId: this.currentThreadId, allThreadsStopped: true } };
                break;

            default:
                event = { event: 'stopped', body: { reason: reason, threadId: this.currentThreadId, allThreadsStopped: true } };
                break;
        }

        if ( event ) {
            // If the frontend isn't ready for events, yet, then cache the event and send it when the frontend becomes ready (in configurationDoneRequest):
            if ( this.status.frontendReady ) {
                this.sendEvent( event );
            } else {
                this.pendingFrontendEvents.push( event );
            }
        }
    };

    /**
     * Parses INFINITY scope data.
     * 
     * @param name {string}
     * @param data {any}
     * @param depth {number}
     * @return any
     */
    private parseScope( name: string,  data: any, depth: number ): any {
        depth = depth || 0;

        if ( !data || depth > 5 ) {
            return undefined;
        }

        if ( !name ) {
            name = 'Scope';
        }

        let id = this.nextScopeId++;

        let scope: InfinityScope = {
            id: id,
            name: name || '[unknown]',
            type: data.type ? data.type.toLowerCase() : '',
            value: '',
            children: []
        };

        if ( scope.type === 'arguments' || scope.type === 'iterator' ) {
            return undefined;
        }

        this.scopes.set( scope.id, scope );

        if ( scope.value === null ) {
            scope.value = 'null';
        }

        switch ( scope.type ) {
            case 'string':
                scope.value = '' + data.value;
                break;

            case 'number':
                if ( typeof data.value === 'string' && data.value.length && data.value[ 0 ] === '[' ) {
                    scope.value = data.value.substr( 1, data.value.length - 2 );
                } else {
                    scope.value = '' + data.value;
                }
                break;

            case 'function':
                scope.value = data.value ? data.value.file + ':' + data.value.line : '';
                break;

            case 'cfunction':
                scope.type = 'function';
                scope.value = '[native]';
                break;

            case 'userdata':
                scope.type = 'native';
                scope.value = '[native]';
                break;

            case 'array':
                if ( data.value && data.value.length ) {
                    for ( let i = 0; i < data.value.length; i++ ) {
                        let child = this.parseScope( '' + i, data.value[ i ], depth + 1 );

                        if ( child ) {
                            scope.children.push( child );
                        } else {
                            scope.children.push( { id: this.nextScopeId++, name: 'undefined', type: 'undefined', value: '', children: [] } );
                        }
                    }
                }
                break;
            
            case 'object':
                if ( typeof data.value === 'object' ) {
                    for ( let prop in data.value ) {
                        let child = this.parseScope( prop, data.value[ prop ], depth + 1 );

                        if ( child ) {
                            scope.children.push( child );
                        }
                    }
                } else if ( !scope.value ) {
                    scope.value = 'undefined';
                }
                break;

            case 'script':
                scope.value = '[script]';
                break;

            case 'eval':
                scope.value = '[eval]';
                break;

            case 'error':
                scope.value = '[error]';
                break;

            default:
                if ( !scope.value ) {
                    scope.value = 'undefined';
                }
                break;
        }

        return scope;
    }

    /**
     * Translates a javascript file name from the INFINITY runtime to a source file name for visual studio code.
     * 
     * @param file {string}
     * @return Promise<string>
     */
    private async translateDebuggerFileToSource( file: string ): Promise<string> {
        if ( this.noSourceMaps ) {
            return file;
        }

        let mapping: SourceMapping | undefined = this.debuggerMappings.get( file );

        if ( !mapping ) {
            mapping = await this.initMapping( '', file );
        }

        return mapping ? mapping.sourceFile : file;
    }

    /**
     * Translates a source file from visual studio code to a javascript file name for the INFINITY runtime.
     * 
     * @param file {string}
     * @return Promise<string>
     */
    private async translateSourceFileToDebugger( file: string ): Promise<string> {
        if ( this.noSourceMaps ) {
            return file;
        }

        let mapping: SourceMapping | undefined = this.sourceMappings.get( file );

        if ( !mapping ) {
            mapping = await this.initMapping( file, '' );
        }

        return mapping ? mapping.debuggerFile : file;
    }

    /**
     * Translates a line number from a source file to a line number of a javascript file in the INFINITY runtime.
     * 
     * @param file {string}
     * @param line {number}
     * @return Promise<number>
     */
    private async translateSourceLineToDebugger( file: string, line: number ): Promise<number> {
        if ( this.noSourceMaps ) {
            return line;
        }

        let mapping: SourceMapping | undefined = this.sourceMappings.get( file );

        if ( !mapping ) {
            mapping = await this.initMapping( file, '' );
        }

        if ( mapping ) {
            return mapping.sourceToDebuggerLines[ line ] || line;
        } else {
            return line;
        }
    }

    /**
     * Translates a line number from an INFINITY runtime javascript file to a line number in the source file.
     * 
     * @param file {string}
     * @param line {number}
     * @return Promise<number>
     */
    private async translateDebuggerLineToSource( file: string, line: number ): Promise<number> {
        if ( this.noSourceMaps ) {
            return line;
        }

        let mapping: SourceMapping | undefined = this.sourceMappings.get( file );

        if ( !mapping ) {
            mapping = await this.initMapping( '', file );
        }

        if ( mapping ) {
            return mapping.debuggerToSourceLines[ line ] || line;
        } else {
            return line;
        }
    }

    /**
     * Initializes the source to runtime file mapping.
     * 
     * @param sourceFile {string}
     * @param debuggerFile {string}
     * @return Promise<SourceMapping>
     */
    private async initMapping( sourceFile: string, debuggerFile: string ): Promise<SourceMapping> {
        if ( !sourceFile && !debuggerFile ) {
            throw new Error( 'Invalid source and debugger files' );
        } else if ( sourceFile && !debuggerFile ) {
            debuggerFile = sourceFile.replace( '\\', '/' ); // INFINITY debugger uses forward slashes for paths

            if ( debuggerFile.substring( debuggerFile.length - 3 ).toLowerCase() === '.ts' ) {
                debuggerFile = debuggerFile.substring( 0, debuggerFile.length - 3 ) + '.js';
            }
        }

        let mapping: SourceMapping = {
            sourceFile: sourceFile,
            debuggerFile: debuggerFile,
            sourceToDebuggerLines: {},
            debuggerToSourceLines: {}
        };

        this.sourceMappings.set( sourceFile, mapping );
        this.debuggerMappings.set( debuggerFile, mapping );

        let sourceMapFile = this.sourceMapsFolder + debuggerFile + '.map';

        if ( fs.existsSync( sourceMapFile ) ) {
            try {
                let sourceMap: SourceMapConsumer = await new SourceMapConsumer( JSON.parse( fs.readFileSync( sourceMapFile ).toString() ) );

                sourceMap.eachMapping( sourceMapping => {
                    if ( !this.sourceFolder ) {
                        this.sourceFolder = this.fixLocalPath( this.programFolder + path.dirname( sourceMapping.source ) + '/' );
                    }

                    if ( !mapping.sourceFile ) {
                        let debuggerDir = path.dirname( debuggerFile );
                        mapping.sourceFile = ( debuggerDir ? debuggerDir + '/' : '' ) + path.basename( sourceMapping.source );
                    }
                    
                    if ( mapping.sourceToDebuggerLines[ sourceMapping.originalLine ] === undefined ) {
                        mapping.sourceToDebuggerLines[ sourceMapping.originalLine ] = sourceMapping.generatedLine;
                    }

                    if ( mapping.debuggerToSourceLines[ sourceMapping.generatedLine ] === undefined ) {
                        mapping.debuggerToSourceLines[ sourceMapping.generatedLine ] = sourceMapping.originalLine;
                    }
                } );
            } catch ( e ) {}
        }

        if ( !mapping.sourceFile ) {
            mapping.sourceFile = mapping.debuggerFile;
        }

        return mapping;
    }

    /**
     * Returns a visual studio code Source for an INFINITY runtime javascript file.
     * 
     * @param debuggerFile {string}
     * @return Promise<Source>
     */
    private async getSource( debuggerFile: string ): Promise<Source> {
        return new Source(
            await this.translateDebuggerFileToSource( debuggerFile ),
            this.convertDebuggerPathToClient( (this.sourceFolder || this.programFolder) + await this.translateDebuggerFileToSource( debuggerFile ) )
        );
    }

    /**
     * Fixes local path names.
     * On win32 platforms, the drive letter of an absolute path is sometimes upper case and sometimes lower case.
     * This method forces the drive letter to lower case for easier comparison.
     * 
     * @param localPath {string}
     * @return string
     */
    private fixLocalPath( localPath: string ): string {
        if ( localPath && localPath.length ) {
            localPath = path.normalize( localPath );
            localPath = localPath[ 0 ].toLowerCase() + localPath.substring( 1 );
        }

        return localPath;
    }

    /**
     * Returns the error message of an exception object or string.
     * 
     * @param error {any}
     */
    private getErrorMessage( error: any ) {
        if ( typeof error === 'object' ) {
            return error.message ? error.message : 'unkown error';
        } else {
            return '' + error;
        }
    }

}
