"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createPost, deletePost, updatePost, type BlogPostInput } from "@/lib/blog";
import { uploadBlogHeroImage, isStorageConfigured } from "@/lib/storage";

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

async function inputFromFormData(formData: FormData, existingCoverUrl?: string | null): Promise<BlogPostInput> {
  const title = String(formData.get("title") ?? "").trim();
  const slugInput = String(formData.get("slug") ?? "").trim();
  const heroImageUrlField = String(formData.get("heroImageUrl") ?? "").trim();
  const heroImageFile = formData.get("heroImageFile");

  let coverImageUrl = heroImageUrlField || existingCoverUrl || "";
  if (heroImageFile instanceof File && heroImageFile.size > 0) {
    if (!isStorageConfigured()) {
      throw new Error("Supabase Storage is niet geconfigureerd — vul een afbeeldings-URL in plaats van een upload.");
    }
    coverImageUrl = await uploadBlogHeroImage(heroImageFile);
  }

  return {
    slug: slugInput ? slugify(slugInput) : slugify(title),
    title,
    excerpt: String(formData.get("excerpt") ?? "").trim(),
    body: String(formData.get("body") ?? ""),
    metaDescription: String(formData.get("metaDescription") ?? "").trim(),
    coverImageUrl,
    heroImageAlt: String(formData.get("heroImageAlt") ?? "").trim(),
    authorName: String(formData.get("authorName") ?? "").trim() || "PureLitter-team",
    isPublished: formData.get("isPublished") === "on",
  };
}

export async function createBlogPostAction(formData: FormData) {
  const input = await inputFromFormData(formData);
  if (!input.title || !input.slug) throw new Error("Titel is verplicht.");
  await createPost(input);
  revalidatePath("/admin/blog");
  revalidatePath("/blog");
  redirect("/admin/blog");
}

export async function updateBlogPostAction(id: string, existingCoverUrl: string | null, formData: FormData) {
  const input = await inputFromFormData(formData, existingCoverUrl);
  if (!input.title || !input.slug) throw new Error("Titel is verplicht.");
  await updatePost(id, input);
  revalidatePath("/admin/blog");
  revalidatePath(`/admin/blog/${id}/edit`);
  revalidatePath("/blog");
  revalidatePath(`/blog/${input.slug}`);
  redirect("/admin/blog");
}

export async function deleteBlogPostAction(formData: FormData) {
  const id = String(formData.get("id"));
  await deletePost(id);
  revalidatePath("/admin/blog");
  revalidatePath("/blog");
}
