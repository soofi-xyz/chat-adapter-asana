import {
  BaseFormatConverter,
  parseMarkdown,
  stringifyMarkdown,
  type Root,
} from "chat";

/**
 * Converts between mdast AST and Asana's `html_text` / `html_notes` fragment
 * format. Asana accepts a restricted HTML subset. We lean on markdown as the
 * canonical representation in both directions: Asana's `text` field is plain
 * text (which parseMarkdown handles) and for outbound messages we convert AST
 * into a small HTML subset that Asana's parser accepts.
 */
export class AsanaFormatConverter extends BaseFormatConverter {
  toAst(platformText: string): Root {
    return parseMarkdown(platformText);
  }

  fromAst(ast: Root): string {
    return stringifyMarkdown(ast);
  }

  /**
   * Convert an mdast AST into Asana's restricted HTML subset used by
   * `html_text` and `html_notes`. Wraps result in a single <body>.
   */
  astToAsanaHtml(ast: Root): string {
    const inner = ast.children.map((child) => nodeToHtml(child)).join("");
    return `<body>${inner}</body>`;
  }

  /**
   * Wrap a raw HTML fragment in Asana's required `<body>...</body>` envelope
   * if it isn't wrapped already.
   */
  wrapAsanaHtml(fragment: string): string {
    const trimmed = fragment.trim();
    if (/^<body[\s>]/i.test(trimmed) && /<\/body>\s*$/i.test(trimmed)) {
      return trimmed;
    }
    return `<body>${trimmed}</body>`;
  }
}

const escapeHtml = (text: string): string =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;");

const nodeToHtml = (node: unknown): string => {
  if (!node || typeof node !== "object") {
    return "";
  }

  const maybe = node as { type?: string; value?: string; children?: unknown[]; url?: string };
  const type = maybe.type;
  const children = Array.isArray(maybe.children)
    ? maybe.children.map((child) => nodeToHtml(child)).join("")
    : "";

  switch (type) {
    case "text":
      return escapeHtml(typeof maybe.value === "string" ? maybe.value : "");
    case "paragraph":
      return children;
    case "strong":
      return `<strong>${children}</strong>`;
    case "emphasis":
      return `<em>${children}</em>`;
    case "inlineCode":
      return `<code>${escapeHtml(typeof maybe.value === "string" ? maybe.value : "")}</code>`;
    case "code":
      return `<pre>${escapeHtml(typeof maybe.value === "string" ? maybe.value : "")}</pre>`;
    case "break":
      return "\n";
    case "link":
      return `<a href=\"${escapeHtml(typeof maybe.url === "string" ? maybe.url : "#")}\">${children}</a>`;
    case "list":
      return `<ul>${children}</ul>`;
    case "listItem":
      return `<li>${children}</li>`;
    case "heading":
      return `<strong>${children}</strong>\n`;
    case "blockquote":
      return children;
    case "root":
      return children;
    case "html":
      return typeof maybe.value === "string" ? maybe.value : "";
    default:
      return children;
  }
};
