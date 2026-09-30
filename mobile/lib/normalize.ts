import { isValidIsoDate } from './dates.ts';
import type { Analysis } from './types.ts';

/** Defensive parse: the model output crosses a trust boundary. */
export function normalizeAnalysis(raw: any): Analysis {
  const str = (v: unknown, max = 2000) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
  const urgency = ['low', 'medium', 'high'].includes(raw?.urgency) ? raw.urgency : 'medium';
  return {
    title: str(raw?.title, 120) ?? 'Document',
    sender: str(raw?.sender, 120),
    category: str(raw?.category, 40) ?? 'Overig',
    summary: str(raw?.summary) ?? '',
    urgency,
    deadline: isValidIsoDate(raw?.deadline) ? raw.deadline : null,
    amount: str(raw?.amount, 40),
    actions: Array.isArray(raw?.actions) ? raw.actions.map((a: unknown) => str(a, 300)).filter(Boolean).slice(0, 6) as string[] : [],
    replyDraft: str(raw?.replyDraft, 4000),
  };
}
