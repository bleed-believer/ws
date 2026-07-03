import type { MatchResult, ParamData } from 'path-to-regexp';

export type WebSocketObject<T extends ParamData> = WebSocket & MatchResult<T>;