import type { ParamData, MatchFunction } from 'path-to-regexp';

import { match } from 'path-to-regexp';

/**
 * Matches one or more trailing slashes at the end of a path.
 */
const TRAILING_SLASH_REGEXP = /\/+$/;

/**
 * Strips trailing slashes from a route pattern, mirroring Express 5's
 * `router` (`loosen`), so a request matches whether or not it ends with a
 * slash. The root path `/` is left untouched.
 *
 * @param path - Route pattern to loosen.
 * @returns The pattern without trailing slashes.
 */
export function loosen(path: string): string {
    return path === '/'
    ?   path
    :   path.replace(TRAILING_SLASH_REGEXP, '');
}

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

/**
 * Builds the match function for a single registered route, replicating the
 * exact path-parsing pipeline Express 5 applies through its `router`:
 * {@link loosen} the pattern and hand it to `path-to-regexp` v8 with
 * Express's default options (case-insensitive, anchored, trailing-slash
 * tolerant, decoded params).
 *
 * Pathless routes (registered without a path) are represented by an
 * `undefined` pattern and match every request, exposing the raw path and
 * empty params.
 *
 * @param path - Route pattern as flattened by `SocketServerRouter.routes`,
 * or `undefined` for a catch-all handler.
 * @returns A `path-to-regexp` match function for the route.
 */
export function createRouteMatcher(path: string | undefined): MatchFunction<ParamData> {
    if (typeof path !== 'string') {
        return (requestPath: string) => ({ path: requestPath, params: {} });
    }

    return match(loosen(path), {
        sensitive: false,
        end: true,
        trailing: true,
        decode: decodeParam
    });
}
