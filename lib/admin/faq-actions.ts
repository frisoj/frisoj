"use server";

import { revalidatePath } from "next/cache";
import { createFaqItem, deleteFaqItem, updateFaqItem } from "@/lib/faq";
import { FAQ_CATEGORIES, type FaqCategory } from "@/lib/supabase/types";

function inputFromFormData(formData: FormData) {
  const category = String(formData.get("category")) as FaqCategory;
  if (!FAQ_CATEGORIES.includes(category)) throw new Error("Ongeldige categorie.");
  return {
    category,
    question: String(formData.get("question") ?? "").trim(),
    answer: String(formData.get("answer") ?? "").trim(),
    sortOrder: Number(formData.get("sortOrder") ?? 0) || 0,
    isPublished: formData.get("isPublished") === "on",
  };
}

export async function createFaqAction(formData: FormData) {
  const input = inputFromFormData(formData);
  if (!input.question || !input.answer) throw new Error("Vraag en antwoord zijn verplicht.");
  await createFaqItem(input);
  revalidatePath("/admin/faq");
  revalidatePath("/veelgestelde-vragen");
  revalidatePath("/zelfreinigende-kattenbak");
}

export async function updateFaqAction(id: string, formData: FormData) {
  const input = inputFromFormData(formData);
  if (!input.question || !input.answer) throw new Error("Vraag en antwoord zijn verplicht.");
  await updateFaqItem(id, input);
  revalidatePath("/admin/faq");
  revalidatePath("/veelgestelde-vragen");
  revalidatePath("/zelfreinigende-kattenbak");
}

export async function deleteFaqAction(formData: FormData) {
  const id = String(formData.get("id"));
  await deleteFaqItem(id);
  revalidatePath("/admin/faq");
  revalidatePath("/veelgestelde-vragen");
  revalidatePath("/zelfreinigende-kattenbak");
}
