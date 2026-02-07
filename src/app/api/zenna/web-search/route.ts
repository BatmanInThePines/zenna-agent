import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { SupabaseIdentityStore } from '@/core/providers/identity/supabase-identity';

/**
 * Web Search API Endpoint
 *
 * Supports multiple search providers:
 * 1. Google Programmable Search Engine (PSE) - for general queries with user preferences
 * 2. wttr.in - for weather data (free, no API key)
 * 3. Google News RSS - for news (free, no API key)
 * 4. DuckDuckGo - fallback for general queries (free, no API key)
 *
 * User Personalization:
 * - If user has incognitoMode disabled, searches use their location/language preferences
 * - If incognitoMode enabled, searches are anonymous (no personalization)
 */

interface SearchPreferences {
  incognitoMode?: boolean;
  language?: string;
  countryCode?: string;
  safeSearch?: 'off' | 'medium' | 'high';
  useLocationForSearch?: boolean;
  userLocation?: {
    city?: string;
    region?: string;
    country?: string;
  };
}

export async function POST(request: NextRequest) {
  try {
    const { query, type } = await request.json();

    if (!query || typeof query !== 'string') {
      return NextResponse.json({ error: 'Query required' }, { status: 400 });
    }

    // Get user preferences for personalized search
    let searchPreferences: SearchPreferences = {
      incognitoMode: true, // Default to anonymous if not logged in
      language: 'en',
      countryCode: 'US',
      safeSearch: 'medium',
    };

    try {
      const session = await auth();
      if (session?.user?.id) {
        const identityStore = new SupabaseIdentityStore({
          supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
          supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
          jwtSecret: process.env.AUTH_SECRET!,
        });

        const user = await identityStore.getUser(session.user.id);
        if (user?.settings) {
          const prefs = user.settings.searchPreferences;
          const location = user.settings.location;

          searchPreferences = {
            incognitoMode: prefs?.incognitoMode ?? false, // Default to personalized
            language: prefs?.language || 'en',
            countryCode: prefs?.countryCode || location?.country || 'US',
            safeSearch: prefs?.safeSearch || 'medium',
            useLocationForSearch: prefs?.useLocationForSearch ?? true,
            userLocation: location ? {
              city: location.city,
              region: location.region,
              country: location.country,
            } : undefined,
          };
        }
      }
    } catch (authError) {
      console.warn('[WebSearch] Could not get user preferences, using defaults:', authError);
    }

    let result: SearchResult;

    // Route to appropriate search handler based on type
    switch (type) {
      case 'weather':
        result = await fetchWeather(query, searchPreferences);
        break;
      case 'time':
        result = await fetchTime(query);
        break;
      case 'news':
        result = await fetchNews(query, searchPreferences);
        break;
      default:
        result = await fetchGeneral(query, searchPreferences);
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('[WebSearch] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch information', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

interface SearchResult {
  success: boolean;
  data?: string;
  source?: string;
  error?: string;
  personalized?: boolean; // Indicates if results were personalized
}

/**
 * Fetch weather data from wttr.in (free, no API key needed)
 * Uses user's location if available and not in incognito mode
 */
async function fetchWeather(location: string, prefs: SearchPreferences): Promise<SearchResult> {
  try {
    // If user hasn't specified a location and we have their location, use it
    let searchLocation = location;
    if (!prefs.incognitoMode && prefs.useLocationForSearch && prefs.userLocation?.city) {
      // If the query seems to be asking about "here" or "my location", use user's location
      const localTerms = ['here', 'my location', 'local', 'nearby', 'my area'];
      if (localTerms.some(term => location.toLowerCase().includes(term))) {
        searchLocation = [prefs.userLocation.city, prefs.userLocation.region, prefs.userLocation.country]
          .filter(Boolean).join(', ');
      }
    }

    // wttr.in provides weather in a simple format
    const weatherFormat = '%l:+%c+%t,+feels+like+%f.+%C.+Humidity:+%h.+Wind:+%w.+Precipitation:+%p';
    const url = `https://wttr.in/${encodeURIComponent(searchLocation)}?format=${encodeURIComponent(weatherFormat)}`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Zenna-AI-Companion/1.0',
        'Accept-Language': prefs.language || 'en',
      },
    });

    if (!response.ok) {
      throw new Error(`Weather API returned ${response.status}`);
    }

    const weatherText = await response.text();

    // Also fetch forecast
    const forecastUrl = `https://wttr.in/${encodeURIComponent(searchLocation)}?format=%l:+Tomorrow:+%c+%t`;
    const forecastResponse = await fetch(forecastUrl, {
      headers: {
        'User-Agent': 'Zenna-AI-Companion/1.0',
      },
    });

    let forecast = '';
    if (forecastResponse.ok) {
      forecast = await forecastResponse.text();
    }

    return {
      success: true,
      data: `Current weather: ${weatherText.trim()}${forecast ? `\nForecast: ${forecast.trim()}` : ''}`,
      source: 'wttr.in',
      personalized: !prefs.incognitoMode && searchLocation !== location,
    };
  } catch (error) {
    console.error('[WebSearch] Weather fetch error:', error);
    return {
      success: false,
      error: `Could not fetch weather for "${location}": ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

/**
 * Get current time for a location using worldtimeapi.org
 */
async function fetchTime(location: string): Promise<SearchResult> {
  try {
    // Map common location names to timezone identifiers
    const timezoneMap: Record<string, string> = {
      'new york': 'America/New_York',
      'nyc': 'America/New_York',
      'los angeles': 'America/Los_Angeles',
      'la': 'America/Los_Angeles',
      'chicago': 'America/Chicago',
      'london': 'Europe/London',
      'paris': 'Europe/Paris',
      'tokyo': 'Asia/Tokyo',
      'sydney': 'Australia/Sydney',
      'fire island': 'America/New_York',
      'long island': 'America/New_York',
    };

    const normalizedLocation = location.toLowerCase().trim();
    const timezone = timezoneMap[normalizedLocation] || guessTimezone(location);

    const url = `https://worldtimeapi.org/api/timezone/${timezone}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Could not find timezone for "${location}"`);
    }

    const data = await response.json();
    const datetime = new Date(data.datetime);
    const formattedTime = datetime.toLocaleString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    });

    return {
      success: true,
      data: `The current time in ${location} is ${formattedTime}`,
      source: 'worldtimeapi.org',
    };
  } catch {
    // Fallback: just compute based on known UTC offset
    return {
      success: true,
      data: `I can tell you it's currently ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })} Eastern Time. For other locations, please specify the city or timezone.`,
      source: 'system',
    };
  }
}

