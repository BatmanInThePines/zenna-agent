/**
 * Notion Service
 *
 * Core service for Notion API operations.
 * Handles search, read, create, and database operations.
 * Uses Notion API v2022-06-28 with user's OAuth access token.
 *
 * Pattern matches hue-manifest-builder.ts for consistency.
 */

const NOTION_API_VERSION = '2022-06-28';
const NOTION_API_BASE = 'https://api.notion.com/v1';

// ============================================
// TYPES
// ============================================

export interface NotionSearchResult {
  id: string;
  type: 'page' | 'database';
  title: string;
  url: string;
  lastEditedTime: string;
  parentType?: string;
}

export interface NotionPageContent {
  title: string;
  content: string;
  url: string;
  lastEditedTime: string;
}

export interface NotionCreateResult {
  id: string;
  url: string;
}

export interface NotionDatabaseSchema {
  id: string;
  title: string;
  properties: Array<{
    name: string;
    type: string;
    options?: string[]; // For select/multi_select
  }>;
}

interface NotionPropertyValue {
  type: string;
  title?: Array<{ plain_text: string }>;
  rich_text?: Array<{ plain_text: string }>;
  select?: { name: string };
  multi_select?: Array<{ name: string }>;
  number?: number;
  checkbox?: boolean;
  date?: { start: string };
  url?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

interface NotionBlock {
  type: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

// Delta Check Types
export interface NotionChangeSet {
  since: string;
  checkedAt: string;
  modifiedPages: NotionModifiedItem[];
  modifiedEntries: NotionModifiedEntry[];
  totalChanges: number;
}

export interface NotionModifiedItem {
  id: string;
  title: string;
  url: string;
  lastEditedTime: string;
  lastEditedBy?: string;
  type: 'page' | 'database';
}

export interface NotionModifiedEntry {
  id: string;
  title: string;
  url: string;
  databaseId: string;
  databaseTitle: string;
  lastEditedTime: string;
  lastEditedBy?: string;
  properties: Record<string, string>;
}

// ============================================
// SERVICE
// ============================================

export class NotionService {
  private token: string;

  constructor(token: string) {
    this.token = token;
  }

  private get headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      'Notion-Version': NOTION_API_VERSION,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Search the user's Notion workspace for pages and databases.
   */
  async search(
    query: string,
    filter?: 'page' | 'database'
  ): Promise<NotionSearchResult[]> {
    const body: Record<string, unknown> = {
      query,
      page_size: 10,
    };

    if (filter) {
      body.filter = { property: 'object', value: filter };
    }

    const response = await fetch(`${NOTION_API_BASE}/search`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw await this.apiError(response, 'Search');
    }

    const data = await response.json();

    return data.results.map((item: Record<string, unknown>) => ({
      id: item.id as string,
      type: item.object as 'page' | 'database',
      title: this.extractTitle(item),
      url: (item.url as string) || buildNotionUrl(item.id as string),
      lastEditedTime: item.last_edited_time as string,
      parentType: (item.parent as Record<string, unknown>)?.type as string,
    }));
  }

  /**
   * Get the full content of a Notion page as readable text.
   */
  async getPageContent(pageId: string): Promise<NotionPageContent> {
    // Fetch page metadata
    const pageResponse = await fetch(`${NOTION_API_BASE}/pages/${pageId}`, {
      headers: this.headers,
    });

    if (!pageResponse.ok) {
      throw await this.apiError(pageResponse, 'Get page');
    }

    const pageData = await pageResponse.json();
    const title = this.extractTitle(pageData);
    const url = pageData.url || buildNotionUrl(pageId);

    // Fetch page blocks (content)
    const content = await this.fetchAllBlocks(pageId);

    return {
      title,
      content,
      url,
      lastEditedTime: pageData.last_edited_time,
    };
  }

