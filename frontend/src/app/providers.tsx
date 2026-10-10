import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { getSession, type SessionInfo, type Theme } from './api';
import { ConfirmProvider } from '../components/confirm';
import { UndoProvider } from '../components/undo';
export const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false }, mutations: { retry: false } } });
const AuthContext = createContext<{ session: SessionInfo | undefined; loading: boolean; error: Error | null }>({ session: undefined, loading: true, error: null });
const ThemeContext = createContext<{ theme: Theme; setTheme: (t: Theme) => void }>({ theme: 'light', setTheme: () => { } });
export const useAuth = () => useContext(AuthContext);
export const useTheme = () => useContext(ThemeContext);
function Contexts({ children }: { children: ReactNode }) {
    const query = useQuery({ queryKey: ['session'], queryFn: getSession, staleTime: Infinity });
    const [theme, setThemeState] = useState<Theme>(() => { try { return localStorage.getItem('learnsync:theme') as Theme || 'light' } catch { return 'light' } });
    function setTheme(value: Theme) { setThemeState(value); try { localStorage.setItem('learnsync:theme', value) } catch {/* preference is optional */ } }
    useEffect(() => { const preference = query.data?.user?.preferences.theme; if (preference) setTheme(preference) }, [query.data?.user?.id, query.data?.user?.preferences.theme]);
    useEffect(() => { const media = matchMedia('(prefers-color-scheme: dark)'); const apply = () => { document.documentElement.dataset.theme = theme === 'system' ? (media.matches ? 'dark' : 'light') : theme }; apply(); media.addEventListener('change', apply); return () => media.removeEventListener('change', apply) }, [theme]);
    return <AuthContext.Provider value={{ session: query.data, loading: query.isPending, error: query.error }}><ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider></AuthContext.Provider>
}
export function Providers({ children }: { children: ReactNode }) { return <QueryClientProvider client={queryClient}><Contexts><UndoProvider><ConfirmProvider>{children}</ConfirmProvider></UndoProvider></Contexts></QueryClientProvider> }
