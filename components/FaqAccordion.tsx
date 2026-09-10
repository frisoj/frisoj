import type { FaqCategory, FaqItemRow } from "@/lib/supabase/types";
import { FAQ_CATEGORY_LABELS } from "@/lib/supabase/types";
import FaqItem from "@/components/FaqItem";

/** Groups items by category and renders each as native <details> — fully
 * readable and navigable without JavaScript; the +/rotate affordance is
 * progressive enhancement only (CSS on top of the native element). */
export default function FaqAccordion({ items }: { items: FaqItemRow[] }) {
  const grouped = new Map<FaqCategory, FaqItemRow[]>();
  for (const item of items) {
    const list = grouped.get(item.category) ?? [];
    list.push(item);
    grouped.set(item.category, list);
  }

  return (
    <div className="space-y-10">
      {Array.from(grouped.entries()).map(([category, categoryItems]) => (
        <section key={category} aria-labelledby={`faq-${category}`}>
          <h2 id={`faq-${category}`} className="font-heading text-xl font-semibold text-ink">
            {FAQ_CATEGORY_LABELS[category]}
          </h2>
          <div className="mt-4 space-y-3">
            {categoryItems.map((item) => (
              <FaqItem key={item.id} question={item.question} answer={item.answer} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
