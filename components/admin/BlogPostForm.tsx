"use client";

import { useState } from "react";
import { renderMarkdown } from "@/lib/markdown";
import type { BlogPostRow } from "@/lib/supabase/types";

export default function BlogPostForm({
  action,
  post,
  storageConfigured,
}: {
  action: (formData: FormData) => void;
  post?: BlogPostRow;
  storageConfigured: boolean;
}) {
  const [body, setBody] = useState(post?.body ?? "");
  const [tab, setTab] = useState<"schrijven" | "voorvertoning">("schrijven");

  return (
    <form action={action} className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="title" className="block text-sm font-medium text-ink">Titel</label>
          <input id="title" name="title" required defaultValue={post?.title} className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm" />
        </div>
        <div>
          <label htmlFor="slug" className="block text-sm font-medium text-ink">Slug (leeg = automatisch)</label>
          <input id="slug" name="slug" defaultValue={post?.slug} className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm" />
        </div>
      </div>

      <div>
        <label htmlFor="excerpt" className="block text-sm font-medium text-ink">Samenvatting (voor blogkaarten)</label>
        <textarea id="excerpt" name="excerpt" rows={2} defaultValue={post?.excerpt ?? ""} className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm" />
      </div>

      <div>
        <label htmlFor="metaDescription" className="block text-sm font-medium text-ink">Meta description (max ~155 tekens)</label>
        <textarea id="metaDescription" name="metaDescription" rows={2} maxLength={160} defaultValue={post?.meta_description ?? ""} className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="heroImageUrl" className="block text-sm font-medium text-ink">Hero-afbeelding URL/pad</label>
          <input id="heroImageUrl" name="heroImageUrl" defaultValue={post?.cover_image_url ?? ""} placeholder="/images/blog/mijn-artikel.svg" className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm" />
          <p className="mt-1 text-xs text-ink-muted">
            {storageConfigured
              ? "Wordt overschreven als je hieronder een bestand uploadt."
              : "Supabase Storage is niet geconfigureerd — uploaden werkt pas met een live project; vul voorlopig een URL/pad in."}
          </p>
        </div>
        <div>
          <label htmlFor="heroImageFile" className="block text-sm font-medium text-ink">Hero-afbeelding uploaden</label>
          <input id="heroImageFile" name="heroImageFile" type="file" accept="image/*" disabled={!storageConfigured} className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm disabled:opacity-50" />
        </div>
      </div>

      <div>
        <label htmlFor="heroImageAlt" className="block text-sm font-medium text-ink">Alt-tekst hero-afbeelding</label>
        <input id="heroImageAlt" name="heroImageAlt" defaultValue={post?.hero_image_alt ?? ""} className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm" />
      </div>

      <div>
        <label htmlFor="authorName" className="block text-sm font-medium text-ink">Auteur</label>
        <input id="authorName" name="authorName" defaultValue={post?.author_name ?? "PureLitter-team"} className="mt-1 w-full max-w-xs rounded-lg border border-border bg-surface px-3 py-2 text-sm" />
      </div>

      <div>
        <div className="flex items-center justify-between">
          <label htmlFor="body" className="block text-sm font-medium text-ink">Inhoud (Markdown)</label>
          <div className="flex gap-1 rounded-lg border border-border p-0.5 text-xs">
            <button type="button" onClick={() => setTab("schrijven")} className={`rounded px-3 py-1 font-semibold ${tab === "schrijven" ? "bg-accent text-white" : "text-ink-muted"}`}>
              Schrijven
            </button>
            <button type="button" onClick={() => setTab("voorvertoning")} className={`rounded px-3 py-1 font-semibold ${tab === "voorvertoning" ? "bg-accent text-white" : "text-ink-muted"}`}>
              Voorvertoning
            </button>
          </div>
        </div>
        {tab === "schrijven" ? (
          <textarea
            id="body"
            name="body"
            rows={20}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 font-mono text-sm"
          />
        ) : (
          <>
            <input type="hidden" name="body" value={body} />
            <div
              className="prose-article mt-1 max-h-[32rem] overflow-y-auto rounded-lg border border-border bg-cream p-4 text-sm"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(body) }}
            />
          </>
        )}
      </div>

      <label className="flex items-center gap-2 text-sm font-medium text-ink">
        <input type="checkbox" name="isPublished" defaultChecked={post?.is_published ?? false} />
        Gepubliceerd
      </label>

      <button type="submit" className="rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-white hover:bg-accent-dark">
        Opslaan
      </button>
    </form>
  );
}
