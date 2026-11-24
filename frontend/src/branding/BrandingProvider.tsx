import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import type { Branding } from '../lib/types';

export type ThemePref = 'light' | 'dark' | 'system';

const FONTS: Record<Branding['font'], string> = {
  system: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  arial: 'Arial, Helvetica, sans-serif',
  verdana: 'Verdana, Geneva, sans-serif',
  trebuchet: "'Trebuchet MS', Helvetica, sans-serif",
  georgia: 'Georgia, "Times New Roman", serif',
};

const SHADOWS: Record<Branding['modal']['shadow'], string> = {
  none: 'none',
  sm: '0 4px 12px rgb(0 0 0 / 0.12)',
  md: '0 12px 28px rgb(0 0 0 / 0.18)',
  lg: '0 20px 45px rgb(0 0 0 / 0.25)',
};

const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

function hexToRgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

/** Gera o CSS com os tokens salvos na tela Aparência (sobrescreve o padrão de tokens.css). */
export function brandingCss(b: Pick<Branding, 'colors' | 'dark' | 'modal' | 'font'> & { fontScale?: number }): string {
  const vars = (c: Record<string, string>) => Object.entries(c).map(([k, v]) => `--color-${kebab(k)}:${v};`).join('');
  const common = `--radius:${b.modal.radius}px;--modal-shadow:${SHADOWS[b.modal.shadow]};--font-family:${FONTS[b.font]};`;
  return [
    `html{font-size:${b.fontScale ?? 112}%;}`,
    `:root{${vars(b.colors)}${common}--modal-overlay:rgb(${hexToRgb(b.colors.sidebar)} / ${b.modal.overlayOpacity});}`,
    `:root[data-theme='dark']{${vars(b.dark)}--modal-overlay:rgb(0 0 0 / ${Math.min(0.9, b.modal.overlayOpacity + 0.1)});}`,
  ].join('\n');
}

function applyCss(css: string) {
  let el = document.getElementById('branding-tokens') as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = 'branding-tokens';
    document.head.appendChild(el);
  }
  el.textContent = css;
}

interface BrandingCtx {
  branding: Branding | undefined;
  theme: 'light' | 'dark';
  themePref: ThemePref;
  setThemePref: (t: ThemePref) => void;
  /** URL do logo para fundo claro/escuro, ou null quando a instalação não enviou logo. */
  logoFor: (bg: 'light' | 'dark') => string | null;
  refresh: () => void;
  preview: (b: Pick<Branding, 'colors' | 'dark' | 'modal' | 'font' | 'fontScale'> | null) => void;
  /** Tamanho do texto escolhido pelo usuário (null = padrão do sistema). */
  userFontScale: number | null;
  setUserFontScale: (v: number | null) => void;
}

const Ctx = createContext<BrandingCtx | null>(null);

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem('atl-theme');
    return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
  } catch {
    return 'system';
  }
}

export function BrandingProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['branding'], queryFn: () => api.get<Branding>('branding'), staleTime: 5 * 60_000 });
  const [themePref, setPref] = useState<ThemePref>(readPref);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  const [previewing, setPreviewing] = useState<Pick<Branding, 'colors' | 'dark' | 'modal' | 'font' | 'fontScale'> | null>(null);
  const [userFontScale, setUserScale] = useState<number | null>(() => {
    try {
      const v = Number(localStorage.getItem('atl-font-scale'));
      return v >= 80 && v <= 150 ? v : null;
    } catch {
      return null;
    }
  });

  // Preferência do usuário vence o padrão do sistema (estilo direto no <html>).
  useEffect(() => {
    document.documentElement.style.fontSize = userFontScale ? `${userFontScale}%` : '';
  }, [userFontScale]);

  const setUserFontScale = useCallback((v: number | null) => {
    setUserScale(v);
    try {
      if (v) localStorage.setItem('atl-font-scale', String(v));
      else localStorage.removeItem('atl-font-scale');
    } catch {
      /* sem armazenamento */
    }
  }, []);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const on = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  const theme: 'light' | 'dark' = themePref === 'system' ? (systemDark ? 'dark' : 'light') : themePref;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  }, [theme]);

  useEffect(() => {
    const src = previewing ?? data;
    if (src) applyCss(brandingCss(src));
  }, [data, previewing]);

  useEffect(() => {
    if (!data) return;
    document.title = data.systemName;
    let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    if (data.logos.favicon.url) link.href = data.logos.favicon.url;
  }, [data]);

  const setThemePref = useCallback((t: ThemePref) => {
    setPref(t);
    try {
      localStorage.setItem('atl-theme', t);
    } catch {
      /* armazenamento indisponível: vale só nesta sessão */
    }
  }, []);

  const value = useMemo<BrandingCtx>(
    () => ({
      branding: data,
      theme,
      themePref,
      setThemePref,
      logoFor: (bg) => (bg === 'dark' ? (data?.logos.dark.url ?? data?.logos.light.url ?? null) : (data?.logos.light.url ?? null)),
      refresh: () => void qc.invalidateQueries({ queryKey: ['branding'] }),
      preview: setPreviewing,
      userFontScale,
      setUserFontScale,
    }),
    [data, theme, themePref, setThemePref, qc, userFontScale, setUserFontScale],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useBranding(): BrandingCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useBranding fora do BrandingProvider');
  return c;
}
