import Link from "next/link";

export default function Pagination({
  page,
  totalPages,
  basePath,
}: {
  page: number;
  totalPages: number;
  basePath: string;
}) {
  if (totalPages <= 1) return null;

  return (
    <nav aria-label="Paginering" className="mt-10 flex items-center justify-center gap-2">
      <Link
        href={page <= 2 ? basePath : `${basePath}?page=${page - 1}`}
        aria-disabled={page <= 1}
        className={`rounded-full border border-border px-4 py-2 text-sm font-medium ${
          page <= 1 ? "pointer-events-none opacity-40" : "text-ink hover:border-accent hover:text-accent"
        }`}
      >
        Vorige
      </Link>
      <span className="text-sm text-ink-muted">
        Pagina {page} van {totalPages}
      </span>
      <Link
        href={`${basePath}?page=${page + 1}`}
        aria-disabled={page >= totalPages}
        className={`rounded-full border border-border px-4 py-2 text-sm font-medium ${
          page >= totalPages ? "pointer-events-none opacity-40" : "text-ink hover:border-accent hover:text-accent"
        }`}
      >
        Volgende
      </Link>
    </nav>
  );
}
