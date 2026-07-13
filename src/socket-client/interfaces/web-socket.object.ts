export interface WebSocketObject {
    get readyState(): globalThis.WebSocket['readyState'];

    removeEventListener(name: 'message',   c: (e: MessageEvent) => unknown): void;
    removeEventListener(name: 'close',     c: (e: CloseEvent) => unknown): void;
    removeEventListener(name: 'error',     c: (e: Event) => unknown): void;
    removeEventListener(name: 'open',      c: (e: Event) => unknown): void;

    addEventListener(name: 'message',   c: (e: MessageEvent) => unknown): void;
    addEventListener(name: 'close',     c: (e: CloseEvent) => unknown): void;
    addEventListener(name: 'error',     c: (e: Event) => unknown): void;
    addEventListener(name: 'open',      c: (e: Event) => unknown): void;
    
    binaryType: globalThis.WebSocket['binaryType'];
    close(): void;
    send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void
}