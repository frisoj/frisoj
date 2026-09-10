import "server-only";
import { getSupabaseServiceClient, isSupabaseConfigured } from "./supabase/server";
import type { FaqItemRow, FaqCategory } from "./supabase/types";

// Same mock/Supabase fallback pattern as lib/orders.ts and lib/blog.ts —
// see DECISIONS.md. 20-25 seeded questions cover every category from the
// brief; editable later via /admin/faq once a live Supabase project exists.

const seed: FaqItemRow[] = [
  // --- product & werking ---
  {
    id: "20000000-0000-4000-8000-000000000001",
    category: "product_werking",
    question: "Hoe werkt de zelfreinigende kattenbak precies?",
    answer:
      "Na elk toiletbezoek van je kat start, met een korte vertraging, een automatische reinigingscyclus die klontjes zeeft en direct in een afgesloten opvangbak stopt. Jij hoeft dus niet meer dagelijks te scheppen — je leegt periodiek alleen de opvangbak.",
    sort_order: 1, is_published: true, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "20000000-0000-4000-8000-000000000002",
    category: "product_werking",
    question: "Heb ik wifi nodig om de kattenbak te gebruiken?",
    answer:
      "Nee. De automatische reiniging werkt ook zonder wifi. Een verbinding is alleen nodig voor de app-functies, zoals meldingen en het gebruikslog.",
    sort_order: 2, is_published: true, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "20000000-0000-4000-8000-000000000003",
    category: "product_werking",
    question: "Wat kan ik zien in de app?",
    answer:
      "De app toont onder andere de reinigingsstatus, meldingen wanneer de opvangbak vol raakt, en een overzicht van hoe vaak je kat de bak gebruikt.",
    sort_order: 3, is_published: true, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "20000000-0000-4000-8000-000000000004",
    category: "product_werking",
    question: "Hoeveel geluid maakt de kattenbak tijdens het reinigen?",
    answer:
      "De bak is ontworpen om rustig te werken. Zie de specificatietabel op de productpagina voor het exacte geluidsniveau.",
    sort_order: 4, is_published: true, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "20000000-0000-4000-8000-000000000005",
    category: "product_werking",
    question: "Hoeveel stroom verbruikt de kattenbak?",
    answer:
      "Het verbruik is laag, vergelijkbaar met kleine huishoudelektronica. Zie de specificatietabel op de productpagina voor de exacte waarde.",
    sort_order: 5, is_published: true, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
  },
  // --- veiligheid en kat ---
  {
    id: "20000000-0000-4000-8000-000000000006",
    category: "veiligheid_kat",
    question: "Is de kattenbak veilig als mijn kat er weer instapt tijdens het reinigen?",
    answer:
      "De bak heeft een gewichtssensor die de reinigingscyclus direct onderbreekt zodra er gewicht wordt gedetecteerd. Geen systeem is 100% foutloos, dus houd je kat de eerste periode in de gaten.",
    sort_order: 1, is_published: true, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "20000000-0000-4000-8000-000000000007",
    category: "veiligheid_kat",
    question: "Vanaf welk gewicht kan mijn kat de bak veilig gebruiken?",
    answer:
      "Zie het minimumgewicht in de specificatietabel op de productpagina. Onder dat gewicht kan de sensor onbetrouwbaar zijn; gebruik dan een gewone bak.",
    sort_order: 2, is_published: true, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "20000000-0000-4000-8000-000000000008",
    category: "veiligheid_kat",
    question: "Kan ik de reiniging handmatig stopzetten?",
    answer:
      "Ja, er is een handmatige noodstop op de bak zelf en een stopfunctie in de app.",
    sort_order: 3, is_published: true, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "20000000-0000-4000-8000-000000000009",
    category: "veiligheid_kat",
    question: "Mijn kat vermijdt de nieuwe bak — wat kan ik doen?",
    answer:
      "Dat is normaal in de eerste dagen. Volg het stapsgewijze wenschema in ons artikel over wennen aan een automatische kattenbak. Blijft ze de bak volledig vermijden of zie je gezondheidssignalen, raadpleeg dan je dierenarts.",
    sort_order: 4, is_published: true, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "20000000-0000-4000-8000-000000000010",
    category: "veiligheid_kat",
    question: "Is de bak geschikt voor kittens?",
    answer:
      "Voor kittens onder het aangegeven minimumgewicht raden we een gewone bak aan, omdat de gewichtssensor daaronder minder betrouwbaar kan zijn.",
    sort_order: 5, is_published: true, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "20000000-0000-4000-8000-000000000011",
    category: "veiligheid_kat",
    question: "Geven jullie medisch advies over de gezondheid van mijn kat?",
    answer:
      "Nee. Voor gezondheidsvragen over je kat verwijzen we altijd naar een dierenarts — onze klantenservice kan alleen helpen met de werking van het product.",
    sort_order: 6, is_published: true, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
  },
  // --- vulling en onderhoud ---
  {
    id: "20000000-0000-4000-8000-000000000012",
    category: "vulling_onderhoud",
    question: "Welke kattenbakvulling moet ik gebruiken?",
    answer:
      "Fijnkorrelige, klontvormende vulling werkt het beste met het automatische zeefmechanisme. Zie ons artikel over kattenbakvulling voor meer detail.",
    sort_order: 1, is_published: true, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "20000000-0000-4000-8000-000000000013",
    category: "vulling_onderhoud",
    question: "Hoe vaak moet ik de opvangbak legen?",
    answer:
      "Dat hangt af van het aantal katten; bij één kat is eens per 1-2 weken gebruikelijk. De app of het indicatielampje laat zien wanneer legen nodig is.",
    sort_order: 2, is_published: true, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "20000000-0000-4000-8000-000000000014",
    category: "vulling_onderhoud",
    question: "Hoe maak ik de kattenbak schoon?",
    answer:
      "Naast het legen van de opvangbak zijn de onderdelen die met afval in aanraking komen uitneembaar en afwasbaar. Maak deze periodiek schoon met water en een milde, kattenveilige zeep.",
    sort_order: 3, is_published: true, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "20000000-0000-4000-8000-000000000015",
    category: "vulling_onderhoud",
    question: "Mijn kattenbak ruikt onaangenaam, wat kan ik doen?",
    answer:
      "Controleer eerst of de opvangbak vol is, of je klontvormende vulling gebruikt en of het zeefmechanisme schoon is. Zie ons artikel over de oorzaken en oplossingen van een stinkende kattenbak voor de volledige checklist.",
    sort_order: 4, is_published: true, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "20000000-0000-4000-8000-000000000016",
    category: "vulling_onderhoud",
    question: "Kan ik kristalvulling gebruiken?",
    answer:
      "Alleen als deze klontert. Niet-klonterende kristalvulling werkt minder goed met automatische zeefmechanismen.",
    sort_order: 5, is_published: true, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
  },
  // --- bestellen en betalen ---
  {
    id: "20000000-0000-4000-8000-000000000017",
    category: "bestellen_betalen",
    question: "Welke betaalmethoden accepteren jullie?",
    answer: "We accepteren iDEAL, Bancontact, creditcard, Apple Pay en Klarna, veilig verwerkt via Mollie.",
    sort_order: 1, is_published: true, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "20000000-0000-4000-8000-000000000018",
    category: "bestellen_betalen",
    question: "Heb ik een account nodig om te bestellen?",
    answer: "Nee, je kunt afrekenen als gast. Je ontvangt een ordernummer en bevestigingsmail om je bestelling te volgen.",
    sort_order: 2, is_published: true, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "20000000-0000-4000-8000-000000000019",
    category: "bestellen_betalen",
    question: "Ik heb geen bevestigingsmail ontvangen, wat nu?",
    answer:
      "Controleer eerst je spamfolder. Ontbreekt de mail nog, neem dan contact met ons op via het contactformulier met je ordernummer of e-mailadres.",
    sort_order: 3, is_published: true, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "20000000-0000-4000-8000-000000000020",
    category: "bestellen_betalen",
    question: "Kan ik mijn bestelling nog wijzigen na het afronden?",
    answer:
      "Neem zo snel mogelijk contact op via het contactformulier — zodra de bestelling is doorgestuurd naar de leverancier, kunnen we deze niet meer wijzigen.",
    sort_order: 4, is_published: true, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
  },
  // --- verzending ---
  {
    id: "20000000-0000-4000-8000-000000000021",
    category: "verzending",
    question: "Wat zijn de verzendkosten?",
    answer: "Verzending naar Nederland en België is gratis, zonder minimale besteldrempel.",
    sort_order: 1, is_published: true, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "20000000-0000-4000-8000-000000000022",
    category: "verzending",
    question: "Hoe lang duurt de levering?",
    answer: "Levering duurt doorgaans 2-5 werkdagen binnen Nederland en België.",
    sort_order: 2, is_published: true, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "20000000-0000-4000-8000-000000000023",
    category: "verzending",
    question: "Kan ik mijn pakket volgen?",
    answer: "Ja, zodra je bestelling is verzonden ontvang je een track & trace code per e-mail.",
    sort_order: 3, is_published: true, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
  },
  // --- retour en garantie ---
  {
    id: "20000000-0000-4000-8000-000000000024",
    category: "retour_garantie",
    question: "Hoeveel bedenktijd heb ik om te retourneren?",
    answer:
      "Je hebt 14 dagen bedenktijd vanaf ontvangst om de bak, ongebruikt en in originele verpakking, te retourneren. Zie ons herroepingsrecht voor de volledige voorwaarden.",
    sort_order: 1, is_published: true, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "20000000-0000-4000-8000-000000000025",
    category: "retour_garantie",
    question: "Welke garantie zit er op de kattenbak?",
    answer: "Op de kattenbak zit 2 jaar wettelijke garantie op fabricagefouten.",
    sort_order: 2, is_published: true, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "20000000-0000-4000-8000-000000000026",
    category: "retour_garantie",
    question: "Wie betaalt de verzendkosten van een retour?",
    answer: "Zie onze pagina Verzending en retour voor wie de retourkosten draagt en hoe je een retour aanmeldt.",
    sort_order: 3, is_published: true, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
  },
];

