# V3 Tool Orchestration Architecture

> **Document Purpose**: This document captures the fundamental flaw in V2's tool orchestration and defines the V3 solution using Zenna-MCP as a universal tool gateway.
>
> **Created**: February 9, 2026
> **Status**: Planning / V3 Roadmap

---

## 1. V2 Tool Orchestration Flaw (Lessons Learned)

### The Problem

V2 has a **fundamental architectural flaw** in how Claude interacts with tools. When given multiple tools, Claude autonomously decides to call several of them "to be helpful" — even when only one tool is needed.

### Real Failure Example

**User Request:** "Set lights to 20%"

**Expected Behavior:**
1. Claude calls `control_lights` tool with `{ target: "all", brightness: 20 }`
2. Lights change
3. Claude confirms: "Done, I've set your lights to 20%"
4. **Total time: ~2 seconds**

**Actual V2 Behavior:**
1. Claude calls `web_search` (4 seconds wasted — searching for... nothing relevant)
2. Claude calls `control_lights` (1 second — lights actually change!)
3. Claude calls `notion_search` (hangs for 60 seconds trying to find... light-related pages?)
4. Request times out
5. User never gets confirmation despite lights working
6. **Total time: 60+ seconds, no response delivered**

### Why This Happens

Claude sees ALL available tools in the `tools` array:
```
[web_search, control_lights, notion_search, notion_get_page, notion_create_page, ...]
```

Claude's reasoning (paraphrased):
> "The user wants to control lights. Let me search the web for context about their lighting setup, then control the lights, then check their Notion for any lighting preferences or schedules they've documented..."

This is Claude being "helpful" — but it's catastrophic for user experience.

### Why V2 Fixes Didn't Work

We tried several approaches in V2:

| Approach | Result |
|----------|--------|
| **Conditional tool loading** (only include Notion when user mentions it) | Helped but didn't prevent web_search from being called unnecessarily |
| **Tool descriptions** ("ONLY use this for light requests") | Claude ignores these when it decides multiple tools are "helpful" |
| **Prompt engineering** | Unreliable — Claude's autonomous reasoning overrides instructions |
| **Timeouts on each tool** | Prevents infinite hangs but doesn't prevent wasted time on unnecessary calls |

**Conclusion:** The problem is architectural. You cannot reliably control which tools Claude uses by giving it all tools and asking nicely.

---

## 2. V3 Solution: Zenna-MCP as Universal Tool Gateway

### Core Principle

**Claude should see ONE tool: the Zenna-MCP Gateway.**

The gateway handles:
1. Intent classification
2. Domain routing
3. Tool scoping
4. Execution

Claude never directly sees Notion tools, Hue tools, or web search. It only knows how to ask the gateway.

### Architecture Comparison

```
V2 (BROKEN):
┌─────────────────────────────────────────────────────────────────────┐
│  Claude receives tools array:                                        │
│  [web_search, control_lights, notion_search, notion_get_page,        │
│   notion_create_page, notion_add_entry, ecosystem_scan, ...]         │
│                                                                      │
│  Claude thinks: "Let me use several of these to be thorough!"        │
│  → Multiple unnecessary API calls                                    │
│  → Timeouts from slow tools                                          │
│  → User never gets response                                          │
└─────────────────────────────────────────────────────────────────────┘

V3 (PROPOSED):
┌─────────────────────────────────────────────────────────────────────┐
│  Claude receives ONE tool:                                           │
│  [zenna_mcp_execute]                                                 │
│                                                                      │
│  Claude calls: zenna_mcp_execute({ intent: "control lights 20%" })   │
│  Gateway classifies: domain = "smart_home"                           │
│  Gateway returns: scoped tool "control_lights" with params           │
│  Gateway executes: control_lights({ target: "all", brightness: 20 }) │
│  Gateway returns: "Lights set to 20%"                                │
│  Claude responds: "Done!"                                            │
│                                                                      │
│  → ONE tool call                                                     │
│  → No timeouts                                                       │
│  → Fast response                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Request Flow

```
User message
    │
    ▼
┌─────────────────────┐
│  Intent Classifier  │  ← Lightweight model or rules-based
│  (domain detection) │
└─────────────────────┘
    │
    ▼ Domain: "smart_home"
┌─────────────────────┐
│  Zenna-MCP Gateway  │
│  Tool Registry      │
└─────────────────────┘
    │
    ▼ Available: [control_lights]
┌─────────────────────┐
│  Scoped Execution   │  ← ONLY smart_home tools available
│  control_lights()   │
└─────────────────────┘
    │
    ▼ Result: "Lights set to 20%"
