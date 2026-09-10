import BlogPostForm from "@/components/admin/BlogPostForm";
import { createBlogPostAction } from "@/lib/admin/blog-actions";
import { isStorageConfigured } from "@/lib/storage";

export default function NewBlogPostPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold text-ink">Nieuw artikel</h1>
      <div className="mt-6 max-w-3xl">
        <BlogPostForm action={createBlogPostAction} storageConfigured={isStorageConfigured()} />
      </div>
    </div>
  );
}
