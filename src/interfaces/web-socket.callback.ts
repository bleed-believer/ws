import type { WebSocketObject } from './web-socket.object.js';
import type { IncomingMessage } from 'node:http';
import type { ParamData } from 'path-to-regexp';

/**
 * Handler registered through {@link SocketServerRouter.use} for a matched
 * route.
 *
 * @typeParam T - Shape of the route parameters extracted from the path,
 * typically produced by {@link RouteParameters}.
 * @param ws - The upgraded WebSocket connection, enriched with the matched
 * `path` and `params`.
 * @param req - The original HTTP upgrade request.
 * @param next - Call to pass control to the next matching handler in the
 * chain instead of claiming the connection.
 */
export type WebSocketCallback<T extends ParamData> = (
    ws: WebSocketObject<T>,
    req: IncomingMessage,
    next: () => void
) => unknown;