  /**
   * Create a new page in the workspace.
   * If no parentId given, searches for a suitable workspace-level page.
   */
  async createPage(options: {
    parentId?: string;
    parentType?: 'page' | 'database';
    title: string;
    content?: string;
    properties?: Record<string, string>;
  }): Promise<NotionCreateResult> {
    // Build parent reference
    let parent: Record<string, string>;
    if (options.parentId) {
      parent = options.parentType === 'database'
        ? { database_id: options.parentId }
        : { page_id: options.parentId };
    } else {
      // Create as a workspace-level page by finding the workspace
      // Notion requires a parent, so we use the first available page as parent
      // or create under workspace if possible
      parent = { page_id: await this.findWorkspaceRoot() };
    }

    // Build properties
    const properties: Record<string, unknown> = {};

    if (options.parentType === 'database' && options.parentId) {
      // For database parents, we need to match the schema
      const schema = await this.getDatabaseSchema(options.parentId);
      const titleProp = schema.properties.find(p => p.type === 'title');
      const titlePropName = titleProp?.name || 'Name';

      properties[titlePropName] = {
        title: [{ text: { content: options.title } }],
      };

      // Map additional properties
      if (options.properties) {
        for (const [key, value] of Object.entries(options.properties)) {
          const schemaProp = schema.properties.find(p => p.name === key);
          if (schemaProp) {
            properties[key] = mapPropertyValue(value, schemaProp.type);
          }
        }
      }
    } else {
      properties.title = {
        title: [{ text: { content: options.title } }],
      };
    }

    // Build request body
    const body: Record<string, unknown> = {
      parent,
      properties,
    };

    // Add content blocks if provided
    if (options.content) {
      body.children = textToNotionBlocks(options.content);
    }

    const response = await fetch(`${NOTION_API_BASE}/pages`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw await this.apiError(response, 'Create page');
    }

    const result = await response.json();

    return {
      id: result.id,
      url: result.url || buildNotionUrl(result.id),
    };
  }

  /**
   * Add an entry to a Notion database.
   */
  async addDatabaseEntry(options: {
    databaseId: string;
    title: string;
    properties?: Record<string, string>;
  }): Promise<NotionCreateResult> {
    // Get the database schema to map properties correctly
    const schema = await this.getDatabaseSchema(options.databaseId);
    const titleProp = schema.properties.find(p => p.type === 'title');
    const titlePropName = titleProp?.name || 'Name';

    const properties: Record<string, unknown> = {
      [titlePropName]: {
        title: [{ text: { content: options.title } }],
      },
    };

    // Map additional properties to their correct Notion types
    if (options.properties) {
      for (const [key, value] of Object.entries(options.properties)) {
        const schemaProp = schema.properties.find(p => p.name === key);
        if (schemaProp) {
          properties[key] = mapPropertyValue(value, schemaProp.type);
        }
      }
    }

    const response = await fetch(`${NOTION_API_BASE}/pages`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        parent: { database_id: options.databaseId },
        properties,
      }),
    });

    if (!response.ok) {
      throw await this.apiError(response, 'Add database entry');
    }

    const result = await response.json();

