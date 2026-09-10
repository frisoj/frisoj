"use client";

export default function QuantityStepper({
  quantity,
  onChange,
  label,
}: {
  quantity: number;
  onChange: (next: number) => void;
  label: string;
}) {
  return (
    <div className="inline-flex items-center rounded-full border border-border">
      <button
        type="button"
        onClick={() => onChange(Math.max(1, quantity - 1))}
        aria-label={`Aantal verlagen voor ${label}`}
        className="flex h-9 w-9 items-center justify-center rounded-full text-lg text-ink transition-colors hover:bg-cream"
      >
        −
      </button>
      <span aria-live="polite" className="min-w-[2ch] text-center text-sm font-semibold text-ink">
        {quantity}
      </span>
      <button
        type="button"
        onClick={() => onChange(quantity + 1)}
        aria-label={`Aantal verhogen voor ${label}`}
        className="flex h-9 w-9 items-center justify-center rounded-full text-lg text-ink transition-colors hover:bg-cream"
      >
        +
      </button>
    </div>
  );
}
