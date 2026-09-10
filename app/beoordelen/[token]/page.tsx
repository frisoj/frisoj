import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getReviewInviteByToken } from "@/lib/orders";
import ReviewForm from "@/components/ReviewForm";

export const metadata: Metadata = {
  title: "Laat een review achter",
  robots: { index: false, follow: false },
};

export default async function ReviewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await getReviewInviteByToken(token);

  if (!invite) notFound();

  if (invite.used_at) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <h1 className="font-heading text-3xl font-semibold text-ink">Bedankt, je review is al ontvangen</h1>
        <p className="mt-3 text-ink-muted">Deze reviewlink is al eerder gebruikt.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-14 sm:py-20">
      <h1 className="font-heading text-3xl font-semibold text-ink">Hoe bevalt je PureLitter?</h1>
      <p className="mt-3 text-ink-muted">
        Jouw ervaring helpt andere kattenbezitters een goede keuze te maken. We publiceren reviews eerlijk en
        ongefilterd, ook als ze kritisch zijn.
      </p>
      <ReviewForm token={token} />
    </div>
  );
}
