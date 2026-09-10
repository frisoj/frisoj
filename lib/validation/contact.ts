import { z } from "zod";

// Contact form validation, shared by the client component and the API
// route. `honeypot` must stay empty — it's a hidden field real visitors
// never fill in; see components/ContactForm.tsx and app/api/contact/route.ts.
export const contactFormSchema = z.object({
  name: z.string().trim().min(1, "Naam is verplicht.").max(200),
  email: z.string().trim().min(1, "E-mailadres is verplicht.").email("Vul een geldig e-mailadres in."),
  orderNumber: z.string().trim().max(50).optional().default(""),
  message: z.string().trim().min(10, "Vertel iets meer, minimaal 10 tekens.").max(5000),
  honeypot: z.string().max(0, "Ongeldig verzoek.").optional().default(""),
});

export type ContactFormInput = z.infer<typeof contactFormSchema>;
