import { useSyncExternalStore } from 'react';
export const themeIds = ['forest', 'ocean', 'plum', 'slate'] as const;
export type ThemeId = typeof themeIds[number];
export const THEME_KEY = 'flowmate.appearance.v1';
export const normalizeTheme = (value: unknown): ThemeId => themeIds.includes(value as ThemeId) ? value as ThemeId : 'forest';
const listeners = new Set<() => void>();
let persistenceAvailable = true;
export function getTheme(): ThemeId { return normalizeTheme(document.documentElement.dataset.theme); }
export function applyTheme(value: unknown, persist = true) {
 const id = normalizeTheme(value);
 document.documentElement.dataset.theme = id;
 const canvas = getComputedStyle(document.body).backgroundColor;
 document.querySelector('meta[name="theme-color"]')?.setAttribute('content', canvas);
 if (persist) { try { localStorage.setItem(THEME_KEY, id); persistenceAvailable = true; } catch { persistenceAvailable = false; } }
 listeners.forEach(listener => listener());
 window.dispatchEvent(new CustomEvent('flowmate:theme', { detail: id }));
 return id;
}
export function canPersistTheme() { return persistenceAvailable; }
function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function useTheme() { return useSyncExternalStore(subscribe, getTheme, () => 'forest' as ThemeId); }
export function themeColor(token: string) { return getComputedStyle(document.documentElement).getPropertyValue(token).trim(); }
window.addEventListener('storage', event => {
 // Reading storage properties can itself throw in restricted browser contexts.
 try { if (event.storageArea && event.storageArea !== localStorage) return; } catch { return; }
 if (event.key === THEME_KEY || event.key === null) applyTheme(event.newValue, false);
});
