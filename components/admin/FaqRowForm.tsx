"use client";

import { useState } from "react";
import { FAQ_CATEGORIES, FAQ_CATEGORY_LABELS, type FaqItemRow } from "@/lib/supabase/types";
import ConfirmSubmitButton from "@/components/admin/ConfirmSubmitButton";
import { deleteFaqAction } from "@/lib/admin/faq-actions";

export default function FaqRowForm({
  item,
  action,
}: {
  item?: FaqItemRow;
  action: (formData: FormData) => void;
}) {
  const [open, setOpen] = useState(!item);

  if (!open && item) {
    return (
      <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-surface p-3">
        <div>
          <p className="text-sm font-semibold text-ink">{item.question}</p>
          <p className="text-xs text-ink-muted">
            {FAQ_CATEGORY_LABELS[item.category]} · volgorde {item.sort_order} ·{" "}
            {item.is_published ? "gepubliceerd" : "concept"}
          </p>
        </div>
        <div className="flex flex-shrink-0 gap-3">
          <button type="button" onClick={() => setOpen(true)} className="text-xs font-semibold text-accent hover:underline">
            Bewerken
          </button>
          <form action={deleteFaqAction}>
            <input type="hidden" name="id" value={item.id} />
            <ConfirmSubmitButton confirmMessage="Deze vraag verwijderen?" className="text-xs font-semibold text-red-700 hover:underline">
              Verwijderen
            </ConfirmSubmitButton>
          </form>
        </div>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-3 rounded-lg border border-border bg-surface p-4">
      <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr]">
        <select name="category" defaultValue={item?.category ?? FAQ_CATEGORIES[0]} className="rounded-lg border border-border bg-cream px-3 py-2 text-sm">
          {FAQ_CATEGORIES.map((c) => (
            <option key={c} value={c}>{FAQ_CATEGORY_LABELS[c]}</option>
          ))}
        </select>
        <input name="sortOrder" type="number" defaultValue={item?.sort_order ?? 0} placeholder="Volgorde" className="rounded-lg border border-border bg-cream px-3 py-2 text-sm" />
        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" name="isPublished" defaultChecked={item?.is_published ?? true} />
          Gepubliceerd
        </label>
      </div>
      <input name="question" defaultValue={item?.question} placeholder="Vraag" required className="w-full rounded-lg border border-border bg-cream px-3 py-2 text-sm" />
      <textarea name="answer" defaultValue={item?.answer} placeholder="Antwoord" rows={3} required className="w-full rounded-lg border border-border bg-cream px-3 py-2 text-sm" />
      <div className="flex gap-3">
        <button type="submit" className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-dark">
          Opslaan
        </button>
        {item && (
          <button type="button" onClick={() => setOpen(false)} className="text-sm font-semibold text-ink-muted hover:text-ink">
            Annuleren
          </button>
        )}
      </div>
    </form>
  );
}
