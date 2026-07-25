import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  formatBytes,
  formatDate,
  formatMessage,
  formatNumber,
  listLocales,
  missingKeyDiagnostics,
  normalizeLocale,
  type AppLocale,
  type FormatVars,
  type MessageKey,
} from "./messages";

interface LocaleContextValue {
  locale: AppLocale;
  setLocale: (locale: AppLocale) => Promise<void>;
  ready: boolean;
  t: (key: MessageKey, vars?: FormatVars) => string;
  formatDate: (
    value: Date | number,
    options?: Intl.DateTimeFormatOptions,
  ) => string;
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
  formatBytes: (bytes: number) => string;
  locales: AppLocale[];
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

const missingKeys = new Set<string>();

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<AppLocale>("en-US");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const bootstrap = async () => {
      try {
        const settings = await window.translunar.getShellSettings();
        if (settings.locale) {
          if (!cancelled) setLocaleState(settings.locale);
          return;
        }
        const system = await window.translunar.getSystemLocale();
        if (!cancelled) setLocaleState(normalizeLocale(system));
      } catch {
        if (!cancelled) setLocaleState(normalizeLocale(navigator.language));
      } finally {
        if (!cancelled) setReady(true);
      }
    };
    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  const setLocale = useCallback(async (next: AppLocale) => {
    setLocaleState(next);
    document.documentElement.lang = next;
    await window.translunar.updateShellSettings({ locale: next });
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo<LocaleContextValue>(
    () => ({
      locale,
      setLocale,
      ready,
      locales: listLocales(),
      t: (key, vars) => {
        const diagnostic = missingKeyDiagnostics(locale, key);
        if (diagnostic && import.meta.env.MODE === "test") {
          missingKeys.add(diagnostic);
        }
        return formatMessage(locale, key, vars);
      },
      formatDate: (value, options) => formatDate(locale, value, options),
      formatNumber: (value, options) => formatNumber(locale, value, options),
      formatBytes: (bytes) => formatBytes(locale, bytes),
    }),
    [locale, ready, setLocale],
  );

  return (
    <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
  );
}

export function useLocale(): LocaleContextValue {
  const value = useContext(LocaleContext);
  if (!value) {
    throw new Error("useLocale must be used within LocaleProvider");
  }
  return value;
}

export function drainMissingKeyDiagnostics(): string[] {
  const values = [...missingKeys];
  missingKeys.clear();
  return values;
}
