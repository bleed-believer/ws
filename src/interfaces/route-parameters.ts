/**
 * Removes everything starting at the first occurrence of `Tail` from `S`.
 *
 * Used to cut a route parameter name short at the next path segment
 * delimiter (`/`), modifier (`-`) or extension (`.`).
 *
 * @typeParam S - String to trim.
 * @typeParam Tail - Delimiter pattern that marks where `S` should be cut.
 */
type RemoveTail<S extends string, Tail extends string> =
    S extends `${infer P}${Tail}` ? P : S;

/**
 * Extracts a single route parameter name (including a trailing `?` for
 * optional parameters) from the remainder of a route string.
 *
 * @typeParam S - Route remainder that starts right after a `:` or `*` token.
 */
type GetRouteParameter<S extends string> = RemoveTail<
    RemoveTail<RemoveTail<S, `/${string}`>, `-${string}`>,
    `.${string}`
>;

/**
 * Recursively walks a `path-to-regexp`-style route string and builds an
 * object type mapping every named (`:name`) and wildcard (`*name`)
 * parameter to its resulting value type.
 *
 * @typeParam Route - Route pattern to parse.
 */
type ExtractParams<Route extends string> =
    Route extends `${string}:${infer Rest}`
        ? (GetRouteParameter<Rest> extends `${infer Name}?`
            ? { [K in Name]?: string }
            : { [K in GetRouteParameter<Rest>]: string })
          & (Rest extends `${GetRouteParameter<Rest>}${infer Next}`
              ? ExtractParams<Next>
              : {})
        : Route extends `${string}*${infer Rest}`
            ? { [K in GetRouteParameter<Rest>]: string[] }   // ← wildcard: array, no string
              & (Rest extends `${GetRouteParameter<Rest>}${infer Next}`
                  ? ExtractParams<Next>
                  : {})
            : {};

/**
 * Infers the shape of the parameters object produced when matching a given
 * route pattern, e.g. `RouteParameters<'/user/:id/*rest'>` resolves to
 * `{ id: string } & { rest: string[] }`.
 *
 * @typeParam P - Route pattern, using `:name` for named segments and
 * `*name` for wildcard (catch-all) segments.
 */
export type RouteParameters<P extends string> = ExtractParams<P>;