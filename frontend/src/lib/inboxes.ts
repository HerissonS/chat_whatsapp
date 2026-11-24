import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export interface Inbox {
  id: number;
  name: string;
  waState: string;
  waNumber: string | null;
  evolutionInstance: string | null;
  active: boolean;
}

/** Caixas de entrada que o usuário pode ver (administrador: todas). */
export function useInboxes() {
  return useQuery({ queryKey: ['inboxes'], queryFn: () => api.get<Inbox[]>('inboxes'), staleTime: 60_000 });
}
