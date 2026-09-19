export interface RecalledMemoryItem {
  uri: string;
  category?: string;
  source: "profile" | "recall";
  score?: number;
  abstract?: string;
}

export interface RecalledMemoriesResult {
  recalledCount: number;
  items: RecalledMemoryItem[];
  profileItems: RecalledMemoryItem[];
  recallItems: RecalledMemoryItem[];
}

const KNOWN_CATEGORIES = new Set([
  "preferences",
  "entities",
  "events",
  "skills",
  "resources",
  "profile",
]);

/**
 * Infer the memory category from a viking:// URI.
 * Examples:
 * - viking://user/dsh/memories/preferences/... -> preferences
 * - viking://user/dsh/memories/entities/... -> entities
 * - viking://user/dsh/peers/user@example.com/memories/events/... -> events
 * - viking://user/dsh/skills/... -> skills
 * - viking://user/dsh/resources/... -> resources
 */
export function inferCategory(uri: string): string | undefined {
  if (!uri || typeof uri !== "string") return undefined;

  // 1. Direct match on /memories/<category>/ or /memories/<category>$
  const memoriesMatch = uri.match(/\/memories\/([^/#?]+)/i);
  if (memoriesMatch && memoriesMatch[1]) {
    return memoriesMatch[1].toLowerCase();
  }

  // 2. Strip viking:// and inspect path segments
  const cleanUri = uri.replace(/^viking:\/\/?/i, "");
  const segments = cleanUri.split("/").filter(Boolean);

  // Check if any path segment matches a known category
  for (const seg of segments) {
    const lower = seg.toLowerCase();
    if (KNOWN_CATEGORIES.has(lower)) {
      return lower;
    }
  }

  // 3. Pattern: user/<user_id>/<category>/...
  if (segments[0]?.toLowerCase() === "user" && segments.length >= 3) {
    return segments[2].toLowerCase();
  }

  // 4. Pattern: <category>/...
  if (segments.length >= 2) {
    return segments[0].toLowerCase();
  }

  return undefined;
}

/**
 * Safely extracts combined text from strings, message arrays, or objects.
 */
function extractAllText(input: unknown): string {
  if (input == null) return "";
  if (typeof input === "string") return input;
  if (typeof input === "number" || typeof input === "boolean")
    return String(input);
  if (Array.isArray(input)) {
    return input.map(extractAllText).filter(Boolean).join("\n");
  }
  if (typeof input === "object") {
    const obj = input as Record<string, unknown>;
    const parts: string[] = [];
    if ("content" in obj && obj.content != null) {
      parts.push(extractAllText(obj.content));
    }
    if ("text" in obj && obj.text != null) {
      parts.push(extractAllText(obj.text));
    }
    if ("message" in obj && obj.message != null) {
      parts.push(extractAllText(obj.message));
    }
    if (parts.length > 0) {
      return parts.join("\n");
    }
    try {
      return Object.values(obj).map(extractAllText).filter(Boolean).join("\n");
    } catch {
      return "";
    }
  }
  return "";
}

interface ContextBlock {
  isProfile: boolean;
  attributes: string;
  content: string;
}

/**
 * Identifies <openviking-context> blocks, handling malformed and unclosed tags.
 */
function findContextBlocks(text: string): ContextBlock[] {
  const blocks: ContextBlock[] = [];
  const openTagRegex = /<openviking-context\b([^>]*)>/gi;
  let match: RegExpExecArray | null;

  const tagPositions: Array<{
    index: number;
    endIndex: number;
    attrs: string;
  }> = [];
  while ((match = openTagRegex.exec(text)) !== null) {
    tagPositions.push({
      index: match.index,
      endIndex: match.index + match[0].length,
      attrs: match[1] || "",
    });
  }

  // Fallback: If no <openviking-context> tag found, check for inner tags
  if (tagPositions.length === 0) {
    if (/<available-memories\b/i.test(text)) {
      blocks.push({
        isProfile: true,
        attributes: 'source="profile"',
        content: text,
      });
    } else if (/<memory\b/i.test(text)) {
      blocks.push({
        isProfile: false,
        attributes: "",
        content: text,
      });
    }
    return blocks;
  }

  for (let i = 0; i < tagPositions.length; i++) {
    const current = tagPositions[i];
    const nextStart =
      i + 1 < tagPositions.length ? tagPositions[i + 1].index : text.length;
    const blockText = text.slice(current.endIndex, nextStart);

    const closeIndex = blockText.search(/<\/openviking-context>/i);
    const content =
      closeIndex !== -1 ? blockText.slice(0, closeIndex) : blockText;

    const isProfile = /\bsource\s*=\s*["']profile["']/i.test(current.attrs);
    blocks.push({
      isProfile,
      attributes: current.attrs,
      content,
    });
  }

  return blocks;
}

/**
 * Normalizes URI by trimming whitespace and trailing slash (except for bare scheme).
 */
function normalizeUri(uri: string): string {
  let clean = uri.trim();
  if (clean.endsWith("/") && !clean.endsWith("://")) {
    clean = clean.slice(0, -1);
  }
  return clean;
}

/**
 * Parses profile items from an <openviking-context source="profile"> block.
 */
function parseProfileItems(blockContent: string): RecalledMemoryItem[] {
  const items: RecalledMemoryItem[] = [];

  // Extract content inside <available-memories>...</available-memories> if present
  let memContent = blockContent;
  const availMatch = blockContent.match(
    /<available-memories\b[^>]*>([\s\S]*?)(?:<\/available-memories>|$)/i
  );
  if (availMatch && availMatch[1]) {
    memContent = availMatch[1];
  }

  const lines = memContent.split(/\r?\n/);
  let currentBaseUri: string | null = null;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    // Pattern 1: Directory prefix line:
    // e.g. "viking://user/dsh/memories/preferences/"
    // or "- viking://user/dsh/memories/preferences/"
    const baseMatch = trimmed.match(
      /^[-*•]?\s*(viking:\/\/[^\s<>"'`]+?\/)\s*$/i
    );
    if (baseMatch) {
      currentBaseUri = baseMatch[1];
      continue;
    }

    // Pattern 2: Relative path under currentBaseUri:
    // e.g. "    - user@example.com/backup_strategy.md"
    //      "    - user/development workflow.md"
    const bulletMatch = trimmed.match(/^[-*•]\s+([^\s<>"'`].*?)$/);
    if (
      bulletMatch &&
      currentBaseUri &&
      !bulletMatch[1].startsWith("viking://")
    ) {
      let relPath = bulletMatch[1].trim();
      // Remove any markdown links e.g. [name](...)
      relPath = relPath.replace(/^\[([^\]]+)\](?:\([^)]*\))?/, "$1");
      relPath = relPath.replace(/[.,;:)\]]+$/, "").trim();
      if (relPath) {
        const cleanBase = currentBaseUri.endsWith("/")
          ? currentBaseUri
          : currentBaseUri + "/";
        const fullUri = normalizeUri(cleanBase + relPath.replace(/^\/+/, ""));
        items.push({
          uri: fullUri,
          category: inferCategory(fullUri),
          source: "profile",
        });
        continue;
      }
    }

    // Pattern 3: Full viking:// URI on bullet point (handles potential spaces in filenames)
    const fullBulletMatch = trimmed.match(
      /^[-*•]\s+(viking:\/\/[^<>"'`\r\n]+)/i
    );
    if (fullBulletMatch) {
      let uri = fullBulletMatch[1].trim().replace(/[.,;:)\]]+$/, "");
      if (uri.endsWith("/")) {
        currentBaseUri = uri;
      } else {
        uri = normalizeUri(uri);
        items.push({
          uri,
          category: inferCategory(uri),
          source: "profile",
        });
        continue;
      }
    }

    // Pattern 4: Inline viking://[^\s<>"'`]+ matches
    const inlineMatches = trimmed.matchAll(/viking:\/\/[^\s<>"'`]+/gi);
    for (const m of inlineMatches) {
      let uri = m[0].replace(/[.,;:)\]]+$/, "");
      if (uri.endsWith("/")) {
        currentBaseUri = uri;
      } else {
        uri = normalizeUri(uri);
        items.push({
          uri,
          category: inferCategory(uri),
          source: "profile",
        });
      }
    }
  }

  return items;
}

/**
 * Parses recall items from an <openviking-context> block.
 */
function parseRecallItems(blockContent: string): RecalledMemoryItem[] {
  const items: RecalledMemoryItem[] = [];

  // Match <memory ...> tags, handles self-closing and inner content
  const memoryTagRegex =
    /<memory\b([^>]*?)(?:\/>|>([\s\S]*?)(?:<\/memory>|(?=<memory\b)|$))/gi;
  let memMatch: RegExpExecArray | null;

  while ((memMatch = memoryTagRegex.exec(blockContent)) !== null) {
    const attrsString = memMatch[1] || "";
    const innerContent = memMatch[2] || "";

    // 1. Extract URI
    const uriMatch = attrsString.match(
      /\buri\s*=\s*(?:["'](viking:\/\/[^"']+)["']|(viking:\/\/[^\s>]+))/i
    );
    if (!uriMatch) continue;
    const rawUri = uriMatch[1] || uriMatch[2];
    const uri = normalizeUri(rawUri);

    // 2. Extract score
    const scoreMatch = attrsString.match(
      /\bscore\s*=\s*(?:["']([^"']+)["']|([0-9.]+))/i
    );
    let score: number | undefined;
    const scoreStr = scoreMatch ? scoreMatch[1] || scoreMatch[2] : undefined;
    if (scoreStr) {
      const parsed = parseFloat(scoreStr);
      if (Number.isFinite(parsed)) {
        score = parsed;
      }
    }

    // 3. Extract explicit category/type attribute
    const typeMatch = attrsString.match(
      /\b(?:type|category)\s*=\s*["']([^"']+)["']/i
    );
    const explicitCategory = typeMatch ? typeMatch[1].trim() : undefined;
    const category = inferCategory(uri) || explicitCategory;

    // 4. Extract abstract (attribute or inner content)
    let abstractText: string | undefined;
    const abstractAttrMatch = attrsString.match(
      /\babstract\s*=\s*["']([^"']+)["']/i
    );
    if (abstractAttrMatch) {
      abstractText = abstractAttrMatch[1].trim();
    } else {
      const trimmedContent = innerContent.trim();
      if (trimmedContent) {
        abstractText = trimmedContent;
      }
    }

    items.push({
      uri,
      category,
      source: "recall",
      score,
      abstract: abstractText,
    });
  }

  return items;
}

/**
 * Parses conversation messages or text context to extract recalled OpenViking memories.
 *
 * Requirements:
 * - Extract profile items from <openviking-context source="profile">...<available-memories>
 * - Extract recall items from <openviking-context>...<memory uri="...">
 * - Infer category from URI
 * - Deduplicate by URI: if an item appears in both recall and profile, mark source: "recall"
 * - Ensure recalledCount === items.length
 */
export function parseRecalledMemories(
  input: string | any[] | null | undefined
): RecalledMemoriesResult {
  if (input == null) {
    return {
      recalledCount: 0,
      items: [],
      profileItems: [],
      recallItems: [],
    };
  }

  const text = extractAllText(input);
  if (!text.trim()) {
    return {
      recalledCount: 0,
      items: [],
      profileItems: [],
      recallItems: [],
    };
  }

  const blocks = findContextBlocks(text);
  const rawProfileItems: RecalledMemoryItem[] = [];
  const rawRecallItems: RecalledMemoryItem[] = [];

  for (const block of blocks) {
    if (block.isProfile) {
      rawProfileItems.push(...parseProfileItems(block.content));
    } else {
      rawRecallItems.push(...parseRecallItems(block.content));
    }
  }

  // Deduplicate recall items by URI
  const recallMap = new Map<string, RecalledMemoryItem>();
  for (const item of rawRecallItems) {
    const existing = recallMap.get(item.uri);
    if (!existing) {
      recallMap.set(item.uri, { ...item });
    } else {
      if (existing.score === undefined && item.score !== undefined) {
        existing.score = item.score;
      } else if (existing.score !== undefined && item.score !== undefined) {
        existing.score = Math.max(existing.score, item.score);
      }
      if (!existing.abstract && item.abstract) {
        existing.abstract = item.abstract;
      }
      if (!existing.category && item.category) {
        existing.category = item.category;
      }
    }
  }

  // Deduplicate profile items by URI
  const profileMap = new Map<string, RecalledMemoryItem>();
  for (const item of rawProfileItems) {
    if (!profileMap.has(item.uri)) {
      profileMap.set(item.uri, { ...item });
    }
  }

  // Cross-deduplicate: if an item appears in both recall and profile, mark source: "recall"
  const itemsMap = new Map<string, RecalledMemoryItem>();

  // Add profile items first
  for (const [uri, item] of profileMap.entries()) {
    itemsMap.set(uri, item);
  }

  // Overlay recall items (promotes source to "recall" and attaches score/abstract)
  for (const [uri, item] of recallMap.entries()) {
    itemsMap.set(uri, item);
  }

  const items = Array.from(itemsMap.values());
  const profileItems = items.filter((it) => it.source === "profile");
  const recallItems = items.filter((it) => it.source === "recall");

  return {
    recalledCount: items.length,
    items,
    profileItems,
    recallItems,
  };
}
