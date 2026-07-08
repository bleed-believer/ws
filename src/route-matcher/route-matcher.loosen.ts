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
