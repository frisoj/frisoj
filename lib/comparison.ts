// Comparison data for /vergelijking.
//
// Our own row is drawn from the specs already on the product page
// (app/zelfreinigende-kattenbak/page.tsx) — those are Phase 1 placeholder
// specs, clearly labelled there. Competitor rows use only specs we're
// reasonably confident about from each brand's general market position;
// anything we're not confident about is marked "[CONTROLEREN]" rather than
// guessed. No unverifiable negative claims about competitors are made —
// see DECISIONS.md.
import { site } from "./site";

export type ComparisonRow = {
  feature: string;
  values: Record<string, string>;
};

export const brands = ["purelitter", "litterRobot", "petkit", "catlink", "manual"] as const;
export type BrandKey = (typeof brands)[number];

export const brandLabels: Record<BrandKey, string> = {
  purelitter: site.brand,
  litterRobot: "Litter-Robot",
  petkit: "PetKit",
  catlink: "Catlink",
  manual: "Premium handmatige kattenbak",
};

export const comparisonRows: ComparisonRow[] = [
  {
    feature: "Richtprijs",
    values: {
      purelitter: `€${site.price}`,
      litterRobot: "[CONTROLEREN] — doorgaans hoger geprijsd segment",
      petkit: "[CONTROLEREN] — varieert sterk per model",
      catlink: "[CONTROLEREN] — varieert sterk per model",
      manual: "€30-90",
    },
  },
  {
    feature: "Geschikt kattengewicht",
    values: {
      purelitter: "Tot 8 kg per kat (placeholder, zie productpagina)",
      litterRobot: "[CONTROLEREN] — check specificaties per model",
      petkit: "[CONTROLEREN] — check specificaties per model",
      catlink: "[CONTROLEREN] — check specificaties per model",
      manual: "Geen beperking (afhankelijk van bakgrootte)",
    },
  },
  {
    feature: "Capaciteit opvangbak",
    values: {
      purelitter: "Meerdere gebruiksdagen per kat (placeholder, zie productpagina)",
      litterRobot: "[CONTROLEREN]",
      petkit: "[CONTROLEREN]",
      catlink: "[CONTROLEREN]",
      manual: "N.v.t. — dagelijks scheppen nodig",
    },
  },
  {
    feature: "Geluidsniveau",
    values: {
      purelitter: "< 45 dB tijdens reiniging (placeholder, zie productpagina)",
      litterRobot: "[CONTROLEREN]",
      petkit: "[CONTROLEREN]",
      catlink: "[CONTROLEREN]",
      manual: "Geen (geen motor)",
    },
  },
  {
    feature: "App-bediening",
    values: {
      purelitter: "Ja — status, meldingen, gebruikslog",
      litterRobot: "Ja, bij de meeste modellen",
      petkit: "Ja, bij de meeste modellen",
      catlink: "Ja, bij de meeste modellen",
      manual: "Niet van toepassing",
    },
  },
  {
    feature: "Veiligheidssensoren",
    values: {
      purelitter: "Gewichtssensor + noodstop",
      litterRobot: "Gewichts-/klemsensoren aanwezig — exacte uitvoering [CONTROLEREN]",
      petkit: "Gewichts-/klemsensoren aanwezig — exacte uitvoering [CONTROLEREN]",
      catlink: "Gewichts-/klemsensoren aanwezig — exacte uitvoering [CONTROLEREN]",
      manual: "Niet van toepassing (geen bewegende delen)",
    },
  },
  {
    feature: "Levertijd NL/BE",
    values: {
      purelitter: "2-5 werkdagen, gratis verzending",
      litterRobot: "[CONTROLEREN] — afhankelijk van voorraad/leverancier in NL/BE",
      petkit: "[CONTROLEREN] — afhankelijk van voorraad/leverancier in NL/BE",
      catlink: "[CONTROLEREN] — afhankelijk van voorraad/leverancier in NL/BE",
      manual: "Meestal direct op voorraad bij lokale winkels",
    },
  },
  {
    feature: "Garantie",
    values: {
      purelitter: "2 jaar wettelijke garantie",
      litterRobot: "[CONTROLEREN] — fabrieksgarantie kan afwijken van EU-standaard",
      petkit: "[CONTROLEREN] — fabrieksgarantie kan afwijken van EU-standaard",
      catlink: "[CONTROLEREN] — fabrieksgarantie kan afwijken van EU-standaard",
      manual: "2 jaar wettelijke garantie",
    },
  },
  {
    feature: "Retourrecht (EU)",
    values: {
      purelitter: "14 dagen herroepingsrecht",
      litterRobot: "14 dagen herroepingsrecht bij EU-aankoop (afhankelijk van verkoper)",
      petkit: "14 dagen herroepingsrecht bij EU-aankoop (afhankelijk van verkoper)",
      catlink: "14 dagen herroepingsrecht bij EU-aankoop (afhankelijk van verkoper)",
      manual: "14 dagen herroepingsrecht bij EU-aankoop (afhankelijk van verkoper)",
    },
  },
];
