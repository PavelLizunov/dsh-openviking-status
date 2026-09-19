import { describe, it } from "node:test";
import assert from "node:assert";
import {
  parseRecalledMemories,
  inferCategory,
} from "../src/client/recallParser.ts";

describe("inferCategory", () => {
  it("infers category from /memories/<category>/ path", () => {
    assert.strictEqual(
      inferCategory(
        "viking://user/dsh/memories/preferences/user/code_style.md"
      ),
      "preferences"
    );
    assert.strictEqual(
      inferCategory(
        "viking://user/dsh/memories/entities/project/wrench_board.md"
      ),
      "entities"
    );
    assert.strictEqual(
      inferCategory(
        "viking://user/dsh/peers/user@example.com/memories/events/2026/07/20/doc.md"
      ),
      "events"
    );
  });

  it("infers category from known category segments in URI", () => {
    assert.strictEqual(
      inferCategory("viking://user/dsh/skills/wayfinder"),
      "skills"
    );
    assert.strictEqual(
      inferCategory("viking://user/dsh/resources"),
      "resources"
    );
    assert.strictEqual(
      inferCategory("viking://resources/volcengine/OpenViking"),
      "resources"
    );
    assert.strictEqual(
      inferCategory("viking://skills/improve-codebase"),
      "skills"
    );
  });

  it("infers category from custom segment structure", () => {
    assert.strictEqual(
      inferCategory("viking://custom/category/file.md"),
      "custom"
    );
    assert.strictEqual(
      inferCategory("viking://user/dsh/custom-cat/file.md"),
      "custom-cat"
    );
  });

  it("returns undefined for invalid or empty uri", () => {
    assert.strictEqual(inferCategory(""), undefined);
    assert.strictEqual(inferCategory("viking://"), undefined);
  });
});

describe("parseRecalledMemories - Edge cases and empty inputs", () => {
  it("returns zeros for null and undefined", () => {
    const resNull = parseRecalledMemories(null);
    assert.strictEqual(resNull.recalledCount, 0);
    assert.deepStrictEqual(resNull.items, []);
    assert.deepStrictEqual(resNull.profileItems, []);
    assert.deepStrictEqual(resNull.recallItems, []);

    const resUndef = parseRecalledMemories(undefined);
    assert.strictEqual(resUndef.recalledCount, 0);
    assert.deepStrictEqual(resUndef.items, []);
  });

  it("returns zeros for empty string or whitespace", () => {
    const res = parseRecalledMemories("   \n\t  ");
    assert.strictEqual(res.recalledCount, 0);
    assert.deepStrictEqual(res.items, []);
  });

  it("returns zeros for empty array", () => {
    const res = parseRecalledMemories([]);
    assert.strictEqual(res.recalledCount, 0);
    assert.deepStrictEqual(res.items, []);
  });

  it("handles non-string non-array unexpected inputs safely", () => {
    assert.strictEqual(parseRecalledMemories(123 as any).recalledCount, 0);
    assert.strictEqual(parseRecalledMemories(true as any).recalledCount, 0);
    assert.strictEqual(parseRecalledMemories({} as any).recalledCount, 0);
  });
});

