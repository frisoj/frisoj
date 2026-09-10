import { getReviewsForAdmin, approveReviewAction, rejectReviewAction } from "@/lib/admin-actions";

export default async function AdminReviewsPage() {
  const reviews = await getReviewsForAdmin();

  return (
    <div>
      <h1 className="text-2xl font-semibold text-ink">Reviews</h1>
      <p className="mt-1 text-sm text-ink-muted">Alleen goedgekeurde reviews verschijnen op de productpagina.</p>

      <div className="mt-6 space-y-3">
        {reviews.length === 0 && <p className="text-ink-muted">Nog geen reviews ontvangen.</p>}
        {reviews.map((review) => (
          <div key={review.id} className="rounded-xl border border-border bg-surface p-4">
            <div className="flex items-center justify-between">
              <p className="font-semibold text-ink">
                {review.author_name} — {"★".repeat(review.rating)}{"☆".repeat(5 - review.rating)}
              </p>
              <span
                className={`rounded-full px-2 py-1 text-xs font-semibold ${
                  review.is_published ? "bg-success/15 text-success" : "bg-accent-tint text-accent-dark"
                }`}
              >
                {review.is_published ? "Gepubliceerd" : "In afwachting"}
              </span>
            </div>
            {review.title && <p className="mt-2 font-medium text-ink">{review.title}</p>}
            {review.body && <p className="mt-1 text-sm text-ink-muted">{review.body}</p>}
            <div className="mt-3 flex gap-2">
              <form action={approveReviewAction}>
                <input type="hidden" name="reviewId" value={review.id} />
                <button type="submit" className="rounded-lg border border-success px-3 py-1.5 text-sm font-medium text-success hover:bg-success/10">
                  Goedkeuren
                </button>
              </form>
              <form action={rejectReviewAction}>
                <input type="hidden" name="reviewId" value={review.id} />
                <button type="submit" className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-ink-muted hover:border-accent hover:text-accent">
                  Afwijzen
                </button>
              </form>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
