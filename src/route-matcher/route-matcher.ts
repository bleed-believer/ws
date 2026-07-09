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
 * When `end` is `false` the pattern matches as a **prefix**, the way Express
 * mounts middleware under a path (`app.use('/api', mw)`): the request only
 * needs to *start* with the pattern, on a segment boundary, so `/api` also
 * matches `/api/users`. In that mode the handler is still shown the full
 * request path (not just the consumed prefix), mirroring the pathless
 * catch-all above.
 *
 * @param path - Route pattern as flattened by `SocketServerRouter.routes`,
 * or `undefined` for a catch-all handler.
 * @param end - Whether the pattern must match the whole path (`true`, an exact
 * route) or only a prefix of it (`false`, a mounted middleware). Defaults to
 * `true`.
 * @returns A `path-to-regexp` match function for the route.
 */
export function createRouteMatcher(
    path: string | undefined,
    end: boolean = true
): MatchFunction<ParamData> {
    if (typeof path !== 'string') {
        return (requestPath: string) => ({ path: requestPath, params: {} });
    }

    const matchFn = match(loosen(path), {
        sensitive: false,
        trailing: true,
        decode: decodeParam,
        end
    });

    if (end) {
        return matchFn;
    }

    // Prefix mount: `path-to-regexp` reports only the consumed prefix as
    // `result.path`; expose the full request path instead so the mounted
    // handler sees where the connection actually points.
    return (requestPath: string) => {
        const result = matchFn(requestPath);
        return result
        ?   { ...result, path: requestPath }
        :   result;
    };
}
