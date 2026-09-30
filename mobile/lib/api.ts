import { API_URL } from './config';
import { normalizeAnalysis } from './normalize';
import type { Analysis } from './types';

export class ApiError extends Error {
  constructor(message: string, readonly code: 'network' | 'rate_limit' | 'quota' | 'unreadable' | 'server') {
    super(message);
  }
}

export async function analyzeImage(base64: string, mediaType: string, installId: string): Promise<Analysis> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/analyze`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-install-id': installId },
      body: JSON.stringify({ image: base64, mediaType, today: new Date().toISOString().slice(0, 10), language: 'nl' }),
    });
  } catch {
    throw new ApiError('Geen verbinding. Probeer het opnieuw.', 'network');
  }
  if (res.status === 402) throw new ApiError('Je gratis scans voor deze week zijn op.', 'quota');
  if (res.status === 429) throw new ApiError('Even rustig aan — probeer het zo opnieuw.', 'rate_limit');
  if (res.status === 422) throw new ApiError('Ik kon hier geen leesbaar document in vinden. Probeer een scherpere foto.', 'unreadable');
  if (!res.ok) throw new ApiError('Er ging iets mis aan onze kant.', 'server');
  return normalizeAnalysis(await res.json());
}
