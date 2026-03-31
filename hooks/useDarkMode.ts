import { useState, useEffect, useCallback } from 'react';

type Theme = 'light' | 'dark' | 'system';

export function useDarkMode() {
  const [theme, setThemeState] = useState<Theme>(() => {
    const saved = localStorage.getItem('stash_theme') as Theme;
    return saved || 'system';
  });

  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const applyTheme = () => {
      let dark = false;
      if (theme === 'dark') dark = true;
      else if (theme === 'system') dark = window.matchMedia('(prefers-color-scheme: dark)').matches;

      setIsDark(dark);
      document.documentElement.classList.toggle('dark', dark);
    };

    applyTheme();

    // Listen for system theme changes
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => { if (theme === 'system') applyTheme(); };
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, [theme]);

  const setTheme = useCallback((newTheme: Theme) => {
    setThemeState(newTheme);
    localStorage.setItem('stash_theme', newTheme);
  }, []);

  return { theme, isDark, setTheme };
}
