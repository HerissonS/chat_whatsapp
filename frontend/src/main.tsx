import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AuthProvider } from './auth/AuthProvider';
import { BrandingProvider } from './branding/BrandingProvider';
import { LightboxProvider } from './components/Lightbox';
import { ToastProvider } from './components/Toast';
import './styles/index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: true, retry: (n, err) => n < 2 && (err as { status?: number }).status !== 401 && (err as { status?: number }).status !== 403 },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <BrandingProvider>
          <AuthProvider>
            <LightboxProvider>
              <App />
            </LightboxProvider>
          </AuthProvider>
        </BrandingProvider>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
