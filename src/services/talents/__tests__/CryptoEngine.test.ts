import {CryptoEngine} from '../CryptoEngine';
import type {KeylessApiAccess} from '../keylessApiAccess';

const okJson = (body: unknown) =>
  Promise.resolve({
    ok: true,
    status: 200,
    text: () => Promise.resolve(JSON.stringify(body)),
  });

const makeAccess = (enabled = true): KeylessApiAccess => ({
  isEnabled: () => enabled,
});

const searchBody = {
  coins: [{id: 'bitcoin', name: 'Bitcoin', symbol: 'btc'}],
};

const priceBody = {
  bitcoin: {usd: 65000.42, usd_24h_change: 1.234},
};

describe('CryptoEngine', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  it('exposes the get_crypto_price schema with a required symbol param', () => {
    const def = new CryptoEngine(makeAccess()).toToolDefinition();
    expect(def.function.name).toBe('get_crypto_price');
    expect(def.function.parameters.required).toEqual(['symbol']);
  });

  it('returns an error without hitting the network when symbol is missing', async () => {
    const engine = new CryptoEngine(makeAccess());
    const result = await engine.execute({});
    expect(result.type).toBe('error');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns an error without hitting the network when consent is not granted', async () => {
    const engine = new CryptoEngine(makeAccess(false));
    const result = await engine.execute({symbol: 'BTC'});
    expect(result.type).toBe('error');
    if (result.type === 'error') {
      expect(result.errorMessage).toMatch(/internet access/i);
    }
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('resolves the symbol then fetches price + 24h change, defaulting to usd', async () => {
    (global.fetch as jest.Mock)
      .mockReturnValueOnce(okJson(searchBody))
      .mockReturnValueOnce(okJson(priceBody));

    const engine = new CryptoEngine(makeAccess());
    const result = await engine.execute({symbol: 'BTC'});

    expect(result.type).toBe('text');
    if (result.type === 'text') {
      expect(result.summary).toBe(
        'Bitcoin (BTC): 65000.42 USD (+1.23% in 24h)',
      );
    }
    const [searchUrl] = (global.fetch as jest.Mock).mock.calls[0];
    expect(searchUrl).toContain('api.coingecko.com/api/v3/search');
    const [priceUrl] = (global.fetch as jest.Mock).mock.calls[1];
    expect(priceUrl).toContain('ids=bitcoin');
    expect(priceUrl).toContain('vs_currencies=usd');
  });

  it('respects an explicit vs_currency argument', async () => {
    (global.fetch as jest.Mock)
      .mockReturnValueOnce(okJson(searchBody))
      .mockReturnValueOnce(okJson({bitcoin: {eur: 60000}}));

    const engine = new CryptoEngine(makeAccess());
    const result = await engine.execute({symbol: 'BTC', vs_currency: 'EUR'});

    expect(result.type).toBe('text');
    if (result.type === 'text') {
      expect(result.summary).toBe('Bitcoin (BTC): 60000 EUR');
    }
    const [priceUrl] = (global.fetch as jest.Mock).mock.calls[1];
    expect(priceUrl).toContain('vs_currencies=eur');
  });

  it('returns an error when the symbol cannot be resolved', async () => {
    (global.fetch as jest.Mock).mockReturnValueOnce(okJson({coins: []}));
    const engine = new CryptoEngine(makeAccess());
    const result = await engine.execute({symbol: 'notarealcoin'});
    expect(result.type).toBe('error');
    if (result.type === 'error') {
      expect(result.summary).toContain('notarealcoin');
    }
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('returns an error when no price is available in the requested currency', async () => {
    (global.fetch as jest.Mock)
      .mockReturnValueOnce(okJson(searchBody))
      .mockReturnValueOnce(okJson({bitcoin: {}}));
    const engine = new CryptoEngine(makeAccess());
    const result = await engine.execute({symbol: 'BTC'});
    expect(result.type).toBe('error');
  });

  it('returns an error rather than throwing on a network failure', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('network down'));
    const engine = new CryptoEngine(makeAccess());
    const result = await engine.execute({symbol: 'BTC'});
    expect(result.type).toBe('error');
    if (result.type === 'error') {
      expect(result.errorMessage).toContain('network down');
    }
  });
});
