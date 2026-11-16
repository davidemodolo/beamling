import assert from "node:assert/strict";
import { test } from "node:test";
import { parseInline, parseMarkdown } from "../../lib/markdown";
import { citedPositions, documentBody, documentMarkdown, imageReferencesAsLinks } from "../../lib/visuals";

test("headings of every level, setext titles and closing hashes", () => {
  const blocks = parseMarkdown("# One\n\n###### Six ##\n\nTitle\n===\n\n#hashtag");
  assert.deepEqual(blocks, [
    { type: "heading", level: 1, text: "One" },
    { type: "heading", level: 6, text: "Six" },
    { type: "heading", level: 1, text: "Title" },
    { type: "paragraph", text: "#hashtag" },
  ]);
});

test("lists keep going across blank lines, nest by indentation and read tasks", () => {
  const [list] = parseMarkdown("1. First\n   - detail\n\n2. Second\n3) Third");
  assert.equal(list.type, "list");
  if (list.type !== "list") return;
  assert.equal(list.ordered, true);
  assert.equal(list.items.length, 3);
  assert.deepEqual(list.items[0].blocks[1], { type: "list", ordered: false, start: 1, items: [{ checked: undefined, blocks: [{ type: "paragraph", text: "detail" }] }] });
  const [starting] = parseMarkdown("4. Four\n5. Five");
  assert.equal(starting.type === "list" && starting.start, 4);
  const [tasks] = parseMarkdown("- [x] done\n- [ ] open\n+ plus");
  assert.deepEqual(
    tasks.type === "list" && tasks.items.map((item) => item.checked),
    [true, false, undefined],
  );
});

test("rules, quotes, fences and tables", () => {
  const blocks = parseMarkdown("***\n\n> quoted\n> # inside\n\n~~~py\nx = 1\n~~~\n\n| a | b |\n|:-|-:|\n| 1 |");
  assert.deepEqual(blocks[0], { type: "hr" });
  assert.deepEqual(blocks[1], { type: "quote", blocks: [{ type: "paragraph", text: "quoted" }, { type: "heading", level: 1, text: "inside" }] });
  assert.deepEqual(blocks[2], { type: "code", language: "py", code: "x = 1", closed: true });
  assert.deepEqual(blocks[3], { type: "table", header: ["a", "b"], align: ["left", "right"], rows: [["1", ""]] });
});

test("documents are read only when asked, with fences inside them", () => {
  const text = 'Intro\n<document title="Plan">\n```\n</document>\n```\nText\n</document>';
  assert.equal(parseMarkdown(text).some((block) => block.type === "document"), false);
  const doc = parseMarkdown(text, { documents: true })[1];
  assert.deepEqual(doc, { type: "document", title: "Plan", markdown: "```\n</document>\n```\nText", closed: true });
});

test("inline emphasis, links, citations and breaks", () => {
  assert.deepEqual(parseInline("**b** *i* _u_ ~~s~~ `c` snake_case_name"), [
    { type: "strong", children: [{ type: "text", value: "b" }] },
    { type: "text", value: " " },
    { type: "em", children: [{ type: "text", value: "i" }] },
    { type: "text", value: " " },
    { type: "em", children: [{ type: "text", value: "u" }] },
    { type: "text", value: " " },
    { type: "del", children: [{ type: "text", value: "s" }] },
    { type: "text", value: " " },
    { type: "code", value: "c" },
    { type: "text", value: " snake_case_name" },
  ]);
  assert.deepEqual(parseInline("A [1][2, 3] and [^4]"), [
    { type: "text", value: "A " },
    { type: "cite", positions: [1], raw: "[1]" },
    { type: "cite", positions: [2, 3], raw: "[2, 3]" },
    { type: "text", value: " and " },
    { type: "cite", positions: [4], raw: "[^4]" },
  ]);
  assert.deepEqual(parseInline("[x](https://a.example/w_(b)) \\*no\\*\nnext"), [
    { type: "link", href: "https://a.example/w_(b)", children: [{ type: "text", value: "x" }] },
    { type: "text", value: " *no*" },
    { type: "break" },
    { type: "text", value: "next" },
  ]);
  assert.deepEqual(parseInline("3 * 4 * 5"), [{ type: "text", value: "3 * 4 * 5" }]);
});

test("a document exports with its title once and its cited sources as links", () => {
  const sources = [
    { position: 1, title: "One [draft]", url: "https://one.example/" },
    { position: 2, title: "Two", url: "https://two.example/" },
    { position: 3, title: "Three", url: "https://three.example/" },
  ];
  assert.equal(documentBody("My plan", "\n# My **plan**\n\nText"), "Text");
  assert.equal(documentBody("My plan", "# Other\n\nText"), "# Other\n\nText");
  assert.deepEqual(citedPositions("See [3] and [1].\n```\n[2]\n```", sources).map((source) => source.position), [1, 3]);
  assert.equal(
    documentMarkdown({ title: "My plan", markdown: "# My plan\n\nText [1]." }, sources),
    '# My plan\n\nText [1].\n\n## Sources\n\n- [1] [One draft](<https://one.example/>)\n\n[1]: <https://one.example/> "One draft"\n',
  );
  assert.equal(documentMarkdown({ title: "Plain", markdown: "No sources." }, sources), "# Plain\n\nNo sources.\n");
});

test("pictures: only source references become images; other images keep their alt text", () => {
  assert.deepEqual(parseInline("![Eiffel Tower](source:3)"), [{ type: "image", alt: "Eiffel Tower", position: 3 }]);
  assert.deepEqual(parseInline("See ![a cat](https://evil.example/x.png?leak=1) here"), [{ type: "text", value: "See a cat here" }]);
  assert.deepEqual(parseInline("![](source:12)"), [{ type: "image", alt: "", position: 12 }]);
  const [list] = parseMarkdown("- ![Map](source:1)");
  assert.equal(list.type, "list");
  const [table] = parseMarkdown("| A |\n| --- |\n| ![Pic](source:2) |");
  assert.equal(table.type, "table");
  if (table.type === "table") assert.deepEqual(parseInline(table.rows[0][0]), [{ type: "image", alt: "Pic", position: 2 }]);
});

test("copies and downloads turn picture references into links to their source", () => {
  const sources = [{ position: 1, title: "Overview", url: "https://example.org/a" }];
  assert.equal(imageReferencesAsLinks("![Tower](source:1) and ![Gone](source:9)", sources), "[Tower](<https://example.org/a>) and Gone");
  assert.match(documentMarkdown({ title: "Doc", markdown: "![](source:1)" }, sources), /\[Overview\]\(<https:\/\/example\.org\/a>\)/);
});
