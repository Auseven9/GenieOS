/**
 * Gates keyless public-API talents (weather, crypto) behind the same
 * Internet Search consent the user already grants for web_search/read_url.
 * An outbound request to a third-party API is the same privacy tradeoff
 * whether or not it needs an API key, so this reuses that one toggle
 * rather than adding a second consent concept for the same thing.
 */
export interface KeylessApiAccess {
  isEnabled(): boolean;
}