    return {
      id: result.id,
      url: result.url || buildNotionUrl(result.id),
    };
  }

  /**
   * Get the schema of a Notion database (property names and types).
   */
  async getDatabaseSchema(databaseId: string): Promise<NotionDatabaseSchema> {
    const response = await fetch(`${NOTION_API_BASE}/databases/${databaseId}`, {
      headers: this.headers,
    });

    if (!response.ok) {
      throw await this.apiError(response, 'Get database schema');
    }

    const data = await response.json();

    const properties = Object.entries(data.properties).map(
      ([name, prop]: [string, unknown]) => {
        const typedProp = prop as { type: string; select?: { options: Array<{ name: string }> }; multi_select?: { options: Array<{ name: string }> } };
        const result: { name: string; type: string; options?: string[] } = {
          name,
          type: typedProp.type,
        };

        // Include options for select/multi_select
        if (typedProp.type === 'select' && typedProp.select?.options) {
          result.options = typedProp.select.options.map(o => o.name);
        }
        if (typedProp.type === 'multi_select' && typedProp.multi_select?.options) {
          result.options = typedProp.multi_select.options.map(o => o.name);
        }

        return result;
      }
    );

    return {
      id: databaseId,
      title: this.extractTitle(data),
      properties,
    };
  }

  /**
   * List databases in the workspace.
   */
  async listDatabases(): Promise<Array<{ id: string; title: string; properties: string[] }>> {
    const results = await this.search('', 'database');

    const databases = [];
    for (const db of results.slice(0, 10)) {
      try {
        const schema = await this.getDatabaseSchema(db.id);
        databases.push({
          id: db.id,
          title: db.title,
          properties: schema.properties.map(p => `${p.name} (${p.type})`),
        });
      } catch {
        // Skip databases we can't access
        databases.push({
          id: db.id,
          title: db.title,
          properties: [],
        });
      }
    }

    return databases;
  }

  /**
   * Get all changes in the workspace since a given timestamp.
   * Queries both workspace pages and database entries for modifications.
   * Optionally scoped to a single database.
   */
  async getChangesSince(
    since: string,
    databaseId?: string
  ): Promise<NotionChangeSet> {
    const checkedAt = new Date().toISOString();
    const modifiedPages: NotionModifiedItem[] = [];
    const modifiedEntries: NotionModifiedEntry[] = [];

    // User cache: resolve user IDs to names
    const userCache = new Map<string, string>();

    const resolveUserName = async (userId: string): Promise<string> => {
      if (userCache.has(userId)) return userCache.get(userId)!;
      try {
        const res = await fetch(`${NOTION_API_BASE}/users/${userId}`, {
          headers: this.headers,
        });
        if (res.ok) {
          const userData = await res.json();
          const name = userData.name || 'Unknown';
          userCache.set(userId, name);
          return name;
        }
      } catch {
        // Non-fatal: fall back to ID
      }
      userCache.set(userId, userId);
      return userId;
    };

    if (databaseId) {
      // Scoped: query only the specified database
      const entries = await this.queryDatabaseChangesSince(databaseId, since, resolveUserName);
      modifiedEntries.push(...entries);
    } else {
      // Workspace-wide: check pages and all databases

      // 1. Search for recently modified pages (non-database pages)
      const searchResponse = await fetch(`${NOTION_API_BASE}/search`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({
          filter: { property: 'object', value: 'page' },
          sort: { direction: 'descending', timestamp: 'last_edited_time' },
          page_size: 20,
        }),
      });

      if (searchResponse.ok) {
        const searchData = await searchResponse.json();
        for (const item of searchData.results) {
          const editedTime = item.last_edited_time as string;
          // Only include pages modified after 'since'
          if (editedTime > since) {
            // Skip pages that are database entries (they have parent.type === 'database_id')
            if (item.parent?.type === 'database_id') continue;

            let editedBy: string | undefined;
            if (item.last_edited_by?.id) {
              editedBy = await resolveUserName(item.last_edited_by.id);
            }

            modifiedPages.push({
              id: item.id,
              title: this.extractTitle(item),
              url: item.url || buildNotionUrl(item.id),
              lastEditedTime: editedTime,
              lastEditedBy: editedBy,
              type: 'page',
            });
          } else {
            // Results are sorted descending — once we hit an older one, stop
            break;
          }
        }
      }

      // 2. Find all databases and query each for modified entries
      const dbSearchResponse = await fetch(`${NOTION_API_BASE}/search`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({
          filter: { property: 'object', value: 'database' },
          page_size: 20,
        }),
      });

      if (dbSearchResponse.ok) {
        const dbData = await dbSearchResponse.json();
        for (const db of dbData.results) {
          try {
            const entries = await this.queryDatabaseChangesSince(
              db.id,
              since,
              resolveUserName,
              this.extractTitle(db)
            );
            modifiedEntries.push(...entries);
          } catch {
            // Skip databases we can't query
          }
        }
      }
    }

    return {
      since,
      checkedAt,
      modifiedPages,
      modifiedEntries,
      totalChanges: modifiedPages.length + modifiedEntries.length,
    };
  }

  /**
   * Query a specific database for entries modified since a timestamp.
   */
  async queryDatabase(
    databaseId: string,
    filter?: Record<string, unknown>,
    sorts?: Array<Record<string, unknown>>
  ): Promise<Array<Record<string, unknown>>> {
    const body: Record<string, unknown> = { page_size: 50 };
    if (filter) body.filter = filter;
    if (sorts) body.sorts = sorts;

    const response = await fetch(
      `${NOTION_API_BASE}/databases/${databaseId}/query`,
      {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(body),
      }
    );

    if (!response.ok) {
      throw await this.apiError(response, 'Query database');
    }

    const data = await response.json();
    return data.results;
  }

  /**
   * Query a database for entries modified after a given timestamp.
   * Extracts human-readable property values and editor names.
   */
  private async queryDatabaseChangesSince(
    databaseId: string,
    since: string,
    resolveUserName: (id: string) => Promise<string>,
    dbTitle?: string
  ): Promise<NotionModifiedEntry[]> {
    // Get the database title if not provided
    let resolvedTitle = dbTitle;
    if (!resolvedTitle) {
      try {
        const schema = await this.getDatabaseSchema(databaseId);
        resolvedTitle = schema.title;
      } catch {
        resolvedTitle = 'Unknown Database';
      }
    }

    const results = await this.queryDatabase(
      databaseId,
      {
        timestamp: 'last_edited_time',
        last_edited_time: { after: since },
      },
      [{ timestamp: 'last_edited_time', direction: 'descending' }]
    );

    const entries: NotionModifiedEntry[] = [];

    for (const item of results) {
      const record = item as Record<string, unknown>;
      let editedBy: string | undefined;

      // Resolve last_edited_by
      const lastEditedByObj = record.last_edited_by as { id?: string } | undefined;
      if (lastEditedByObj?.id) {
        editedBy = await resolveUserName(lastEditedByObj.id);
      }

      // Extract readable property values
      const properties: Record<string, string> = {};
      const propsObj = record.properties as Record<string, NotionPropertyValue> | undefined;
      if (propsObj) {
        for (const [name, prop] of Object.entries(propsObj)) {
          const readable = this.readablePropertyValue(prop);
          if (readable) {
            properties[name] = readable;
          }
        }
      }

      entries.push({
        id: record.id as string,
        title: this.extractTitle(record),
        url: (record.url as string) || buildNotionUrl(record.id as string),
        databaseId,
        databaseTitle: resolvedTitle!,
        lastEditedTime: record.last_edited_time as string,
        lastEditedBy: editedBy,
        properties,
      });
    }

    return entries;
  }

  /**
   * Convert a Notion property value to a human-readable string.
   */
  private readablePropertyValue(prop: NotionPropertyValue): string | null {
    switch (prop.type) {
      case 'title':
        return prop.title?.map(t => t.plain_text).join('') || null;
      case 'rich_text':
        return prop.rich_text?.map(t => t.plain_text).join('') || null;
      case 'select':
        return prop.select?.name || null;
      case 'multi_select':
        return prop.multi_select?.map(s => s.name).join(', ') || null;
      case 'number':
        return prop.number !== undefined && prop.number !== null ? String(prop.number) : null;
      case 'checkbox':
        return prop.checkbox !== undefined ? (prop.checkbox ? 'Yes' : 'No') : null;
      case 'date':
        return prop.date?.start || null;
      case 'url':
        return prop.url || null;
      case 'status':
        return prop.status?.name || null;
      case 'people':
        return prop.people?.map((p: { name?: string }) => p.name || 'Unknown').join(', ') || null;
      case 'email':
        return prop.email || null;
      case 'phone_number':
        return prop.phone_number || null;
      case 'formula':
        if (prop.formula?.type === 'string') return prop.formula.string;
        if (prop.formula?.type === 'number') return String(prop.formula.number);
        if (prop.formula?.type === 'boolean') return prop.formula.boolean ? 'Yes' : 'No';
        return null;
      case 'last_edited_time':
        return prop.last_edited_time || null;
      case 'created_time':
        return prop.created_time || null;
      case 'last_edited_by':
        return prop.last_edited_by?.name || null;
      case 'created_by':
        return prop.created_by?.name || null;
      default:
        return null;
    }
  }

  // ============================================
  // PRIVATE HELPERS
  // ============================================

  /**
   * Fetch all blocks from a page, handling pagination.
   */
  private async fetchAllBlocks(blockId: string): Promise<string> {
    const textParts: string[] = [];
    let hasMore = true;
    let startCursor: string | undefined;

    while (hasMore) {
      let url = `${NOTION_API_BASE}/blocks/${blockId}/children?page_size=100`;
      if (startCursor) {
        url += `&start_cursor=${startCursor}`;
      }

      const response = await fetch(url, { headers: this.headers });

      if (!response.ok) {
        break;
      }

      const data = await response.json();
      const blockText = extractTextFromBlocks(data.results);
      if (blockText) {
        textParts.push(blockText);
      }

      hasMore = data.has_more;
      startCursor = data.next_cursor;
    }

    return textParts.join('\n\n');
  }

  /**
   * Find a workspace root page to use as parent for new pages.
   */
  private async findWorkspaceRoot(): Promise<string> {
    // Search for any top-level page
    const response = await fetch(`${NOTION_API_BASE}/search`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        filter: { property: 'object', value: 'page' },
        page_size: 1,
      }),
    });

    if (response.ok) {
      const data = await response.json();
      if (data.results.length > 0) {
        // Use workspace_id from parent if available
        const firstPage = data.results[0];
        if (firstPage.parent?.type === 'workspace') {
          return firstPage.id;
        }
        return firstPage.id;
      }
    }

    throw new Error('NOTION_NO_PAGES: No accessible pages found in workspace. The integration may need additional permissions.');
  }

  /**
   * Extract title from a Notion page or database object.
   */
  private extractTitle(obj: Record<string, unknown>): string {
    // Database title
    if (Array.isArray(obj.title)) {
      const titleArr = obj.title as Array<{ plain_text: string }>;
      return titleArr.map(t => t.plain_text).join('') || 'Untitled';
    }

    // Page properties
    const properties = obj.properties as Record<string, NotionPropertyValue> | undefined;
    if (properties) {
      for (const prop of Object.values(properties)) {
        if (prop.type === 'title' && prop.title?.[0]?.plain_text) {
          return prop.title.map(t => t.plain_text).join('');
        }
      }
    }

    return 'Untitled';
  }

  /**
   * Parse Notion API error responses.
   */
  private async apiError(response: Response, context: string): Promise<Error> {
    const status = response.status;
    const body = await response.text().catch(() => 'unknown');

    if (status === 401) {
      return new Error('NOTION_UNAUTHORIZED: Notion connection has expired. Please reconnect in Settings > Integrations.');
    }
    if (status === 403) {
      return new Error(`NOTION_FORBIDDEN: No permission to ${context.toLowerCase()}. The integration may need additional access.`);
    }
    if (status === 404) {
      return new Error(`NOTION_NOT_FOUND: ${context} target not found. The page or database may have been deleted or moved.`);
    }
    if (status === 429) {
      return new Error('NOTION_RATE_LIMITED: Too many requests to Notion. Please wait a moment and try again.');
    }
    if (status >= 500) {
      return new Error(`NOTION_SERVER_ERROR: Notion is having issues (${status}). Please try again later.`);
    }

    return new Error(`NOTION_API_ERROR: ${context} failed (${status}): ${body}`);
  }

  // ============================================
  // WORKFORCE TOOLS: Sprint & Backlog Operations
  // ============================================

  /**
   * Update properties on an existing Notion page.
   * Used by sprint_update to change task status, assignee, etc.
   */
  async updatePageProperties(
    pageId: string,
    properties: Record<string, string>,
    schema?: NotionDatabaseSchema
  ): Promise<NotionCreateResult> {
    // If no schema provided, we need to get the parent database schema
    // Try to get the page first to find its parent
    let schemaToUse = schema;
    if (!schemaToUse) {
      const pageResponse = await fetch(`${NOTION_API_BASE}/pages/${pageId}`, {
        method: 'GET',
        headers: this.headers,
      });

      if (!pageResponse.ok) {
        throw await this.apiError(pageResponse, 'Get page for schema');
      }

      const pageData = await pageResponse.json();
      if (pageData.parent?.database_id) {
        schemaToUse = await this.getDatabaseSchema(pageData.parent.database_id);
      }
    }

    // Build Notion property objects from string values
    const notionProperties: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(properties)) {
      if (schemaToUse) {
        const schemaProp = schemaToUse.properties.find(p => p.name.toLowerCase() === name.toLowerCase());
        if (schemaProp) {
          notionProperties[schemaProp.name] = mapPropertyValue(value, schemaProp.type);
          continue;
        }
      }
      // Fallback: try as select (most common for status-type fields)
      notionProperties[name] = { select: { name: value } };
    }

    const response = await fetch(`${NOTION_API_BASE}/pages/${pageId}`, {
      method: 'PATCH',
      headers: this.headers,
      body: JSON.stringify({ properties: notionProperties }),
    });

    if (!response.ok) {
      throw await this.apiError(response, 'Update page properties');
    }

    const result = await response.json();
    return {
      id: result.id,
      url: result.url,
    };
  }

  /**
   * Append content blocks to an existing Notion page.
   * Used by sprint_update to add progress notes.
   */
  async appendToPage(pageId: string, content: string): Promise<void> {
    const blocks = textToNotionBlocks(content);

    const response = await fetch(`${NOTION_API_BASE}/blocks/${pageId}/children`, {
      method: 'PATCH',
      headers: this.headers,
      body: JSON.stringify({ children: blocks }),
    });

    if (!response.ok) {
      throw await this.apiError(response, 'Append to page');
    }
  }

  /**
   * Query a Notion database with optional filters.
   * Used by sprint_read to fetch tasks by status/assignee.
   */
  async queryDatabaseFiltered(
    databaseId: string,
    filters?: {
      status?: string;
      assignee?: string;
    }
  ): Promise<Array<{
    id: string;
    title: string;
    url: string;
    properties: Record<string, string>;
  }>> {
    // Build Notion filter
    const filterConditions: Array<Record<string, unknown>> = [];

    // We need the schema to find the right property names
    const schema = await this.getDatabaseSchema(databaseId);

    if (filters?.status) {
      // Find a status/select property
      const statusProp = schema.properties.find(p =>
        p.name.toLowerCase().includes('status') && (p.type === 'select' || p.type === 'status')
      );
      if (statusProp) {
        filterConditions.push({
          property: statusProp.name,
          [statusProp.type]: { equals: filters.status },
        });
      }
    }

    if (filters?.assignee) {
      // Find a person/text property for assignee
      const assigneeProp = schema.properties.find(p =>
        (p.name.toLowerCase().includes('assign') || p.name.toLowerCase().includes('owner')) &&
        (p.type === 'people' || p.type === 'rich_text' || p.type === 'select')
      );
      if (assigneeProp && assigneeProp.type === 'rich_text') {
        filterConditions.push({
          property: assigneeProp.name,
          rich_text: { contains: filters.assignee },
        });
      } else if (assigneeProp && assigneeProp.type === 'select') {
        filterConditions.push({
          property: assigneeProp.name,
          select: { equals: filters.assignee },
        });
      }
    }

    const body: Record<string, unknown> = { page_size: 50 };
    if (filterConditions.length === 1) {
      body.filter = filterConditions[0];
    } else if (filterConditions.length > 1) {
      body.filter = { and: filterConditions };
    }

    const response = await fetch(`${NOTION_API_BASE}/databases/${databaseId}/query`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw await this.apiError(response, 'Query database');
    }

    const data = await response.json();
    const entries: Array<{ id: string; title: string; url: string; properties: Record<string, string> }> = [];

    for (const page of data.results || []) {
      const props: Record<string, string> = {};
      let title = 'Untitled';

      for (const [name, value] of Object.entries(page.properties || {})) {
        const readable = this.readablePropertyValue(value as NotionPropertyValue);
        if (readable) props[name] = readable;

        // Extract title
        const propValue = value as NotionPropertyValue;
        if (propValue.type === 'title' && propValue.title?.length) {
          title = propValue.title.map((t: { plain_text: string }) => t.plain_text).join('');
        }
      }

      entries.push({
        id: page.id,
        title,
        url: page.url,
        properties: props,
      });
    }

    return entries;
  }
}

