import type { MatchResult, ParamData } from 'path-to-regexp';
import type { WebSocket } from 'ws';

/**
 * A `ws` `WebSocket` instance decorated with the route match result
 * (`path` and `params`) computed by the router for the connection's URL.
 *
 * Like Express's `req.params`, `path` and `params` are a single mutable
 * reference that the router **reassigns to the currently executing handler's
 * matched values** before invoking it. While a handler runs, they always
 * describe that handler's own route; once it hands control to the next handler
 * via `next()`, the reference is updated for that handler instead. Read them
 * synchronously (e.g. destructure `const { id } = ws.params`) if you need to
 * keep a value past an `await` or inside an asynchronous listener.
 *
 * @typeParam T - Shape of the route parameters extracted from the path.
 */
export type WebSocketObject<T extends ParamData> = WebSocket & MatchResult<T>;