import type { WebSocketObject } from './web-socket.object.js';
import type { IncomingMessage } from 'node:http';
import type { ParamData } from 'path-to-regexp';

export type WebSocketCallback<T extends ParamData> = (
    ws: WebSocketObject<T>,
    req: IncomingMessage,
    next: () => void
) => unknown;