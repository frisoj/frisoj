import Link from "next/link";
import { listAllPostsForAdmin } from "@/lib/blog";
import { deleteBlogPostAction } from "@/lib/admin/blog-actions";
import ConfirmSubmitButton from "@/components/admin/ConfirmSubmitButton";

export default async function AdminBlogPage() {
  const posts = await listAllPostsForAdmin();

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-ink">Blog</h1>
        <Link href="/admin/blog/new" className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-dark">
          Nieuw artikel
        </Link>
      </div>

      <div className="mt-6 overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full min-w-[640px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-border bg-cream text-ink-muted">
              <th className="px-4 py-2">Titel</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Bijgewerkt</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {posts.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-6 text-center text-ink-muted">Nog geen artikelen.</td></tr>
            )}
            {posts.map((post) => (
              <tr key={post.id} className="border-b border-border last:border-0 hover:bg-cream">
                <td className="px-4 py-2">
                  <Link href={`/admin/blog/${post.id}/edit`} className="font-semibold text-accent hover:underline">
                    {post.title}
                  </Link>
                  <p className="text-xs text-ink-muted">/blog/{post.slug}</p>
                </td>
                <td className="px-4 py-2">
                  {post.is_published ? (
                    <span className="rounded-full bg-success/10 px-2 py-0.5 text-xs font-semibold text-success">Gepubliceerd</span>
                  ) : (
                    <span className="rounded-full bg-cream px-2 py-0.5 text-xs font-semibold text-ink-muted">Concept</span>
                  )}
                </td>
                <td className="px-4 py-2 text-ink-muted">{new Date(post.updated_at).toLocaleDateString("nl-NL")}</td>
                <td className="px-4 py-2 text-right">
                  <form action={deleteBlogPostAction}>
                    <input type="hidden" name="id" value={post.id} />
                    <ConfirmSubmitButton
                      confirmMessage={`Artikel "${post.title}" verwijderen?`}
                      className="text-xs font-semibold text-red-700 hover:underline"
                    >
                      Verwijderen
                    </ConfirmSubmitButton>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
