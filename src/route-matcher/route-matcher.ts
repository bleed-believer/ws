import type { ParamData, MatchFunction } from 'path-to-regexp';

import { match } from 'path-to-regexp';

import { decodeParam } from './route-matcher.decode-param.js';
import { loosen } from './route-matcher.loosen.js';

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
