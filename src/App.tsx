import { Outlet } from 'react-router';
import { AuthProvider } from './contexts/auth-context';
import { AuthModalProvider } from './components/auth/AuthModalProvider';
import { ThemeProvider } from './contexts/theme-context';
import { VaultProvider } from './contexts/vault-context';
import { Toaster } from './components/ui/sonner';
import { AppLayout } from './components/layout/app-layout';
import { ErrorBoundary } from './components/ErrorBoundary';
import { FeatureProvider } from './features';
import { useEffect } from 'react';

export default function App() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const workspaceId = params.get('workspaceId');
    const projectId = params.get('projectId');

    let shouldUpdateUrl = false;

    if (workspaceId) {
      localStorage.setItem('vibesdk_workspaceId', workspaceId);
      params.delete('workspaceId');
      shouldUpdateUrl = true;
    }

    if (projectId) {
      localStorage.setItem('vibesdk_projectId', projectId);
      params.delete('projectId');
      shouldUpdateUrl = true;
    }

    if (shouldUpdateUrl) {
      const newUrl = window.location.pathname + (params.toString() ? '?' + params.toString() : '');
      window.history.replaceState({}, document.title, newUrl);
    }
  }, []);

  return (
    <ErrorBoundary>
      <ThemeProvider>
        <FeatureProvider>
          <AuthProvider>
            <VaultProvider>
              <AuthModalProvider>
                <AppLayout>
                  <Outlet />
                </AppLayout>
                <Toaster richColors position="top-right" />
              </AuthModalProvider>
            </VaultProvider>
          </AuthProvider>
        </FeatureProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
