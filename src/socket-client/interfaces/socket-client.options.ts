export interface SocketClientOptions {
    messageType?: 'arraybuffer' | 'blob' | 'string';
    /**
     * Milliseconds to wait between reconnection attempts after an unsolicited
     * drop. When omitted, a dropped connection isn't retried. Must be a
     * non-negative integer; `0` retries as fast as the runtime allows, which
     * hammers the peer.
     */
    reconnectMs?: number;
    /**
     * Milliseconds a handshake may take before it's aborted. When omitted, a
     * peer that accepts the TCP connection but never completes the upgrade
     * keeps `connect()` pending forever. Must be a positive integer.
     */
    timeoutMs?: number;
    protocols?: string[];
}
