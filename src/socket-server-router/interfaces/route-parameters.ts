/**
 * Removes everything starting at the first occurrence of `Tail` from `S`.
 *
 * Used to cut a route parameter name short at the next path segment
 * delimiter (`/`), modifier (`-`), extension (`.`) or optional group (`{`).
 *
 * @typeParam S - String to trim.
 * @typeParam Tail - Delimiter pattern that marks where `S` should be cut.
 */
type RemoveTail<S extends string, Tail extends string> =
    S extends `${infer P}${Tail}` ? P : S;

/**
 * Extracts a single route parameter name from the remainder of a route
 * string, stopping at the next delimiter, modifier, extension or optional
 * group boundary.
 *
 * @typeParam S - Route remainder that starts right after a `:` or `*` token.
 */
type GetRouteParameter<S extends string> = RemoveTail<
    RemoveTail<RemoveTail<RemoveTail<S, `/${string}`>, `-${string}`>, `.${string}`>,
    `{${string}`
>;

/**
 * Recursively walks a route substring that contains no optional groups and
 * builds an object type mapping every named (`:name`) and wildcard
 * (`*name`) parameter to its resulting value type. Every parameter is
 * treated as required; optionality is layered on by {@link ExtractParams}.
 *
 * @typeParam Route - Route substring to parse.
 */
type ExtractRequired<Route extends string> =
    Route extends `${string}:${infer Rest}`
        ? { [K in GetRouteParameter<Rest>]: string }
          & (Rest extends `${GetRouteParameter<Rest>}${infer Next}`
              ? ExtractRequired<Next>
              : {})
        : Route extends `${string}*${infer Rest}`
            ? { [K in GetRouteParameter<Rest>]: string[] }   // ← wildcard: array, no string
              & (Rest extends `${GetRouteParameter<Rest>}${infer Next}`
                  ? ExtractRequired<Next>
                  : {})
            : {};

/**
 * Flattens an intersection of parameter fragments into a single object type
 * with every key made optional.
 *
 * @typeParam T - Parameter object (or intersection) to relax.
 */
type Optionalize<T> = { [K in keyof T]?: T[K] };

/**
 * Recursively walks a `path-to-regexp` v8 (Express 5) route string and
 * builds an object type mapping every named (`:name`) and wildcard
 * (`*name`) parameter to its resulting value type. Parameters wrapped in an
 * optional group `{ ... }` become optional properties, matching Express's
 * brace syntax (e.g. `/user{/:id}` or `/:file{.:ext}`).
 *
 * @typeParam Route - Route pattern to parse.
 */
type ExtractParams<Route extends string> =
    Route extends `${infer Before}{${infer Group}}${infer After}`
        ? ExtractRequired<Before>
          & Optionalize<ExtractParams<Group>>
          & ExtractParams<After>
        : ExtractRequired<Route>;

/**
 * Infers the shape of the parameters object produced when matching a given
 * route pattern, using `path-to-regexp` v8 / Express 5 syntax:
 *
 * - `:name` — required segment, e.g. `RouteParameters<'/user/:id'>` →
 *   `{ id: string }`.
 * - `{ ... }` — optional group, e.g. `RouteParameters<'/user{/:id}'>` →
 *   `{ id?: string }`.
 * - `*name` — named wildcard (catch-all), e.g.
 *   `RouteParameters<'/files/*rest'>` → `{ rest: string[] }`.
 *
 * @typeParam P - Route pattern to parse.
 */
export type RouteParameters<P extends string> = ExtractParams<P>;
