import { NextRequest, NextResponse } from 'next/server';

/**
 * Web Search API Endpoint
 *
 * Uses DuckDuckGo's instant answer API for real-time information.
 * This is a free, no-API-key-required search solution.
 *
 * For weather, we use wttr.in which provides free weather data.
 */
export async function POST(request: NextRequest) {
  try {
    const { query, type } = await request.json();

    if (!query || typeof query !== 'string') {
      return NextResponse.json({ error: 'Query required' }, { status: 400 });
    }

    let result: SearchResult;

    // Route to appropriate search handler based on type
    switch (type) {
      case 'weather':
        result = await fetchWeather(query);
        break;
      case 'time':
        result = await fetchTime(query);
        break;
      case 'news':
        result = await fetchNews(query);
        break;
      default:
        result = await fetchGeneral(query);
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
}

/**
 * Fetch weather data from wttr.in (free, no API key needed)
 */
async function fetchWeather(location: string): Promise<SearchResult> {
  try {
    // wttr.in provides weather in a simple format
    // Format: ?format=... for custom output
    const weatherFormat = '%l:+%c+%t,+feels+like+%f.+%C.+Humidity:+%h.+Wind:+%w.+Precipitation:+%p';
    const url = `https://wttr.in/${encodeURIComponent(location)}?format=${encodeURIComponent(weatherFormat)}`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Zenna-AI-Companion/1.0',
      },
    });

    if (!response.ok) {
      throw new Error(`Weather API returned ${response.status}`);
    }

    const weatherText = await response.text();

    // Also fetch forecast
    const forecastUrl = `https://wttr.in/${encodeURIComponent(location)}?format=%l:+Tomorrow:+%c+%t`;
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
      // Try to get the list of timezones and find a match
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
  } catch (error) {
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
 * Fetch news using DuckDuckGo or RSS feeds
 */
async function fetchNews(query: string): Promise<SearchResult> {
  try {
    // Use Google News RSS feed (free, no API key)
    const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;

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
 * General search using DuckDuckGo instant answers
 */
async function fetchGeneral(query: string): Promise<SearchResult> {
  try {
    // DuckDuckGo Instant Answer API (free, no key needed)
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
      // Get the first few related topics
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
    };
  } catch (error) {
    console.error('[WebSearch] General search error:', error);
    return {
      success: false,
      error: `Search failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}