const globalKey = "__purelitter_mock_faq__";
type GlobalWithFaq = typeof globalThis & { [globalKey]?: FaqItemRow[] };
const g = globalThis as GlobalWithFaq;

function mockItems(): FaqItemRow[] {
  if (!g[globalKey]) g[globalKey] = seed.map((f) => ({ ...f }));
  return g[globalKey]!;
}

export async function listPublishedFaqs(): Promise<FaqItemRow[]> {
  const supabase = getSupabaseServiceClient();
  if (supabase && isSupabaseConfigured()) {
    const { data } = await supabase
      .from("faq_items")
      .select("*")
      .eq("is_published", true)
      .order("category", { ascending: true })
      .order("sort_order", { ascending: true });
    return data ?? [];
  }
  return [...mockItems()]
    .filter((f) => f.is_published)
    .sort((a, b) => (a.category === b.category ? a.sort_order - b.sort_order : a.category.localeCompare(b.category)));
}

export async function listAllFaqsForAdmin(): Promise<FaqItemRow[]> {
  const supabase = getSupabaseServiceClient();
  if (supabase && isSupabaseConfigured()) {
    const { data } = await supabase
      .from("faq_items")
      .select("*")
      .order("category", { ascending: true })
      .order("sort_order", { ascending: true });
    return data ?? [];
  }
  return [...mockItems()].sort((a, b) => (a.category === b.category ? a.sort_order - b.sort_order : a.category.localeCompare(b.category)));
}

