import { Socket } from 'net';

/**
 * INFINITY runtime debugger request.
 */
interface InfinityRequest {
    id: number;
    request: string;
    response: any;
    success: boolean,
    data?: any;
    listener: ( response: InfinityRequest ) => void;
}

/**
 * INFINITY runtime debugger connection.
 */
export class InfinityConnection {

    private connection?: Socket;
    private connected: boolean = false;
    private connectionRequests: Map<number, InfinityRequest> = new Map<number, InfinityRequest>();
    private eventListeners: Map<string, ((data?: any) => void)[]> = new Map<string, ((data?: any) => void)[]>();
    private requestId: number = 0;
    private host: string = 'localhost';
    private port: number = 9090;
    private timeout: number = 5000;
    private maxInitTime: number = 0;
    private initInterval: number = 250;
    private pendingLength: number = 0;
    private pendingData: string = '';
    private connectionInitialized: boolean = false;

    /**
     * Connects to an INFINITY runtime.
     * 
     * @param host {string}
     * @param port {number}
     * @param timeout {number}
     */
    public async connect ( host?: string, port?: number, timeout?: number ) {
        this.host = host || 'localhost';
        this.port = port || 9090;

        if ( timeout !== undefined ) {
            this.timeout = timeout;
        }

        this.disconnect();

        this.connection = new Socket();
        this.connection.setEncoding( 'utf8' );
        this.connection.on( 'data', this.onConnectionData ); // Attach data listener early, so we don't miss the welcome message of the INFINTY debugger.
        this.connection.on( 'error', this.onConnectionError );
        this.connection.on( 'close', this.onConnectionClosed );
        this.connection.on( 'end', this.onConnectionClosed );
        this.connected = false;

        this.maxInitTime = (new Date()).getTime() + this.timeout;
        this.connection.setTimeout( this.timeout, () => {
            this.connection?.emit( 'error', new Error( 'Connection timeout' ) );
        } );

        this.connectionInitialized = false;

        // Connect and start checking for the connection to be initialized:
        this.connection.connect( this.port, this.host );
        setTimeout( this.tryConnect, this.initInterval );
    }

    protected tryConnect = (): void => {
        if ( this.connection && !this.connectionInitialized ) {
            let currentTime = (new Date()).getTime();

            if ( currentTime < this.maxInitTime ) {
                this.connection.connect( { port: this.port, host: this.host } );
                setTimeout( this.tryConnect, this.initInterval );
            } else {
                this.disconnect();
                this.onEvent( 'connectionError', 'Could not connect to INFINITY debug port' );
            }
        }
    };

    /**
     * Disconnects from the INFINTY runtime.
     */
    public disconnect() {
        this.connection?.destroy();
        this.connection = undefined;
        this.connected = false;
    }

    /**
     * Sends a command to the INFINITY runtime.
     * 
     * @param request {string}
     * @param params {any}
     * @param data {any}
     * @return Promise<InfinityRequest>
     */
    public async send( request: string, params?: any, data?: any ): Promise<InfinityRequest> {
        return new Promise<InfinityRequest>( (resolve, reject) => {
            if ( !this.connected ) {
                reject( { success: false, error: 'Not connected to INFINITY debugger' } );
            }

            let requestObj: InfinityRequest = {
                id: ++this.requestId,
                request: request,
                response: '',
                success: false,
                data: data,
                listener: ( response: InfinityRequest ) => {
                    if ( response.success ) {
                        resolve( response );
                    } else {
                        reject( response );
                    }
                }
            };

            this.connectionRequests.set( requestObj.id, requestObj );

            let requestData: any = {
                id: requestObj.id,
                request: requestObj.request,
            };

            if ( params !== undefined ) {
                requestData.params = params;
            }

            let requestDataStr: string = JSON.stringify( requestData );

            // Send the request length as an 8 byte hex value:
            let requestLength = Number( requestDataStr.length ).toString( 16 ).padStart( 8, '0' );
            this.connection?.write( requestLength + '\r\n' + requestDataStr + '\r\n' );
        } );
    }

