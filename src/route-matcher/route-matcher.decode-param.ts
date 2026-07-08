/**
 * Decodes a single matched route parameter value.
 *
 * Mirrors Express 5's `decodeParam`, except that malformed percent-encoded
 * sequences are returned untouched instead of throwing: there is no HTTP
 * response cycle during a WebSocket upgrade in which to surface a `400`.
 *
 * @param value - Raw parameter value captured by `path-to-regexp`.
 * @returns The decoded value, or the original one when it cannot be decoded.
 */
export function decodeParam(value: string): string {
    if (typeof value !== 'string' || value.length === 0) {
        return value;
    }

    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}
