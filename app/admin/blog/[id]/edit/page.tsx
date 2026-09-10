import { notFound } from "next/navigation";
import BlogPostForm from "@/components/admin/BlogPostForm";
import { getPostByIdForAdmin } from "@/lib/blog";
import { updateBlogPostAction } from "@/lib/admin/blog-actions";
import { isStorageConfigured } from "@/lib/storage";

export default async function EditBlogPostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const post = await getPostByIdForAdmin(id);
  if (!post) notFound();

  const action = updateBlogPostAction.bind(null, post.id, post.cover_image_url);

  return (
    <div>
      <h1 className="text-2xl font-semibold text-ink">Artikel bewerken</h1>
      <div className="mt-6 max-w-3xl">
        <BlogPostForm action={action} post={post} storageConfigured={isStorageConfigured()} />
      </div>
    </div>
  );
}
