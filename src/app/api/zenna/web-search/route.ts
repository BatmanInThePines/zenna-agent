import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { SupabaseIdentityStore } from '@/core/providers/identity/supabase-identity';

/**
 * Web Search API Endpoint - UNRESTRICTED
 *
 * Uses Google Programmable Search Engine for ALL queries.
 * Zenna can search the internet freely to find answers.
 * No hardcoded API restrictions - let the search engine discover results.
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

interface SearchResult {
  success: boolean;
  data?: string;
  source?: string;
  error?: string;
  personalized?: boolean;
}

export async function POST(request: NextRequest) {
  try {
    const { query, type } = await request.json();

    if (!query || typeof query !== 'string') {
      return NextResponse.json({ error: 'Query required' }, { status: 400 });
    }

    // Get user preferences for personalized search
    let searchPreferences: SearchPreferences = {
      incognitoMode: false, // Default to personalized
      language: 'en',
      countryCode: 'AU', // Default to Australia for this user
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
            incognitoMode: prefs?.incognitoMode ?? false,
            language: prefs?.language || 'en',
            countryCode: prefs?.countryCode || location?.country || 'AU',
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

    // Enhance query based on type for better search results
    let searchQuery = query;
    if (type === 'weather') {
      searchQuery = `current weather ${query}`;
    } else if (type === 'time') {
      searchQuery = `current time ${query}`;
    } else if (type === 'news') {
      searchQuery = `latest news ${query}`;
    }

    // Add user location context if available and relevant
    if (searchPreferences.userLocation?.city && !searchPreferences.incognitoMode) {
      const locationTerms = ['here', 'my location', 'local', 'nearby', 'my area', 'where i am'];
      if (locationTerms.some(term => query.toLowerCase().includes(term))) {
        const locationStr = [
          searchPreferences.userLocation.city,
          searchPreferences.userLocation.region,
          searchPreferences.userLocation.country
        ].filter(Boolean).join(', ');
        searchQuery = searchQuery.replace(/here|my location|local|nearby|my area|where i am/gi, locationStr);
      }
    }

    console.log('[WebSearch] Searching:', { originalQuery: query, enhancedQuery: searchQuery, type });

    // Use Google PSE for ALL searches - no restrictions
    const result = await performGoogleSearch(searchQuery, searchPreferences);

    return NextResponse.json(result);
  } catch (error) {
    console.error('[WebSearch] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch information', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

/**
 * Perform a Google search using Programmable Search Engine
 * This is the ONLY search method - no fallbacks to specific APIs
 * Zenna searches freely and discovers the answer from results
 */
async function performGoogleSearch(query: string, prefs: SearchPreferences): Promise<SearchResult> {
  const googleApiKey = process.env.GOOGLE_SEARCH_API_KEY;
  const googleCseId = process.env.GOOGLE_SEARCH_ENGINE_ID;

  console.log('[WebSearch] Google PSE search:', {
    hasApiKey: !!googleApiKey,
    hasCseId: !!googleCseId,
    query: query.substring(0, 80),
  });

  if (!googleApiKey || !googleCseId) {
    console.error('[WebSearch] Google PSE not configured!');
    return {
      success: false,
      error: 'Search is not configured. Please set GOOGLE_SEARCH_API_KEY and GOOGLE_SEARCH_ENGINE_ID.',
    };
  }

  try {
    const params = new URLSearchParams({
      key: googleApiKey,
      cx: googleCseId,
      q: query,
      num: '8', // Get more results for better answers
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
    console.log('[WebSearch] Fetching Google PSE...');

    const response = await fetch(url);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[WebSearch] Google PSE error:', response.status, errorText);
      return {
        success: false,
        error: `Search failed: ${response.status}`,
      };
    }

    const data = await response.json();

    if (!data.items || data.items.length === 0) {
      console.log('[WebSearch] No results found');
      return {
        success: false,
        error: `No results found for "${query}"`,
      };
    }

    console.log(`[WebSearch] Found ${data.items.length} results`);

    // Format results with titles, snippets, and URLs for Zenna to analyze
    const results = data.items.slice(0, 5).map((item: { title: string; snippet: string; link: string }, i: number) => {
      return `${i + 1}. **${item.title}**\n   ${item.snippet}\n   Source: ${item.link}`;
    }).join('\n\n');

    return {
      success: true,
      data: `Search results for "${query}":\n\n${results}`,
      source: 'Google Search',
      personalized: !prefs.incognitoMode,
    };
  } catch (error) {
    console.error('[WebSearch] Google search error:', error);
    return {
      success: false,
      error: `Search failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}
