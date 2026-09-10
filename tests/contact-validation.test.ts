import { describe, expect, it } from "vitest";
import { contactFormSchema } from "@/lib/validation/contact";

describe("contact form validation", () => {
  it("accepts a valid submission", () => {
    const result = contactFormSchema.safeParse({
      name: "Jan Jansen",
      email: "jan@example.com",
      orderNumber: "KB-2026-123456",
      message: "Ik heb een vraag over mijn bestelling.",
      honeypot: "",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a submission without an order number", () => {
    const result = contactFormSchema.safeParse({
      name: "Jan Jansen",
      email: "jan@example.com",
      message: "Algemene vraag over het product.",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a missing name", () => {
    const result = contactFormSchema.safeParse({
      name: "",
      email: "jan@example.com",
      message: "Een bericht dat lang genoeg is.",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid email", () => {
    const result = contactFormSchema.safeParse({
      name: "Jan Jansen",
      email: "niet-een-email",
      message: "Een bericht dat lang genoeg is.",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a too-short message", () => {
    const result = contactFormSchema.safeParse({
      name: "Jan Jansen",
      email: "jan@example.com",
      message: "Kort",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a filled-in honeypot field", () => {
    const result = contactFormSchema.safeParse({
      name: "Bot",
      email: "bot@example.com",
      message: "Automatisch gegenereerd spambericht.",
      honeypot: "ik-ben-een-bot",
    });
    expect(result.success).toBe(false);
  });
});