    /**
     * Registers an event handler on the connection.
     * 
     * @param event {string}
     * @param callback {function(data)}
     */
    public on ( event: string, callback: (data?: any) => void ) {
        if ( !event ) {
            throw new Error( 'Invalid event name' );
        }

        let listeners = this.eventListeners.get( event );

        if ( !listeners ) {
            listeners = [];
            this.eventListeners.set( event, listeners );
        }

        listeners.push( callback );
    }

    /**
     * Returns true if the INFINITY runtime is connected.
     * 
     * @return boolean
     */
    public isConnected = (): boolean => {
        return this.connected;
    };

    /**
     * Called when the INFINITY runtime sends data.
     * 
     * @param data {string}
     */
    private onConnectionData = ( data: string ) => {
        try {
            while ( data.length ) {
                if ( this.pendingLength ) {
                    let missingLength = this.pendingLength - this.pendingData.length;
                    let missingData = data.substring( 0, missingLength );
                    this.pendingData += missingData;
                    data = data.substring( missingData.length + 2 ); // Skip CR+LF
                } else {
                    if ( data.length < 8 ) {
                        throw new Error( 'missing response length' );
                    }

                    this.pendingLength = parseInt( data.substring( 0, 8 ), 16 ); // Length is in the first 8 bytes (hex coded)
                    this.pendingData = data.substring( 10, 10 + this.pendingLength ); // Skip length-header and CR+LF
                    data = data.substring( 12 + this.pendingData.length ); // Skip length-header and CR+LF and data and CR+LF
                }

                if ( this.pendingData.length < this.pendingLength ) {
                    break; // incomplete data, wait for more data
                } else if ( this.pendingData.length ) {
                    // process complete data
                    let responseData = this.pendingData;
                    let responseJson: any;
                    this.pendingLength = 0;
                    this.pendingData = '';

                    responseJson = JSON.parse( responseData );
    
                    if ( responseJson && responseJson.event ) {
                        this.onInfinityEvent( responseJson );
                    } else {
                        this.onInfinityResponse( responseJson );
                    }
                }
            }
        } catch ( error: any ) {
            this.onEvent( 'error', { message: 'Invalid response from INFINITY: ' + ( typeof error === 'object' ? error.message || '' : '' + error ) } );
        }
    };

    /**
     * Called when a connection error occurred.
     * 
     * @param error {any}
     */
    private onConnectionError = ( error: any ) => {
        // Retry connection errors when initializing the connection:
        if ( !this.connectionInitialized ) {
            return;
        }

        let wasConnected = this.connected;
        this.disconnect();

        if ( wasConnected ) {
            this.onEvent( 'connectionError', error );
        }
    };

    /**
     * Called when the connection to the INFINITY runtime has closed.
     */
    private onConnectionClosed = () => {
        // Don't destroy the connection if it is still trying to establish the initial connection:
        if ( !this.connectionInitialized ) {
            return;
        }

        let wasConnected = this.connected;
        this.disconnect();

        if ( wasConnected ) {
            this.onEvent( 'connectionClosed' );
        }
    };

    /**
     * Called when the INFINITY runtime has sent back a response to a request.
     * 
     * @param data {any}
     */
    private onInfinityResponse = ( data: any ) => {
        let responseId: number = data.id || 0;

        if ( this.connectionRequests.has( responseId ) ) {
            let request = this.connectionRequests.get( responseId );
            this.connectionRequests.delete( responseId );

            if ( request && request.listener ) {
                request.success = !data.error;
                request.response = data.error || data.response;
                request.listener( request );
            }
        }
    };

    /**
     * Called when the INFINITY runtime sends an event.
     * 
     * @param data {any}
     */
    private onInfinityEvent = ( data: any ) => {
        if ( data && data.event === 'connected' ) {
            this.connected = true;
            this.connectionInitialized = true;
            this.connection?.setTimeout( 0 );
        }

        this.onEvent( data.event, data );
    };

    /**
     * Called when an event occurred on the connection or in the INFINITY runtime.
     * 
     * @param event {string}
     * @param data {any}
     */
    private onEvent = ( event: string, data?: any ) => {
        if ( event ) {
            let listeners = this.eventListeners.get( event );

            if ( listeners ) {
                for ( let callback of listeners ) {
                    callback( data );
                }
            }
        }
    };
}
