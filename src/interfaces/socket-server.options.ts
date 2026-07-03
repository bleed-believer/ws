import type { ServerOptions } from 'ws';

export type SocketServerOptions = Omit<ServerOptions, 'noServer' | 'host' | 'port' | 'WebSocket'>;