/**
 * Guess timezone from location string
 */
function guessTimezone(location: string): string {
  const lower = location.toLowerCase();

  // US locations
  if (lower.includes('york') || lower.includes('east') || lower.includes('florida') ||
      lower.includes('georgia') || lower.includes('boston') || lower.includes('miami') ||
      lower.includes('fire island') || lower.includes('long island')) {
    return 'America/New_York';
  }
  if (lower.includes('angeles') || lower.includes('california') || lower.includes('pacific') ||
      lower.includes('seattle') || lower.includes('san francisco')) {
    return 'America/Los_Angeles';
  }
  if (lower.includes('chicago') || lower.includes('central') || lower.includes('texas') ||
      lower.includes('dallas') || lower.includes('houston')) {
    return 'America/Chicago';
  }
  if (lower.includes('denver') || lower.includes('mountain') || lower.includes('arizona')) {
    return 'America/Denver';
  }

  // International
  if (lower.includes('london') || lower.includes('uk') || lower.includes('england')) {
    return 'Europe/London';
  }
  if (lower.includes('paris') || lower.includes('france')) {
    return 'Europe/Paris';
  }
  if (lower.includes('tokyo') || lower.includes('japan')) {
    return 'Asia/Tokyo';
  }
  if (lower.includes('sydney') || lower.includes('australia')) {
    return 'Australia/Sydney';
  }

  // Default to UTC
  return 'UTC';
}

/**
 * Fetch news using Google News RSS
 * Personalizes based on user's language and country preferences
 */
