import {TalentEngine, TalentResult, ToolDefinition} from './types';
import type {KeylessApiAccess} from './keylessApiAccess';
import {fetchJson} from '../search/providers/http';

interface GeocodingResult {
  name: string;
  latitude: number;
  longitude: number;
  country?: string;
  admin1?: string;
}

interface GeocodingResponse {
  results?: GeocodingResult[];
}

interface CurrentConditions {
  temperature_2m?: number;
  apparent_temperature?: number;
  relative_humidity_2m?: number;
  wind_speed_10m?: number;
  weather_code?: number;
  time?: string;
}

interface ForecastResponse {
  current?: CurrentConditions;
  current_units?: {
    temperature_2m?: string;
    wind_speed_10m?: string;
  };
}

// WMO weather interpretation codes (open-meteo.com/en/docs), condensed to a
// one-line description each — enough for a spoken-style summary, not the
// full icon/severity taxonomy a dedicated weather app would need.
const WEATHER_CODE_DESCRIPTIONS: Record<number, string> = {
  0: 'clear sky',
  1: 'mainly clear',
  2: 'partly cloudy',
  3: 'overcast',
  45: 'fog',
  48: 'depositing rime fog',
  51: 'light drizzle',
  53: 'moderate drizzle',
  55: 'dense drizzle',
  61: 'slight rain',
  63: 'moderate rain',
  65: 'heavy rain',
  66: 'light freezing rain',
  67: 'heavy freezing rain',
  71: 'slight snow fall',
  73: 'moderate snow fall',
  75: 'heavy snow fall',
  77: 'snow grains',
  80: 'slight rain showers',
  81: 'moderate rain showers',
  82: 'violent rain showers',
  85: 'slight snow showers',
  86: 'heavy snow showers',
  95: 'thunderstorm',
  96: 'thunderstorm with slight hail',
  99: 'thunderstorm with heavy hail',
};

function describeWeatherCode(code: number | undefined): string {
  if (code === undefined) {
    return 'unknown conditions';
  }
  return WEATHER_CODE_DESCRIPTIONS[code] ?? `conditions code ${code}`;
}

/**
 * `get_weather` talent — keyless, via Open-Meteo's geocoding + forecast
 * APIs, so a common weather question never spends a web_search call
 * against a rate-limited/paid provider (see the "Specialized Tool
 * Mapping" idea this implements).
 */
export class WeatherEngine implements TalentEngine {
  readonly name = 'get_weather';

  constructor(private access: KeylessApiAccess) {}

  async execute(args: Record<string, any>): Promise<TalentResult> {
    const location =
      typeof args.location === 'string' ? args.location.trim() : '';
    if (!location) {
      return {
        type: 'error',
        summary: 'get_weather: missing or empty "location" argument',
        errorMessage:
          'location argument is required and must be a non-empty string',
      };
    }

    if (!this.access.isEnabled()) {
      const summary = 'get_weather: internet access not enabled';
      return {
        type: 'error',
        summary,
        errorMessage:
          'Internet access for tools is not enabled. Accept the disclosure in Settings → Internet Search.',
      };
    }

    try {
      const geo = await fetchJson<GeocodingResponse>(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
          location,
        )}&count=1&language=en&format=json`,
        {method: 'GET', headers: {Accept: 'application/json'}},
      );
      const place = geo.results?.[0];
      if (!place) {
        const summary = `get_weather: could not find a location matching "${location}"`;
        return {type: 'error', summary, errorMessage: summary};
      }

      const forecast = await fetchJson<ForecastResponse>(
        `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}` +
          '&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code&timezone=auto',
        {method: 'GET', headers: {Accept: 'application/json'}},
      );
      const current = forecast.current;
      if (!current) {
        const summary = `get_weather: no current-conditions data for "${location}"`;
        return {type: 'error', summary, errorMessage: summary};
      }

      const placeLabel = [place.name, place.admin1, place.country]
        .filter(Boolean)
        .join(', ');
      const tempUnit = forecast.current_units?.temperature_2m ?? '°C';
      const windUnit = forecast.current_units?.wind_speed_10m ?? 'km/h';
      const conditions = describeWeatherCode(current.weather_code);

      const summary =
        `Current weather in ${placeLabel}: ${conditions}, ` +
        `${current.temperature_2m}${tempUnit} (feels like ${current.apparent_temperature}${tempUnit}), ` +
        `${current.relative_humidity_2m}% humidity, wind ${current.wind_speed_10m} ${windUnit}. ` +
        `(as of ${current.time})`;

      return {type: 'text', summary};
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      return {
        type: 'error',
        summary: `get_weather: ${errMsg}`,
        errorMessage: errMsg,
      };
    }
  }

  toToolDefinition(): ToolDefinition {
    return {
      type: 'function',
      function: {
        name: 'get_weather',
        description:
          'Get current weather conditions for a location — temperature, conditions, humidity, and wind. Prefer this over web_search for weather questions; it is faster and does not use search quota.',
        parameters: {
          type: 'object',
          properties: {
            location: {
              type: 'string',
              description: "City or place name, e.g. 'Austin, TX' or 'Tokyo'.",
            },
          },
          required: ['location'],
        },
      },
    };
  }
}
