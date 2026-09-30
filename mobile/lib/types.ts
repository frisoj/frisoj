export type Urgency = 'low' | 'medium' | 'high';

export interface Analysis {
  title: string;
  sender: string | null;
  category: string;
  summary: string;
  urgency: Urgency;
  /** ISO date (YYYY-MM-DD) or null when the document has no deadline. */
  deadline: string | null;
  amount: string | null;
  actions: string[];
  replyDraft: string | null;
}

export interface Item extends Analysis {
  id: string;
  createdAt: string;
  done: boolean;
  notificationId: string | null;
}
