import { EOL } from 'os';

export class LineBuffer {

    private buffer: string = '';
    private eventListeners: Array<((data: string) => void)> = [];

    public on( callback: (data: string) => void ) {
        this.eventListeners.push( callback );
    }

    public addData( data: string ) {
        let start: number = 0;
        let end: number = 0;

        if ( this.buffer.length ) {
            data = this.buffer + data;
            this.buffer = '';
        }

        while ( ( end = data.indexOf( EOL, start ) ) !== -1 ) {
            let line = data.substring( start, end );
            this.onEvent( line );
            start = end + 2;
        }

        if ( start < data.length ) {
            this.buffer = data.substring( start );
        }
    }

    public clear(): void {
        this.buffer = '';
    }

    public getPendingData(): string {
        return this.buffer;
    }

    private onEvent( data: string ) {
        for ( let callback of this.eventListeners ) {
            callback( data );
        }
    }

}