// ============================================
// STANDALONE HELPERS
// ============================================

/**
 * Build a Notion URL from a page or database ID.
 */
export function buildNotionUrl(id: string): string {
  const cleanId = id.replace(/-/g, '');
  return `https://notion.so/${cleanId}`;
}

/**
 * Convert markdown-like text to Notion block objects.
 * Supports: headings (# ## ###), bullets (- *), paragraphs.
 */
export function textToNotionBlocks(text: string): Record<string, unknown>[] {
  const lines = text.split('\n');
  const blocks: Record<string, unknown>[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Heading 1
    if (trimmed.startsWith('# ')) {
      blocks.push({
        object: 'block',
        type: 'heading_1',
        heading_1: {
          rich_text: [{ type: 'text', text: { content: trimmed.slice(2) } }],
        },
      });
    }
    // Heading 2
    else if (trimmed.startsWith('## ')) {
      blocks.push({
        object: 'block',
        type: 'heading_2',
        heading_2: {
          rich_text: [{ type: 'text', text: { content: trimmed.slice(3) } }],
        },
      });
    }
    // Heading 3
    else if (trimmed.startsWith('### ')) {
      blocks.push({
        object: 'block',
        type: 'heading_3',
        heading_3: {
          rich_text: [{ type: 'text', text: { content: trimmed.slice(4) } }],
        },
      });
    }
    // Bullet list item
    else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      blocks.push({
        object: 'block',
        type: 'bulleted_list_item',
        bulleted_list_item: {
          rich_text: [{ type: 'text', text: { content: trimmed.slice(2) } }],
        },
      });
    }
    // Numbered list item
    else if (/^\d+\.\s/.test(trimmed)) {
      blocks.push({
        object: 'block',
        type: 'numbered_list_item',
        numbered_list_item: {
          rich_text: [{ type: 'text', text: { content: trimmed.replace(/^\d+\.\s/, '') } }],
        },
      });
    }
    // To-do item
    else if (trimmed.startsWith('[ ] ') || trimmed.startsWith('[x] ')) {
      const checked = trimmed.startsWith('[x] ');
      blocks.push({
        object: 'block',
        type: 'to_do',
        to_do: {
          rich_text: [{ type: 'text', text: { content: trimmed.slice(4) } }],
          checked,
        },
      });
    }
    // Divider
    else if (trimmed === '---' || trimmed === '***') {
      blocks.push({
        object: 'block',
        type: 'divider',
        divider: {},
      });
    }
    // Paragraph (default)
    else {
      blocks.push({
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [{ type: 'text', text: { content: trimmed } }],
        },
      });
    }
  }

  return blocks;
}