describe("parseRecalledMemories - Profile context parsing", () => {
  it("parses directory prefix followed by relative paths with bullet points", () => {
    const input = `
<openviking-context source="profile">
<available-memories>
  viking://user/dsh/memories/preferences/
    - user@example.com/backup_strategy.md
    - user/code_style.md
    - user/development workflow.md
  viking://user/dsh/memories/entities/
    - инструмент/dsh.md
    - project/wrench_board.md
</available-memories>
</openviking-context>
    `;

    const res = parseRecalledMemories(input);
    assert.strictEqual(res.recalledCount, 5);
    assert.strictEqual(res.items.length, 5);
    assert.strictEqual(res.profileItems.length, 5);
    assert.strictEqual(res.recallItems.length, 0);

    assert.strictEqual(
      res.items[0].uri,
      "viking://user/dsh/memories/preferences/user@example.com/backup_strategy.md"
    );
    assert.strictEqual(res.items[0].category, "preferences");
    assert.strictEqual(res.items[0].source, "profile");

    assert.strictEqual(
      res.items[2].uri,
      "viking://user/dsh/memories/preferences/user/development workflow.md"
    );

    assert.strictEqual(
      res.items[3].uri,
      "viking://user/dsh/memories/entities/инструмент/dsh.md"
    );
    assert.strictEqual(res.items[3].category, "entities");
    assert.strictEqual(res.items[3].source, "profile");
  });

  it("parses full bullet point URIs directly", () => {
    const input = `
<openviking-context source="profile">
<available-memories>
- viking://user/dsh/memories/preferences/user/code_style.md
- viking://user/dsh/memories/entities/project/wrench_board.md
</available-memories>
</openviking-context>
    `;

    const res = parseRecalledMemories(input);
    assert.strictEqual(res.recalledCount, 2);
    assert.strictEqual(res.profileItems.length, 2);
    assert.strictEqual(
      res.items[0].uri,
      "viking://user/dsh/memories/preferences/user/code_style.md"
    );
    assert.strictEqual(res.items[0].category, "preferences");
    assert.strictEqual(res.items[0].source, "profile");
    assert.strictEqual(
      res.items[1].uri,
      "viking://user/dsh/memories/entities/project/wrench_board.md"
    );
    assert.strictEqual(res.items[1].category, "entities");
  });

  it("handles profile block without <available-memories> wrapper", () => {
    const input = `
<openviking-context source="profile">
- viking://user/dsh/memories/preferences/code.md
</openviking-context>
    `;
    const res = parseRecalledMemories(input);
    assert.strictEqual(res.recalledCount, 1);
    assert.strictEqual(
      res.items[0].uri,
      "viking://user/dsh/memories/preferences/code.md"
    );
    assert.strictEqual(res.items[0].source, "profile");
  });

  it("handles unclosed <openviking-context source='profile'> tag", () => {
    const input = `<openviking-context source="profile"><available-memories>- viking://user/dsh/memories/preferences/code.md`;
    const res = parseRecalledMemories(input);
    assert.strictEqual(res.recalledCount, 1);
    assert.strictEqual(
      res.items[0].uri,
      "viking://user/dsh/memories/preferences/code.md"
    );
  });
});

describe("parseRecalledMemories - Recall context parsing", () => {
  it("parses <memory> elements with score and abstract", () => {
    const input = `
<openviking-context>
Relevant memory from OpenViking.
<memory uri="viking://user/dsh/memories/entities/project/wrench_board.md" type="entities" score="0.77" detail="abstract">
# Wrench Board
A diagnostic board repair automation project.
</memory>
<memory uri="viking://user/dsh/memories/preferences/user/python_code_style.md" score="0.76" detail="overview">
- Prefers fully optimized code
</memory>
<memory uri="viking://user/dsh/peers/oleg@example.com/memories/events/2026/07/22" score="0.81" detail="uri" />
</openviking-context>
    `;

    const res = parseRecalledMemories(input);
    assert.strictEqual(res.recalledCount, 3);
    assert.strictEqual(res.items.length, 3);
    assert.strictEqual(res.recallItems.length, 3);
    assert.strictEqual(res.profileItems.length, 0);

    const first = res.items[0];
    assert.strictEqual(
      first.uri,
      "viking://user/dsh/memories/entities/project/wrench_board.md"
    );
    assert.strictEqual(first.category, "entities");
    assert.strictEqual(first.source, "recall");
    assert.strictEqual(first.score, 0.77);
    assert.ok(first.abstract?.includes("Wrench Board"));

    const third = res.items[2];
    assert.strictEqual(
      third.uri,
      "viking://user/dsh/peers/oleg@example.com/memories/events/2026/07/22"
    );
    assert.strictEqual(third.category, "events");
    assert.strictEqual(third.score, 0.81);
    assert.strictEqual(third.abstract, undefined);
  });

  it("handles unclosed and malformed <memory> tags", () => {
    const input = `
<openviking-context>
<memory uri="viking://item1" score="0.9">Content 1
<memory uri="viking://item2" score="0.8">Content 2
</openviking-context>
    `;
    const res = parseRecalledMemories(input);
    assert.strictEqual(res.recalledCount, 2);
    assert.strictEqual(res.items[0].uri, "viking://item1");
    assert.strictEqual(res.items[0].score, 0.9);
    assert.strictEqual(res.items[1].uri, "viking://item2");
    assert.strictEqual(res.items[1].score, 0.8);
  });

  it("handles standalone <memory> tags outside <openviking-context>", () => {
    const input = `<memory uri="viking://user/dsh/memories/preferences/p1" score="0.85">Pref 1</memory>`;
    const res = parseRecalledMemories(input);
    assert.strictEqual(res.recalledCount, 1);
    assert.strictEqual(
      res.items[0].uri,
      "viking://user/dsh/memories/preferences/p1"
    );
    assert.strictEqual(res.items[0].source, "recall");
    assert.strictEqual(res.items[0].score, 0.85);
  });
});

