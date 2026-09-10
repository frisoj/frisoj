// Minimal Markdown -> HTML renderer for blog content.
//
// We intentionally do NOT pull in a Markdown/remark dependency: blog posts
// are either hand-written (seeded content below) or, later, edited through
// the /admin/blog Markdown editor, so a small, dependency-free renderer
// covering the subset we actually use (headings, paragraphs, bold/italic,
// links, lists, blockquotes, inline code) keeps the bundle light and the
// behaviour easy to reason about. Not a general-purpose CommonMark parser.
//
// Output is trusted HTML: it is only ever generated from content authored
// by us (seed data) or entered by an authenticated admin behind the
// /admin allowlist (proxy.ts) — never from public user input.

export type TocEntry = { id: string; text: string; level: 2 | 3 };

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

function renderInline(text: string): string {
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  // Restore intentional inline markup after escaping.
  html = html
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(?<!\*)\*(?!\*)(.+?)\*(?!\*)/g, "<em>$1</em>")
    .replace(/`([^`]+?)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label, href) => {
      const external = /^https?:\/\//.test(href);
      const rel = external ? ' rel="noopener noreferrer" target="_blank"' : "";
      return `<a href="${href}"${rel}>${label}</a>`;
    });
  return html;
}

/** Extracts H2/H3 headings for a table of contents without a full parse. */
export function extractHeadings(markdown: string): TocEntry[] {
  const headings: TocEntry[] = [];
  for (const line of markdown.split("\n")) {
    const h2 = /^##\s+(.+)$/.exec(line.trim());
    const h3 = /^###\s+(.+)$/.exec(line.trim());
    if (h2) headings.push({ id: slugify(h2[1]), text: h2[1], level: 2 });
    else if (h3) headings.push({ id: slugify(h3[1]), text: h3[1], level: 3 });
  }
  return headings;
}

/** Renders our Markdown subset to an HTML string, ready for dangerouslySetInnerHTML. */
export function renderMarkdown(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  let listBuffer: string[] = [];
  let listType: "ul" | "ol" | null = null;

  const flushList = () => {
    if (listType) {
      out.push(`<${listType}>${listBuffer.join("")}</${listType}>`);
      listBuffer = [];
      listType = null;
    }
  };

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === "") {
      flushList();
      i++;
      continue;
    }

    const h1 = /^#\s+(.+)$/.exec(trimmed);
    const h2 = /^##\s+(.+)$/.exec(trimmed);
    const h3 = /^###\s+(.+)$/.exec(trimmed);
    const quote = /^>\s?(.+)$/.exec(trimmed);
    const ulItem = /^[-*]\s+(.+)$/.exec(trimmed);
    const olItem = /^\d+\.\s+(.+)$/.exec(trimmed);
    const tableRow = /^\|(.+)\|$/.exec(trimmed);
    const tableSeparator = /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?$/.test(trimmed);

    // Only GFM-style tables with a header row followed by a separator row
    // (our only usage in seeded content) are supported.
    const nextLine = lines[i + 1]?.trim() ?? "";
    const nextIsSeparator = /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?$/.test(nextLine);
    if (tableRow && !tableSeparator && nextIsSeparator) {
      flushList();
      const headerCells = tableRow[1].split("|").map((c) => c.trim());
      const headerHtml = `<thead><tr>${headerCells.map((c) => `<th>${renderInline(c)}</th>`).join("")}</tr></thead>`;
      i += 2; // skip header row + separator row
      const bodyRows: string[] = [];
      while (i < lines.length && /^\|(.+)\|$/.test(lines[i].trim())) {
        const rowCells = lines[i].trim().slice(1, -1).split("|").map((c) => c.trim());
        bodyRows.push(`<tr>${rowCells.map((c) => `<td>${renderInline(c)}</td>`).join("")}</tr>`);
        i++;
      }
      out.push(`<table>${headerHtml}<tbody>${bodyRows.join("")}</tbody></table>`);
      continue;
    }

    if (h1) {
      flushList();
      out.push(`<h1 id="${slugify(h1[1])}">${renderInline(h1[1])}</h1>`);
    } else if (h2) {
      flushList();
      out.push(`<h2 id="${slugify(h2[1])}">${renderInline(h2[1])}</h2>`);
    } else if (h3) {
      flushList();
      out.push(`<h3 id="${slugify(h3[1])}">${renderInline(h3[1])}</h3>`);
    } else if (quote) {
      flushList();
      out.push(`<blockquote><p>${renderInline(quote[1])}</p></blockquote>`);
    } else if (ulItem) {
      if (listType !== "ul") flushList();
      listType = "ul";
      listBuffer.push(`<li>${renderInline(ulItem[1])}</li>`);
    } else if (olItem) {
      if (listType !== "ol") flushList();
      listType = "ol";
      listBuffer.push(`<li>${renderInline(olItem[1])}</li>`);
    } else {
      flushList();
      out.push(`<p>${renderInline(trimmed)}</p>`);
    }
    i++;
  }
  flushList();
  return out.join("\n");
}

/** Rough Dutch reading-time estimate, ~200 words/minute. */
export function estimateReadingMinutes(markdown: string): number {
  const words = markdown.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}