/**
 * Map a simple string value to the correct Notion property object.
 */
export function mapPropertyValue(
  value: string,
  propertyType: string
): Record<string, unknown> {
  switch (propertyType) {
    case 'title':
      return { title: [{ text: { content: value } }] };

    case 'rich_text':
      return { rich_text: [{ text: { content: value } }] };

    case 'number': {
      const num = parseFloat(value);
      return { number: isNaN(num) ? null : num };
    }

    case 'select':
      return { select: { name: value } };

    case 'multi_select': {
      const items = value.split(',').map(s => s.trim()).filter(Boolean);
      return { multi_select: items.map(name => ({ name })) };
    }

    case 'checkbox':
      return { checkbox: value.toLowerCase() === 'true' || value.toLowerCase() === 'yes' };

    case 'date':
      return { date: { start: value } };

    case 'url':
      return { url: value };

    case 'email':
      return { email: value };

    case 'phone_number':
      return { phone_number: value };

    case 'status':
      return { status: { name: value } };

    default:
      // Fallback: treat as rich_text
      return { rich_text: [{ text: { content: value } }] };
  }
}

/**
 * Extract text content from Notion block objects.
 * Reused from ingest/route.ts pattern but enhanced with more block types.
 */
export function extractTextFromBlocks(blocks: NotionBlock[]): string {
  const textParts: string[] = [];

  for (const block of blocks) {
    const blockType = block.type;
    const blockData = block[blockType];

    if (!blockData || typeof blockData !== 'object') continue;

    // Extract rich_text from common block types
    if ('rich_text' in blockData) {
      const richText = blockData.rich_text as Array<{ plain_text: string }>;
      if (richText) {
        const text = richText.map(t => t.plain_text).join('');
        if (text.trim()) {
          // Add formatting prefix based on block type
          switch (blockType) {
            case 'heading_1':
              textParts.push(`# ${text}`);
              break;
            case 'heading_2':
              textParts.push(`## ${text}`);
              break;
            case 'heading_3':
              textParts.push(`### ${text}`);
              break;
            case 'bulleted_list_item':
              textParts.push(`- ${text}`);
              break;
            case 'numbered_list_item':
              textParts.push(`• ${text}`);
              break;
            case 'to_do': {
              const checked = blockData.checked ? 'x' : ' ';
              textParts.push(`[${checked}] ${text}`);
              break;
            }
            default:
              textParts.push(text);
          }
        }
      }
    }

    // Handle divider blocks
    if (blockType === 'divider') {
      textParts.push('---');
    }
  }

  return textParts.join('\n');
}
