import type { MatchResult, ParamData } from 'path-to-regexp';

/**
 * A `ws` `WebSocket` instance decorated with the route match result
 * (`path` and `params`) computed by the router for the connection's URL.
 *
 * @typeParam T - Shape of the route parameters extracted from the path.
 */
export type WebSocketObject<T extends ParamData> = WebSocket & MatchResult<T>;