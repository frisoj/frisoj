import { listAllFaqsForAdmin } from "@/lib/faq";
import { createFaqAction, updateFaqAction } from "@/lib/admin/faq-actions";
import FaqRowForm from "@/components/admin/FaqRowForm";

export default async function AdminFaqPage() {
  const items = await listAllFaqsForAdmin();

  return (
    <div>
      <h1 className="text-2xl font-semibold text-ink">Veelgestelde vragen</h1>
      <p className="mt-1 text-sm text-ink-muted">
        Volgorde bepaalt de sortering binnen een categorie op de publieke FAQ-pagina.
      </p>

      <div className="mt-6 space-y-3">
        {items.map((item) => (
          <FaqRowForm key={item.id} item={item} action={updateFaqAction.bind(null, item.id)} />
        ))}
      </div>

      <div className="mt-8">
        <h2 className="text-lg font-semibold text-ink">Nieuwe vraag toevoegen</h2>
        <div className="mt-3">
          <FaqRowForm action={createFaqAction} />
        </div>
      </div>
    </div>
  );
}
