import React, { createContext, useContext, useEffect, useState } from 'react';

type Theme = 'light' | 'dark' | 'system';

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: 'dark',
  setTheme: () => { },
});

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

interface ThemeProviderProps {
  children: React.ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(() => {
    const savedTheme = localStorage.getItem('theme') as Theme;
    return savedTheme || 'dark';
  });

  const applyTheme = (newTheme: Theme) => {
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark');

    if (newTheme === 'system') {
      const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      root.classList.add(systemTheme);
    } else {
      root.classList.add(newTheme);
    }
  };

  useEffect(() => {
    applyTheme(theme);

    // Listen for system theme changes
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => {
      if (theme === 'system') {
        applyTheme('system');
      }
    };

    // Listen for messages from parent Delegate iframe
    const handleMessage = (event: MessageEvent) => {
      // Theme sync
      if (event.data?.type === 'delegate-theme-sync' && (event.data.theme === 'dark' || event.data.theme === 'light')) {
        const newTheme = event.data.theme as Theme;
        setTheme(newTheme);
        localStorage.setItem('theme', newTheme);
        applyTheme(newTheme);
      }
      // Workspace context injection from Delegate
      if (event.data?.type === 'delegate-context-inject' && event.data.context) {
        try {
          localStorage.setItem('vibesdk_delegateContext', JSON.stringify(event.data.context));
        } catch {
          // Non-fatal: localStorage quota or serialization error
        }
      }
    };

    mediaQuery.addEventListener('change', handleChange);
    window.addEventListener('message', handleMessage);
    return () => {
      mediaQuery.removeEventListener('change', handleChange);
      window.removeEventListener('message', handleMessage);
    };
  }, [theme]);

  const handleSetTheme = (newTheme: Theme) => {
    setTheme(newTheme);
    localStorage.setItem('theme', newTheme);
    // Apply theme immediately for instant feedback
    applyTheme(newTheme);
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme: handleSetTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}