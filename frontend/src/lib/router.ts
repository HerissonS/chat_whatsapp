import { useEffect, useState } from 'react';

/**
 * Roteamento por hash (#/chat, #/admin/usuarios). Não depende de configuração do servidor
 * e funciona em qualquer subcaminho.
 */
export function useRoute(): string[] {
  const read = () => window.location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = () => setRoute(read());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export function navigate(path: string) {
  window.location.hash = `#/${path.replace(/^\//, '')}`;
}
