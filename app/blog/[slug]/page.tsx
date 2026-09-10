import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import Breadcrumbs from "@/components/Breadcrumbs";
import TableOfContents from "@/components/TableOfContents";
import BlogCard from "@/components/BlogCard";
import { getPostBySlug, getRelatedPosts } from "@/lib/blog";
import { extractHeadings, renderMarkdown } from "@/lib/markdown";
import { buildMetadata } from "@/lib/seo";
import { articleJsonLd, breadcrumbJsonLd, JsonLd } from "@/lib/jsonld";
import { site } from "@/lib/site";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPostBySlug(slug);
  if (!post) return {};
  return buildMetadata({
    title: `${post.title} | ${site.brand}`,
    description: post.meta_description ?? post.excerpt ?? post.title,
    path: `/blog/${post.slug}`,
    ogType: "article",
    image: post.cover_image_url ?? undefined,
  });
}

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = await getPostBySlug(slug);
  if (!post) notFound();

  const headings = extractHeadings(post.body ?? "");
  const html = renderMarkdown(post.body ?? "");
  const related = await getRelatedPosts(post.slug, 3);
  const publishedDate = post.published_at
    ? new Date(post.published_at).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" })
    : null;
  const updatedDate = new Date(post.updated_at).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" });
  const showUpdated = post.published_at && post.updated_at.slice(0, 10) !== post.published_at.slice(0, 10);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:py-14">
      <JsonLd data={articleJsonLd(post)} />
      <JsonLd data={breadcrumbJsonLd([{ label: "Blog", href: "/blog" }, { label: post.title }])} />
      <Breadcrumbs items={[{ label: "Blog", href: "/blog" }, { label: post.title }]} />

      <p className="text-sm font-semibold uppercase tracking-wide text-accent">Kennisbank</p>
      <h1 className="mt-2 font-heading text-3xl font-semibold text-ink sm:text-4xl">{post.title}</h1>

      <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-ink-muted">
        <span>Door {post.author_name}</span>
        <span aria-hidden="true">·</span>
        {publishedDate && <span>Gepubliceerd op {publishedDate}</span>}
        {showUpdated && (
          <>
            <span aria-hidden="true">·</span>
            <span>Bijgewerkt op {updatedDate}</span>
          </>
        )}
        <span aria-hidden="true">·</span>
        <span>{post.readingMinutes} min. leestijd</span>
      </div>

      {post.cover_image_url && (
        <div className="relative mt-6 aspect-[16/9] w-full overflow-hidden rounded-2xl border border-border bg-cream">
          <Image
            src={post.cover_image_url}
            alt={post.hero_image_alt ?? post.title}
            fill
            sizes="(min-width: 768px) 720px, 100vw"
            className="object-cover"
            priority
            fetchPriority="high"
          />
        </div>
      )}

      <div className="mt-8">
        <TableOfContents headings={headings} />
      </div>

      <article
        className="prose-article max-w-[70ch] text-[1.05rem] leading-relaxed text-ink"
        dangerouslySetInnerHTML={{ __html: html }}
      />

      {/* Product CTA — mid-article placement handled by content structure; also shown at the end below */}
      <div className="my-10 rounded-2xl border border-border bg-accent-tint p-6 text-center">
        <p className="font-heading text-lg font-semibold text-ink">
          Klaar om te stoppen met dagelijks scheppen?
        </p>
        <p className="mt-2 text-sm text-ink-muted">
          Bekijk de {site.productName.toLowerCase()} en de specificaties.
        </p>
        <Link
          href={`/${site.productSlug}`}
          className="mt-4 inline-block rounded-full bg-accent px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent-dark"
        >
          Bekijk het product
        </Link>
      </div>

      <div className="mb-10 rounded-2xl border border-border bg-surface p-6 text-center">
        <p className="font-heading text-lg font-semibold text-ink">Vragen over de PureLitter kattenbak?</p>
        <p className="mt-2 text-sm text-ink-muted">
          Lees de veelgestelde vragen of neem contact met ons op.
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-3">
          <Link
            href="/veelgestelde-vragen"
            className="rounded-full border border-border px-5 py-2.5 text-sm font-semibold text-ink hover:border-accent hover:text-accent"
          >
            Veelgestelde vragen
          </Link>
          <Link
            href={`/${site.productSlug}`}
            className="rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-white hover:bg-accent-dark"
          >
            Bekijk het product
          </Link>
        </div>
      </div>

      {related.length > 0 && (
        <section className="border-t border-border pt-10">
          <h2 className="font-heading text-2xl font-semibold text-ink">Meer lezen</h2>
          <div className="mt-6 grid gap-6 sm:grid-cols-3">
            {related.map((r) => (
              <BlogCard key={r.id} post={r} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
