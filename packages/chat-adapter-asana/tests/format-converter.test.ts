import { describe, expect, test } from "vitest";
import { AsanaFormatConverter } from "../src/format-converter";

const converter = new AsanaFormatConverter();

describe("AsanaFormatConverter.toAst", () => {
  test("parses plain text into a root mdast node", () => {
    const ast = converter.toAst("Hello world");

    expect(ast.type).toBe("root");
    expect(ast.children.length).toBeGreaterThan(0);
  });

  test("recognizes bold markdown", () => {
    const ast = converter.toAst("**bold** plain");
    const paragraph = ast.children[0] as { type: string; children: unknown[] };

    expect(paragraph.type).toBe("paragraph");
    const strong = paragraph.children[0] as { type: string };
    expect(strong.type).toBe("strong");
  });

  test("recognizes emphasis and inline code", () => {
    const ast = converter.toAst("_italic_ and `code`");
    const paragraph = ast.children[0] as { children: Array<{ type: string }> };

    const types = paragraph.children.map((child) => child.type);
    expect(types).toContain("emphasis");
    expect(types).toContain("inlineCode");
  });

  test("recognizes links", () => {
    const ast = converter.toAst("[docs](https://example.com)");
    const paragraph = ast.children[0] as { children: Array<{ type: string; url?: string }> };

    expect(paragraph.children[0]?.type).toBe("link");
    expect(paragraph.children[0]?.url).toBe("https://example.com");
  });
});

describe("AsanaFormatConverter.fromAst", () => {
  test("round-trips bold markdown", () => {
    const ast = converter.toAst("**bold**");
    expect(converter.fromAst(ast).trim()).toBe("**bold**");
  });

  test("round-trips links", () => {
    const ast = converter.toAst("[docs](https://example.com)");
    expect(converter.fromAst(ast).trim()).toBe("[docs](https://example.com)");
  });
});

describe("AsanaFormatConverter.astToAsanaHtml", () => {
  test("wraps plain paragraphs in <body>", () => {
    const ast = converter.toAst("Hello");
    expect(converter.astToAsanaHtml(ast)).toBe("<body>Hello</body>");
  });

  test("renders strong, emphasis, and inline code", () => {
    const ast = converter.toAst("**b** _e_ `c`");
    const html = converter.astToAsanaHtml(ast);

    expect(html).toContain("<strong>b</strong>");
    expect(html).toContain("<em>e</em>");
    expect(html).toContain("<code>c</code>");
  });

  test("renders links with escaped hrefs", () => {
    const ast = converter.toAst('[site](https://example.com/?q="x")');
    const html = converter.astToAsanaHtml(ast);

    expect(html).toContain('<a href="https://example.com/?q=&quot;x&quot;">');
    expect(html).toContain(">site</a>");
  });

  test("renders unordered lists with <ul><li>", () => {
    const ast = converter.toAst("- one\n- two");
    const html = converter.astToAsanaHtml(ast);

    expect(html).toContain("<ul>");
    expect(html).toContain("<li>one</li>");
    expect(html).toContain("<li>two</li>");
  });

  test("renders code blocks with escaped content", () => {
    const ast = converter.toAst("```\n<script>alert(1)</script>\n```");
    const html = converter.astToAsanaHtml(ast);

    expect(html).toContain("<pre>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>");
  });

  test("escapes HTML-unsafe characters in text nodes", () => {
    const ast = converter.toAst("a < b & c > d");
    const html = converter.astToAsanaHtml(ast);

    expect(html).toContain("&lt;");
    expect(html).toContain("&amp;");
    expect(html).toContain("&gt;");
  });

  test("renders headings as bolded lines", () => {
    const ast = converter.toAst("# Heading");
    const html = converter.astToAsanaHtml(ast);

    expect(html).toContain("<strong>Heading</strong>");
  });
});

describe("AsanaFormatConverter.wrapAsanaHtml", () => {
  test("wraps a plain fragment in <body>", () => {
    expect(converter.wrapAsanaHtml("hello")).toBe("<body>hello</body>");
  });

  test("is idempotent when the fragment is already wrapped", () => {
    expect(converter.wrapAsanaHtml("<body>hi</body>")).toBe("<body>hi</body>");
  });

  test("preserves whitespace trimming without double-wrapping", () => {
    expect(converter.wrapAsanaHtml("  <body>hi</body>  ")).toBe(
      "<body>hi</body>",
    );
  });

  test("wraps fragments where the outer tag is not body", () => {
    expect(converter.wrapAsanaHtml("<p>hello</p>")).toBe(
      "<body><p>hello</p></body>",
    );
  });
});
