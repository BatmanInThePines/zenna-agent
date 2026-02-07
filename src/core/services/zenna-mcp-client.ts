/**
 * Zenna-MCP Client Service
 *
 * Connects to the Zenna-MCP Gateway server for centralized internet intelligence.
 * Uses HTTP/REST for simplicity (MCP SSE for future enhancement).
 *
 * ADR-001: All external internet services are accessed via Zenna-MCP Gateway.
 */

// Zenna-MCP Gateway configuration
const ZENNA_MCP_URL = process.env.ZENNA_MCP_URL || 'http://localhost:3000';
const ZENNA_MCP_SECRET = process.env.ZENNA_MCP_SECRET || '';

export interface SearchOptions {
  query: string;
  includeDomains?: string[];
  searchDepth?: 'basic' | 'advanced';
  searchType?: 'weather' | 'news' | 'time' | 'general';
}

export interface SearchResult {
  success: boolean;
  content: string;
  error?: string;
}

/**
 * Search the internet via Zenna-MCP Gateway (Tavily-powered)
 */
export async function mcpSearch(options: SearchOptions): Promise<SearchResult> {
  const { query, includeDomains, searchDepth = 'basic', searchType } = options;

  // Enhance query based on type
  let enhancedQuery = query;
  if (searchType === 'weather') {
    enhancedQuery = `current weather ${query}`;
  } else if (searchType === 'time') {
    enhancedQuery = `current time ${query}`;
  } else if (searchType === 'news') {
    enhancedQuery = `latest news ${query}`;
  }

  console.log(`[MCP Client] Searching via Zenna-MCP: "${enhancedQuery.substring(0, 50)}..."`);

  try {
    const response = await fetch(`${ZENNA_MCP_URL}/api/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Zenna-Agent-Auth': ZENNA_MCP_SECRET,
      },
      body: JSON.stringify({
        query: enhancedQuery,
        include_domains: includeDomains,
        search_depth: searchDepth,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[MCP Client] Gateway error: ${response.status}`, errorText);

      if (response.status === 401 || response.status === 403) {
        return {
          success: false,
          content: '',
          error: 'MCP Gateway authentication failed. Check ZENNA_MCP_SECRET.',
        };
      }

      return {
        success: false,
        content: '',
        error: `MCP Gateway error: ${response.status}`,
      };
    }

    const data = await response.json();

    return {
      success: true,
      content: data.result || data.content || JSON.stringify(data),
    };
  } catch (error) {
    console.error('[MCP Client] Network error:', error);

    // Fallback: Check if gateway is unreachable
    if (error instanceof TypeError && error.message.includes('fetch')) {
      return {
        success: false,
        content: '',
        error: 'Zenna-MCP Gateway is unreachable. Is it running?',
      };
    }

    return {
      success: false,
      content: '',
      error: error instanceof Error ? error.message : 'Unknown MCP client error',
    };
  }
}

/**
 * Check if the Zenna-MCP Gateway is healthy
 */
export async function mcpHealthCheck(): Promise<boolean> {
  try {
    const response = await fetch(`${ZENNA_MCP_URL}/health`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (response.ok) {
      const data = await response.json();
      return data.status === 'ok';
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Get MCP Gateway configuration status (for debugging)
 */
export function getMcpConfig() {
  return {
    url: ZENNA_MCP_URL,
    secretConfigured: !!ZENNA_MCP_SECRET,
    isLocalhost: ZENNA_MCP_URL.includes('localhost'),
  };
}