async function fetchNews(query: string, prefs: SearchPreferences): Promise<SearchResult> {
  try {
    // Localize news based on user preferences
    const hl = prefs.language || 'en';
    const gl = prefs.countryCode || 'US';
    const ceid = `${gl}:${hl}`;

    const rssUrl = prefs.incognitoMode
      ? `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`
      : `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=${hl}&gl=${gl}&ceid=${ceid}`;

    const response = await fetch(rssUrl, {
      headers: {
        'User-Agent': 'Zenna-AI-Companion/1.0',
      },
    });

    if (!response.ok) {
      throw new Error('News fetch failed');
    }

    const xmlText = await response.text();

    // Parse RSS XML to extract headlines
    const headlines = extractRssHeadlines(xmlText, 5);

    if (headlines.length === 0) {
      return {
        success: false,
        error: 'No news articles found for this query',
      };
    }

    return {
      success: true,
      data: `Recent news about "${query}":\n${headlines.map((h, i) => `${i + 1}. ${h}`).join('\n')}`,
      source: 'Google News',
      personalized: !prefs.incognitoMode,
    };
  } catch (error) {
    console.error('[WebSearch] News fetch error:', error);
    return {
      success: false,
      error: `Could not fetch news: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

/**
 * Extract headlines from RSS XML
 */
function extractRssHeadlines(xml: string, limit: number): string[] {
  const headlines: string[] = [];
  const titleRegex = /<item>[\s\S]*?<title><!\[CDATA\[(.*?)\]\]><\/title>|<item>[\s\S]*?<title>(.*?)<\/title>/g;

  let match;
  while ((match = titleRegex.exec(xml)) !== null && headlines.length < limit) {
    const title = match[1] || match[2];
    if (title && !title.includes('Google News')) {
      headlines.push(title.trim());
    }
  }

  return headlines;
}

/**
 * General search - uses Google PSE if configured, otherwise DuckDuckGo
 * Google PSE provides better results and supports user personalization
 */
async function fetchGeneral(query: string, prefs: SearchPreferences): Promise<SearchResult> {
  // Try Google Programmable Search Engine first if configured
  const googleApiKey = process.env.GOOGLE_SEARCH_API_KEY;
  const googleCseId = process.env.GOOGLE_SEARCH_ENGINE_ID;

  console.log('[WebSearch] fetchGeneral called:', {
    hasGoogleApiKey: !!googleApiKey,
    hasGoogleCseId: !!googleCseId,
    incognitoMode: prefs.incognitoMode,
    query: query.substring(0, 50),
  });

  // Use Google PSE if API keys are configured
  // Even in incognito mode, we can use it without personalization
  if (googleApiKey && googleCseId) {
    try {
      const result = await fetchGooglePSE(query, prefs, googleApiKey, googleCseId);
      if (result.success) {
        console.log('[WebSearch] Google PSE success');
        return result;
      }
      console.warn('[WebSearch] Google PSE returned no results, trying DuckDuckGo');
    } catch (error) {
      console.warn('[WebSearch] Google PSE failed, falling back to DuckDuckGo:', error);
    }
  } else {
    console.log('[WebSearch] Google PSE not configured, using DuckDuckGo');
  }

  // Fallback to DuckDuckGo (free, no personalization)
  return fetchDuckDuckGo(query);
}

/**
 * Google Programmable Search Engine
 * Provides personalized results based on user preferences
 */
async function fetchGooglePSE(
  query: string,
  prefs: SearchPreferences,
  apiKey: string,
  cseId: string
): Promise<SearchResult> {
  const params = new URLSearchParams({
    key: apiKey,
    cx: cseId,
    q: query,
    num: '5', // Number of results
  });

  // Add personalization parameters
  if (prefs.language) {
    params.set('lr', `lang_${prefs.language}`);
    params.set('hl', prefs.language);
  }
  if (prefs.countryCode) {
    params.set('gl', prefs.countryCode);
  }
  if (prefs.safeSearch) {
    const safeMap: Record<string, string> = {
      'off': 'off',
      'medium': 'medium',
      'high': 'active',
    };
    params.set('safe', safeMap[prefs.safeSearch] || 'medium');
  }

  const url = `https://www.googleapis.com/customsearch/v1?${params.toString()}`;

  const response = await fetch(url);

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[WebSearch] Google PSE error:', errorText);
    throw new Error(`Google Search API error: ${response.status}`);
  }

  const data = await response.json();

  if (!data.items || data.items.length === 0) {
    return {
      success: false,
      error: `No results found for "${query}"`,
    };
  }

  // Format results
  const results = data.items.slice(0, 3).map((item: { title: string; snippet: string; link: string }, i: number) => {
    return `${i + 1}. **${item.title}**\n   ${item.snippet}`;
  }).join('\n\n');

  return {
    success: true,
    data: `Search results for "${query}":\n\n${results}`,
    source: 'Google Search',
    personalized: true,
  };
}

/**
 * DuckDuckGo Instant Answer API
 * Free, no API key, but no personalization
 */
async function fetchDuckDuckGo(query: string): Promise<SearchResult> {
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Zenna-AI-Companion/1.0',
      },
    });

    if (!response.ok) {
      throw new Error('Search failed');
    }

    const data = await response.json();

    // Build response from available data
    let result = '';

    if (data.Abstract) {
      result = data.Abstract;
      if (data.AbstractSource) {
        result += ` (Source: ${data.AbstractSource})`;
      }
    } else if (data.Answer) {
      result = data.Answer;
    } else if (data.Definition) {
      result = `Definition: ${data.Definition}`;
      if (data.DefinitionSource) {
        result += ` (Source: ${data.DefinitionSource})`;
      }
    } else if (data.RelatedTopics && data.RelatedTopics.length > 0) {
      const topics = data.RelatedTopics
        .slice(0, 3)
        .filter((t: { Text?: string }) => t.Text)
        .map((t: { Text: string }) => t.Text);
      if (topics.length > 0) {
        result = `Related information:\n${topics.join('\n')}`;
      }
    }

    if (!result) {
      return {
        success: false,
        error: `No instant answer found for "${query}". I can still provide general knowledge from my training.`,
      };
    }

    return {
      success: true,
      data: result,
      source: 'DuckDuckGo',
      personalized: false,
    };
  } catch (error) {
    console.error('[WebSearch] DuckDuckGo search error:', error);
    return {
      success: false,
      error: `Search failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}
