/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, type ReactNode } from 'react';
import { useAppData } from '../context/AppDataContext';
import { AppMode, FontFamily, FontFamilyStack, FontSize, FontSizeScale } from '../lib/enums';
import { applyBrand } from '../lib/branding';

interface ThemeSelection {
  appmode?: number;
  fontfamily?: number;
  fontsize?: number;
}

interface ThemeValue {
  applyTheme: (sel: ThemeSelection) => void;
  resetToSaved: () => void;
}

const ThemeContext = createContext<ThemeValue | undefined>(undefined);

function apply(sel: ThemeSelection) {
  const root = document.documentElement;
  const mode = sel.appmode ?? AppMode.Light;
  root.dataset.theme = mode === AppMode.Dark ? 'dark' : 'light';
  root.style.setProperty(
    '--app-font-family',
    FontFamilyStack[sel.fontfamily ?? FontFamily.SegoeUI] ?? FontFamilyStack[FontFamily.SegoeUI],
  );
  root.style.setProperty(
    '--app-font-size',
    FontSizeScale[sel.fontsize ?? FontSize.Default] ?? FontSizeScale[FontSize.Default],
  );
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { currentChampion, settings } = useAppData();

  // Program-wide brand color (set by admins) — applied for every user.
  useEffect(() => {
    applyBrand(settings?.abs_brandcolor);
  }, [settings?.abs_brandcolor]);

  const resetToSaved = useCallback(() => {
    apply({
      appmode: currentChampion?.crd49_appmode as number | undefined,
      fontfamily: currentChampion?.crd49_fontfamily as number | undefined,
      fontsize: currentChampion?.crd49_fontsize as number | undefined,
    });
  }, [currentChampion]);

  useEffect(() => {
    resetToSaved();
  }, [resetToSaved]);

  const applyTheme = useCallback((sel: ThemeSelection) => apply(sel), []);

  return (
    <ThemeContext.Provider value={{ applyTheme, resetToSaved }}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
