/**
 * Barrel file that re-exports every type belonging to the
 * {@link SocketServer} feature.
 */

export type { Server } from './server.js';
export type { SocketServerInject } from './socket-server.inject.js';
export type { SocketServerOptions } from './socket-server.options.js';

export type { WebSocketObject } from './web-socket.object.js';
export type { WebSocketCallback } from './web-socket.callback.js';
export type { WebSocketServerObject } from './web-socket-server.object.js';
export type { WebSocketServerEventMap } from './web-socket-server.event-map.js';
