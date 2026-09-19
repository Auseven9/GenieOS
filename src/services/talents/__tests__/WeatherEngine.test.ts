import {WeatherEngine} from '../WeatherEngine';
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

const geocodeBody = {
  results: [
    {
      name: 'Austin',
      latitude: 30.27,
      longitude: -97.74,
      admin1: 'Texas',
      country: 'United States',
    },
  ],
};

const forecastBody = {
  current: {
    temperature_2m: 22.5,
    apparent_temperature: 21.0,
    relative_humidity_2m: 40,
    wind_speed_10m: 12.3,
    weather_code: 1,
    time: '2026-01-01T12:00',
  },
  current_units: {temperature_2m: '°C', wind_speed_10m: 'km/h'},
};

describe('WeatherEngine', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  it('exposes the get_weather schema with a required location param', () => {
    const def = new WeatherEngine(makeAccess()).toToolDefinition();
    expect(def.function.name).toBe('get_weather');
    expect(def.function.parameters.required).toEqual(['location']);
  });

  it('returns an error without hitting the network when location is missing', async () => {
    const engine = new WeatherEngine(makeAccess());
    const result = await engine.execute({});
    expect(result.type).toBe('error');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns an error without hitting the network when consent is not granted', async () => {
    const engine = new WeatherEngine(makeAccess(false));
    const result = await engine.execute({location: 'Austin'});
    expect(result.type).toBe('error');
    if (result.type === 'error') {
      expect(result.errorMessage).toMatch(/internet access/i);
    }
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('geocodes then fetches current conditions, returning a text summary', async () => {
    (global.fetch as jest.Mock)
      .mockReturnValueOnce(okJson(geocodeBody))
      .mockReturnValueOnce(okJson(forecastBody));

    const engine = new WeatherEngine(makeAccess());
    const result = await engine.execute({location: 'Austin, TX'});

    expect(result.type).toBe('text');
    if (result.type === 'text') {
      expect(result.summary).toContain('Austin, Texas, United States');
      expect(result.summary).toContain('mainly clear');
      expect(result.summary).toContain('22.5°C');
      expect(result.summary).toContain('40% humidity');
    }
    expect(global.fetch).toHaveBeenCalledTimes(2);
    const [geocodeUrl] = (global.fetch as jest.Mock).mock.calls[0];
    expect(geocodeUrl).toContain('geocoding-api.open-meteo.com');
    const [forecastUrl] = (global.fetch as jest.Mock).mock.calls[1];
    expect(forecastUrl).toContain('api.open-meteo.com');
    expect(forecastUrl).toContain('latitude=30.27');
  });

  it('returns an error when the location cannot be geocoded', async () => {
    (global.fetch as jest.Mock).mockReturnValueOnce(okJson({results: []}));
    const engine = new WeatherEngine(makeAccess());
    const result = await engine.execute({location: 'Nowhereville'});
    expect(result.type).toBe('error');
    if (result.type === 'error') {
      expect(result.summary).toContain('Nowhereville');
    }
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('returns an error rather than throwing on a network failure', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('network down'));
    const engine = new WeatherEngine(makeAccess());
    const result = await engine.execute({location: 'Austin'});
    expect(result.type).toBe('error');
    if (result.type === 'error') {
      expect(result.errorMessage).toContain('network down');
    }
  });

  it('falls back to a generic label for an unrecognized weather code', async () => {
    (global.fetch as jest.Mock)
      .mockReturnValueOnce(okJson(geocodeBody))
      .mockReturnValueOnce(
        okJson({
          ...forecastBody,
          current: {...forecastBody.current, weather_code: 12345},
        }),
      );
    const engine = new WeatherEngine(makeAccess());
    const result = await engine.execute({location: 'Austin'});
    expect(result.type).toBe('text');
    if (result.type === 'text') {
      expect(result.summary).toContain('conditions code 12345');
    }
  });
});
