import React from 'react';
import { createPortal } from 'react-dom';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { applyTheme, getTheme, normalizeTheme, themeIds, THEME_KEY } from '../services/theme';
import AppearanceSettings from '../components/AppearanceSettings';
const css=readFileSync('styles/forest.css','utf8');
afterEach(()=>vi.restoreAllMocks());
beforeEach(()=>{cleanup();localStorage.clear();applyTheme('forest',false);});
describe('Device-local appearance',()=>{
 it('validates stale and invalid values',()=>{expect(normalizeTheme(null)).toBe('forest');expect(normalizeTheme('light')).toBe('forest');});
 it.each(themeIds)('persists and applies %s',id=>{applyTheme(id);expect(getTheme()).toBe(id);expect(localStorage.getItem(THEME_KEY)).toBe(id);});
 it('does not touch personal or demo storage',()=>{localStorage.setItem('flowmate-storage','synthetic personal snapshot');applyTheme('plum');expect(localStorage.getItem('flowmate-storage')).toBe('synthetic personal snapshot');});
 it('accepts other-tab updates without writing them back',()=>{window.dispatchEvent(new StorageEvent('storage',{key:THEME_KEY,newValue:'ocean'}));expect(getTheme()).toBe('ocean');expect(localStorage.getItem(THEME_KEY)).toBeNull();});
 it('supports radio keyboard selection and preserves unsaved DOM',()=>{render(<><input aria-label="Unsaved form" defaultValue="keep me"/><AppearanceSettings/></>);const forest=screen.getByRole('radio',{name:/Forest/});fireEvent.keyDown(forest,{key:'ArrowRight'});expect(screen.getByRole('radio',{name:/Ocean/}).getAttribute('aria-checked')).toBe('true');expect((screen.getByLabelText('Unsaved form') as HTMLInputElement).value).toBe('keep me');});
 it('keeps a usable preview and reports denied persistence',()=>{
 const denied=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new DOMException('Denied','SecurityError');});
 render(<AppearanceSettings/>);fireEvent.click(screen.getByRole('radio',{name:/Plum/}));
 expect(getTheme()).toBe('plum');expect(screen.getByRole('status').textContent).toContain('will not survive a restart');
 denied.mockRestore();fireEvent.click(screen.getByRole('radio',{name:/Ocean/}));expect(screen.getByRole('status').textContent).toBe('Current palette: ocean.');
 });
 it('updates a portal selector without recreating its input',()=>{
 render(createPortal(<><input aria-label="Portal draft" defaultValue="preserved"/><AppearanceSettings/></>,document.body));
 const input=screen.getByLabelText('Portal draft');fireEvent.click(screen.getByRole('radio',{name:/Slate/}));
 expect(screen.getByLabelText('Portal draft')).toBe(input);expect((input as HTMLInputElement).value).toBe('preserved');expect(document.documentElement.dataset.theme).toBe('slate');
 });
 it('does not respond to sessionStorage events',()=>{
 applyTheme('plum',false);window.dispatchEvent(new StorageEvent('storage',{key:THEME_KEY,newValue:'ocean',storageArea:sessionStorage}));expect(getTheme()).toBe('plum');
 });
 it('defines complete primitive ramps for every preset',()=>{for(const id of themeIds){const block=css.match(new RegExp('\\[data-theme="'+id+'"\\]\\s*\\{([^}]+)'))?.[1];expect(block).toBeTruthy();for(const family of ['forest','mint'])for(const step of [50,100,200,300,400,500,600,700,800,900,950])expect(block).toContain('--theme-'+family+'-'+step+':');}});
});
