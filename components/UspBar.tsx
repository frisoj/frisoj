const usps = [
  { icon: "🚚", label: "Gratis verzending NL/BE" },
  { icon: "↩️", label: "14 dagen bedenktijd" },
  { icon: "🛡️", label: "2 jaar garantie" },
  { icon: "💳", label: "iDEAL & Bancontact" },
];

export default function UspBar() {
  return (
    <div className="bg-accent-tint border-y border-border">
      <ul className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-8 gap-y-2 px-4 py-3 text-sm font-medium text-ink sm:justify-between">
        {usps.map((usp) => (
          <li key={usp.label} className="flex items-center gap-2">
            <span aria-hidden="true">{usp.icon}</span>
            <span>{usp.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
