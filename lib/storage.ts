import "server-only";
import { getSupabaseServiceClient, isSupabaseConfigured } from "./supabase/server";

// Hero image upload to Supabase Storage (bucket "blog-images", created
// manually or via a future migration once a live project exists). Falls
// back gracefully — see DECISIONS.md — when no Supabase project is
// configured: the /admin/blog form still works, it just requires a plain
// image URL/path instead of a file upload in that case.
export function isStorageConfigured(): boolean {
  return isSupabaseConfigured();
}

export async function uploadBlogHeroImage(file: File): Promise<string> {
  const supabase = getSupabaseServiceClient();
  if (!supabase) {
    throw new Error("Supabase is niet geconfigureerd — vul in plaats daarvan een afbeeldings-URL in.");
  }
  const extension = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const path = `${crypto.randomUUID()}.${extension}`;
  const bytes = new Uint8Array(await file.arrayBuffer());

  const { error } = await supabase.storage
    .from("blog-images")
    .upload(path, bytes, { contentType: file.type || "image/jpeg", upsert: true });
  if (error) throw new Error(error.message);

  const { data } = supabase.storage.from("blog-images").getPublicUrl(path);
  return data.publicUrl;
}