export type FaqInput = {
  category: FaqCategory;
  question: string;
  answer: string;
  sortOrder: number;
  isPublished: boolean;
};

export async function createFaqItem(input: FaqInput): Promise<FaqItemRow> {
  const now = new Date().toISOString();
  const row: FaqItemRow = {
    id: crypto.randomUUID(),
    category: input.category,
    question: input.question,
    answer: input.answer,
    sort_order: input.sortOrder,
    is_published: input.isPublished,
    created_at: now,
    updated_at: now,
  };
  const supabase = getSupabaseServiceClient();
  if (supabase && isSupabaseConfigured()) {
    const { data, error } = await supabase.from("faq_items").insert(row).select("*").single();
    if (error) throw new Error(error.message);
    return data;
  }
  mockItems().push(row);
  return row;
}

export async function updateFaqItem(id: string, input: FaqInput): Promise<FaqItemRow> {
  const now = new Date().toISOString();
  const supabase = getSupabaseServiceClient();
  if (supabase && isSupabaseConfigured()) {
    const { data, error } = await supabase
      .from("faq_items")
      .update({
        category: input.category,
        question: input.question,
        answer: input.answer,
        sort_order: input.sortOrder,
        is_published: input.isPublished,
        updated_at: now,
      })
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return data;
  }
  const items = mockItems();
  const idx = items.findIndex((f) => f.id === id);
  if (idx === -1) throw new Error("Vraag niet gevonden.");
  items[idx] = { ...items[idx], category: input.category, question: input.question, answer: input.answer, sort_order: input.sortOrder, is_published: input.isPublished, updated_at: now };
  return items[idx];
}

export async function deleteFaqItem(id: string): Promise<void> {
  const supabase = getSupabaseServiceClient();
  if (supabase && isSupabaseConfigured()) {
    await supabase.from("faq_items").delete().eq("id", id);
    return;
  }
  const items = mockItems();
  const idx = items.findIndex((f) => f.id === id);
  if (idx !== -1) items.splice(idx, 1);
}
