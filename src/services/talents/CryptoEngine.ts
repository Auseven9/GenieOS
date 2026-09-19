import {TalentEngine, TalentResult, ToolDefinition} from './types';
import type {KeylessApiAccess} from './keylessApiAccess';
import {fetchJson} from '../search/providers/http';

interface CoinSearchResult {
  id: string;
  name: string;
  symbol: string;
}

interface CoinSearchResponse {
  coins?: CoinSearchResult[];
}

// CoinGecko's simple/price shape: {<coin id>: {<currency>: number, <currency>_24h_change?: number}}
type CoinPriceResponse = Record<string, Record<string, number>>;

/**
 * `get_crypto_price` talent — keyless, via CoinGecko's public API (search
 * to resolve a name/ticker to a coin id, then simple/price for the quote),
 * so a crypto price question never spends a web_search call against a
 * rate-limited/paid provider.
 */
export class CryptoEngine implements TalentEngine {
  readonly name = 'get_crypto_price';

  constructor(private access: KeylessApiAccess) {}

  async execute(args: Record<string, any>): Promise<TalentResult> {
    const symbol = typeof args.symbol === 'string' ? args.symbol.trim() : '';
    if (!symbol) {
      return {
        type: 'error',
        summary: 'get_crypto_price: missing or empty "symbol" argument',
        errorMessage:
          'symbol argument is required and must be a non-empty string',
      };
    }
    const vsCurrency =
      typeof args.vs_currency === 'string' && args.vs_currency.trim()
        ? args.vs_currency.trim().toLowerCase()
        : 'usd';

    if (!this.access.isEnabled()) {
      const summary = 'get_crypto_price: internet access not enabled';
      return {
        type: 'error',
        summary,
        errorMessage:
          'Internet access for tools is not enabled. Accept the disclosure in Settings → Internet Search.',
      };
    }

    try {
      const search = await fetchJson<CoinSearchResponse>(
        `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(
          symbol,
        )}`,
        {method: 'GET', headers: {Accept: 'application/json'}},
      );
      const coin = search.coins?.[0];
      if (!coin) {
        const summary = `get_crypto_price: could not find a cryptocurrency matching "${symbol}"`;
        return {type: 'error', summary, errorMessage: summary};
      }

      const price = await fetchJson<CoinPriceResponse>(
        `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(
          coin.id,
        )}&vs_currencies=${encodeURIComponent(
          vsCurrency,
        )}&include_24hr_change=true`,
        {method: 'GET', headers: {Accept: 'application/json'}},
      );
      const quote = price[coin.id];
      const value = quote?.[vsCurrency];
      if (value === undefined) {
        const summary = `get_crypto_price: no ${vsCurrency.toUpperCase()} price available for ${
          coin.name
        }`;
        return {type: 'error', summary, errorMessage: summary};
      }
      const change = quote[`${vsCurrency}_24h_change`];
      const changeText =
        typeof change === 'number'
          ? ` (${change >= 0 ? '+' : ''}${change.toFixed(2)}% in 24h)`
          : '';

      const summary = `${coin.name} (${coin.symbol.toUpperCase()}): ${value} ${vsCurrency.toUpperCase()}${changeText}`;
      return {type: 'text', summary};
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      return {
        type: 'error',
        summary: `get_crypto_price: ${errMsg}`,
        errorMessage: errMsg,
      };
    }
  }

  toToolDefinition(): ToolDefinition {
    return {
      type: 'function',
      function: {
        name: 'get_crypto_price',
        description:
          'Get the current price of a cryptocurrency, with its 24-hour change. Prefer this over web_search for crypto price questions; it is faster and does not use search quota.',
        parameters: {
          type: 'object',
          properties: {
            symbol: {
              type: 'string',
              description:
                "Cryptocurrency name or ticker, e.g. 'bitcoin', 'BTC', 'ethereum'.",
            },
            vs_currency: {
              type: 'string',
              description:
                "Currency to price in, e.g. 'usd', 'eur'. Defaults to 'usd'.",
            },
          },
          required: ['symbol'],
        },
      },
    };
  }
}