describe("parseRecalledMemories - Deduplication and source promotion", () => {
  it("deduplicates items appearing in both profile and recall, promoting to source 'recall'", () => {
    const input = `
<openviking-context source="profile">
<available-memories>
  viking://user/dsh/memories/preferences/
    - user/code_style.md
    - user/git_workflow.md
</available-memories>
</openviking-context>
<openviking-context>
<memory uri="viking://user/dsh/memories/preferences/user/code_style.md" score="0.92">
Prefers clean, concise code.
</memory>
<memory uri="viking://user/dsh/memories/entities/project/wrench_board.md" score="0.75">
Wrench board
</memory>
</openviking-context>
    `;

    const res = parseRecalledMemories(input);
    // Unique URIs:
    // 1. code_style.md (in both -> source: recall)
    // 2. git_workflow.md (in profile only -> source: profile)
    // 3. wrench_board.md (in recall only -> source: recall)
    assert.strictEqual(res.recalledCount, 3);
    assert.strictEqual(res.items.length, 3);
    assert.strictEqual(res.profileItems.length, 1);
    assert.strictEqual(res.recallItems.length, 2);

    const codeStyle = res.items.find((i) => i.uri.includes("code_style.md"));
    assert.ok(codeStyle);
    assert.strictEqual(codeStyle.source, "recall");
    assert.strictEqual(codeStyle.score, 0.92);
    assert.strictEqual(codeStyle.abstract, "Prefers clean, concise code.");

    const gitWorkflow = res.items.find((i) =>
      i.uri.includes("git_workflow.md")
    );
    assert.ok(gitWorkflow);
    assert.strictEqual(gitWorkflow.source, "profile");

    // Ensure profileItems has only git_workflow
    assert.strictEqual(res.profileItems[0].uri, gitWorkflow.uri);

    // Ensure recallItems has code_style and wrench_board
    assert.ok(res.recallItems.some((i) => i.uri.includes("code_style.md")));
    assert.ok(res.recallItems.some((i) => i.uri.includes("wrench_board.md")));
  });

  it("deduplicates multiple occurrences in recall, keeping highest score and non-empty abstract", () => {
    const input = `
<openviking-context>
<memory uri="viking://item1" score="0.7" />
<memory uri="viking://item1" score="0.85">Detailed abstract</memory>
<memory uri="viking://item1" score="0.8" />
</openviking-context>
    `;
    const res = parseRecalledMemories(input);
    assert.strictEqual(res.recalledCount, 1);
    assert.strictEqual(res.items[0].score, 0.85);
    assert.strictEqual(res.items[0].abstract, "Detailed abstract");
  });
});

describe("parseRecalledMemories - Input formats", () => {
  it("processes array of strings", () => {
    const input = [
      '<openviking-context source="profile"><available-memories>- viking://user/dsh/memories/preferences/p1</available-memories></openviking-context>',
      '<openviking-context><memory uri="viking://user/dsh/memories/entities/e1" score="0.9" /></openviking-context>',
    ];
    const res = parseRecalledMemories(input);
    assert.strictEqual(res.recalledCount, 2);
    assert.strictEqual(res.profileItems.length, 1);
    assert.strictEqual(res.recallItems.length, 1);
  });

  it("processes chat message objects with content string or content blocks", () => {
    const input = [
      {
        role: "user",
        content: "Hello, please help me with code",
      },
      {
        role: "system",
        content:
          '<openviking-context source="profile"><available-memories>- viking://user/dsh/memories/preferences/code</available-memories></openviking-context>',
      },
      {
        role: "assistant",
        content: [
          {
            type: "text",
            text: '<openviking-context><memory uri="viking://user/dsh/memories/entities/project" score="0.88">Project details</memory></openviking-context>',
          },
        ],
      },
    ];
    const res = parseRecalledMemories(input);
    assert.strictEqual(res.recalledCount, 2);
    assert.strictEqual(
      res.items[0].uri,
      "viking://user/dsh/memories/preferences/code"
    );
    assert.strictEqual(res.items[0].source, "profile");
    assert.strictEqual(
      res.items[1].uri,
      "viking://user/dsh/memories/entities/project"
    );
    assert.strictEqual(res.items[1].source, "recall");
    assert.strictEqual(res.items[1].score, 0.88);
    assert.strictEqual(res.items[1].abstract, "Project details");
  });
});
