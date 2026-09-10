import type { TocEntry } from "@/lib/markdown";

export default function TableOfContents({ headings }: { headings: TocEntry[] }) {
  const h2Count = headings.filter((h) => h.level === 2).length;
  if (h2Count <= 4) return null;

  return (
    <nav aria-label="Inhoudsopgave" className="mb-10 rounded-2xl border border-border bg-surface p-5">
      <p className="font-heading text-sm font-semibold uppercase tracking-wide text-accent">Inhoud</p>
      <ol className="mt-3 space-y-1.5 text-sm">
        {headings.map((h) => (
          <li key={h.id} className={h.level === 3 ? "ml-4" : ""}>
            <a href={`#${h.id}`} className="text-ink-muted hover:text-accent">
              {h.text}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