┌─────────────────────┐
│  Claude Response    │
│  "Done!"            │
└─────────────────────┘
```

---

## 3. Domain Categories

The gateway organizes all tools into domains. Only tools from the detected domain are made available for a given request.

| Domain | Tools | Trigger Patterns |
|--------|-------|------------------|
| `smart_home` | control_lights, thermostat, security, scenes | "lights", "temperature", "lock", "turn on/off" |
| `productivity` | notion_*, calendar_*, email_* | "notion", "calendar", "email", "schedule", "meeting" |
| `information` | web_search, news, weather, time | "weather", "news", "what time", "search for" |
| `memory` | recall, store_fact, conversation_history | "remember", "what did I say", "my preferences" |
| `system` | settings, status, help, integrations | "settings", "connect", "help", "status" |

### Multi-Domain Requests

Some requests span domains. The gateway handles this by:
1. Identifying the PRIMARY domain
2. Executing that domain's tools FIRST
3. Only expanding to secondary domains if explicitly needed

Example: "Turn on the lights and check my calendar"
- Primary: `smart_home` (lights) — execute immediately
- Secondary: `productivity` (calendar) — execute after lights confirmed

---

## 4. Tool Registry Design

### Registry Structure

```typescript
interface ToolDefinition {
  name: string;
  domain: Domain;
  description: string;
  requiredIntegration?: string;  // e.g., "hue", "notion"
  typicalLatency: "fast" | "medium" | "slow";
  execute: (params: unknown) => Promise<ToolResult>;
}

interface ToolRegistry {
  // Get tools for a domain
  getToolsForDomain(domain: Domain): ToolDefinition[];

  // Get tools available for a user (based on connected integrations)
  getAvailableTools(userId: string, domain: Domain): ToolDefinition[];

  // Register a new tool
  registerTool(tool: ToolDefinition): void;
}
```

### User-Specific Availability

Tools are only available if the user has connected the required integration:

```typescript
// User has Hue connected but not Notion
getAvailableTools(userId, "smart_home")
  → [control_lights, hue_scenes]

getAvailableTools(userId, "productivity")
  → []  // No Notion connected, no productivity tools
```

This prevents Claude from even attempting to use tools that will fail.

---

## 5. Intent Classification

### Approach Options

| Option | Pros | Cons |
|--------|------|------|
| **Rules-based** (regex/keywords) | Fast, deterministic | Brittle, misses edge cases |
| **Small classifier model** (DistilBERT) | Good accuracy, fast | Requires training data |
| **LLM pre-classification** (Haiku) | Very accurate, flexible | Adds latency, cost |

### Recommended: Hybrid Approach

1. **Fast path** (rules-based): Clear patterns like "lights", "weather", "notion"
2. **Fallback** (small model): Ambiguous requests go through classifier
3. **User override**: "Use Notion to..." forces productivity domain

```typescript
function classifyIntent(message: string): Domain {
  // Fast path: keyword matching
  if (/\b(light|lamp|dim|bright|hue)\b/i.test(message)) return "smart_home";
  if (/\b(weather|forecast|temperature outside)\b/i.test(message)) return "information";
  if (/\b(notion|page|database|backlog)\b/i.test(message)) return "productivity";

  // Fallback: ML classifier
  return mlClassifier.predict(message);
}
```

---

## 6. Benefits of V3 Architecture

### Performance

| Metric | V2 | V3 (Expected) |
|--------|-----|---------------|
| Avg tool calls per request | 2-4 | 1 |
| Timeout rate | ~15% | <1% |
| Response time (simple requests) | 5-60s | 1-3s |

### Maintainability

- **Adding new integrations**: Register tool in gateway, done
- **Debugging**: Clear domain boundaries, easy to trace
- **Testing**: Domain isolation enables unit testing

### Extensibility

- **MCP standard compliance**: Gateway follows Model Context Protocol
- **Third-party tools**: Easy to add via registry
- **Agent workforce**: Agents query gateway for available capabilities

---

## 7. Migration Path

### Phase 1: Gateway Infrastructure
- Implement Zenna-MCP gateway server
- Create tool registry
- Implement intent classifier (rules-based first)

### Phase 2: Tool Migration
- Move web_search to gateway
- Move control_lights to gateway
- Move Notion tools to gateway

### Phase 3: Claude Integration
- Replace tool array with single gateway tool
- Update system prompts
- Test all domains

### Phase 4: Deprecation
- Remove old tool definitions from claude-provider.ts
- Remove conditional tool loading logic
- Archive V2 tool orchestration code

---

## 8. Related V3 Initiatives

This tool orchestration change is part of the larger V3 architecture overhaul:

| Initiative | Description |
|------------|-------------|
| **Memory Architecture** | Redis (hot) → ScyllaDB (warm) → S3 (cold) |
| **Supabase Escape** | Remove database dependencies for conversations |
| **Zenna-MCP Gateway** | This document — universal tool access |
| **Qdrant 100% RAG** | Full vector-based memory retrieval |

---

## Appendix: V2 Tool Arrays (For Reference)

These will be deprecated in V3:

```typescript
// V2 claude-provider.ts (DEPRECATED IN V3)
export const BASE_TOOLS = [...];      // web_search
export const HUE_TOOLS = [...];       // control_lights
export const NOTION_TOOLS = [...];    // notion_search, notion_get_page, etc.
export const GOD_TOOLS = [...];       // ecosystem_scan_feedback
export const WORKFORCE_TOOLS = [...]; // backlog_create, sprint_update
```

In V3, all of these become registry entries in the Zenna-MCP Gateway.

---

*This document is optimized for consumption by Claude models when implementing V3 tool orchestration.*
