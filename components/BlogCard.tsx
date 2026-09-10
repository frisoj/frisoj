import Link from "next/link";
import Image from "next/image";
import type { BlogPostSummary } from "@/lib/blog";

export default function BlogCard({ post }: { post: BlogPostSummary }) {
  const date = post.published_at
    ? new Date(post.published_at).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" })
    : null;

  return (
    <Link
      href={`/blog/${post.slug}`}
      className="group flex flex-col overflow-hidden rounded-2xl border border-border bg-surface transition-shadow hover:shadow-md"
    >
      <div className="relative aspect-[16/9] w-full overflow-hidden bg-cream">
        {post.cover_image_url && (
          <Image
            src={post.cover_image_url}
            alt={post.hero_image_alt ?? post.title}
            fill
            className="object-cover transition-transform group-hover:scale-105"
          />
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-5">
        <h3 className="font-heading text-lg font-semibold text-ink group-hover:text-accent">{post.title}</h3>
        {post.excerpt && <p className="line-clamp-3 text-sm text-ink-muted">{post.excerpt}</p>}
        <div className="mt-auto flex items-center gap-3 pt-2 text-xs text-ink-muted">
          {date && <span>{date}</span>}
          <span aria-hidden="true">·</span>
          <span>{post.readingMinutes} min. leestijd</span>
        </div>
      </div>
    </Link>
  );
}
