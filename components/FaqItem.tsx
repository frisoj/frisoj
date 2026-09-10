export default function FaqItem({
  question,
  answer,
}: {
  question: string;
  answer: string;
}) {
  return (
    <details className="group rounded-xl border border-border bg-surface p-5 open:shadow-sm">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-heading text-lg font-semibold text-ink">
        {question}
        <span
          aria-hidden="true"
          className="shrink-0 text-2xl text-accent transition-transform group-open:rotate-45"
        >
          +
        </span>
      </summary>
      <p className="mt-3 text-ink-muted">{answer}</p>
    </details>
  );
}
