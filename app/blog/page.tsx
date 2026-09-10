import type { Metadata } from "next";
import BlogCard from "@/components/BlogCard";
import Pagination from "@/components/Pagination";
import Breadcrumbs from "@/components/Breadcrumbs";
import SectionHeading from "@/components/SectionHeading";
import { listPublishedPosts } from "@/lib/blog";
import { buildMetadata } from "@/lib/seo";

export const metadata: Metadata = buildMetadata({
  title: "Kennisbank over zelfreinigende kattenbakken | PureLitter",
  description:
    "Koopgidsen, wenschema's en praktische tips over zelfreinigende kattenbakken, vulling en onderhoud — geschreven voor kattenbezitters in NL/BE.",
  path: "/blog",
});

export default async function BlogIndexPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page ?? "1") || 1);
  const { posts, total, pageSize } = await listPublishedPosts(page);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:py-14">
      <Breadcrumbs items={[{ label: "Blog" }]} />
      <SectionHeading
        eyebrow="Kennisbank"
        title="Alles over zelfreinigende kattenbakken"
        description="Koopgidsen, praktische tips en wenschema's — geschreven voor kattenbezitters, niet voor zoekmachines."
      />

      {posts.length === 0 ? (
        <p className="mt-10 text-ink-muted">Er zijn nog geen artikelen gepubliceerd.</p>
      ) : (
        <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {posts.map((post) => (
            <BlogCard key={post.id} post={post} />
          ))}
        </div>
      )}

      <Pagination page={page} totalPages={totalPages} basePath="/blog" />
    </div>
  );
}
