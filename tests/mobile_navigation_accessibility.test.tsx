import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import App from '../App';
import Sidebar from '../components/Sidebar';
import { useStore } from '../store';
import { ViewType } from '../types';
import { mobileGestureThreshold, resolveMobileGestureIntent } from '../utils/mobileNavigationGestures';

const initialCurrentView = useStore.getState().currentView;

describe('Navigation accessibility and active route semantics', () => {
  beforeEach(() => {
    localStorage.clear();
    useStore.setState({
      currentView: 'dashboard',
      currentUser: null,
      entities: [],
      relationships: [],
      isDemoMode: false,
    });
  });

  it('starts in the Home dashboard when there is no explicit route', () => {
    expect(initialCurrentView).toBe('dashboard');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Sidebar navigation active route state', () => {
    const allViews: Array<{ label: string; view: ViewType }> = [
      { label: 'Dashboard', view: 'dashboard' },
      { label: 'Chat', view: 'chat' },
      { label: 'Graph', view: 'chat_graph' },
      { label: 'Calendar', view: 'calendar' },
      { label: 'Analytics', view: 'analytics' },
      { label: 'Library', view: 'knowledge' },
      { label: 'Settings', view: 'settings' },
    ];

    allViews.forEach(({ label, view }) => {
      it(`sets aria-current="page" strictly on ${label} when active, and clears it on others`, () => {
        useStore.setState({ currentView: view });
        render(<Sidebar forceExpanded />);

        allViews.forEach(({ label: otherLabel, view: otherView }) => {
          const btn = screen.getByRole('button', { name: new RegExp(otherLabel, 'i') });
          if (otherView === view) {
            expect(btn).toHaveAttribute('aria-current', 'page');
          } else {
            expect(btn).not.toHaveAttribute('aria-current');
          }
        });
      });
    });

    it('navigating to a new route updates aria-current to the selected destination', () => {
      render(<Sidebar forceExpanded />);
      const chatBtn = screen.getByRole('button', { name: /navigate to chat/i });
      const dashboardBtn = screen.getByRole('button', { name: /navigate to dashboard/i });

      expect(dashboardBtn).toHaveAttribute('aria-current', 'page');
      expect(chatBtn).not.toHaveAttribute('aria-current');

      fireEvent.click(chatBtn);

      expect(useStore.getState().currentView).toBe('chat');
      expect(chatBtn).toHaveAttribute('aria-current', 'page');
      expect(dashboardBtn).not.toHaveAttribute('aria-current');
    });
  });

  describe('Mobile bottom navigation active route state', () => {
    beforeEach(() => {
      // Simulate mobile window viewport
      vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(390);
    });

    it('centers Home, keeps Chat left of center, and updates the active route', () => {
      render(<App />);

      const mobileNav = screen.getByRole('navigation', { name: /mobile navigation/i });
      const homeBtn = screen.getByRole('button', { name: 'Open Home' });
      const chatBtn = screen.getByRole('button', { name: 'Open Chat' });
      const libraryBtn = screen.getByRole('button', { name: 'Open Library' });
      const calendarBtn = screen.getByRole('button', { name: 'Open Calendar' });
      const settingsBtn = screen.getByRole('button', { name: 'Open Settings' });
      const navButtons = [...mobileNav.querySelectorAll('button')];
      expect(navButtons.map(button => button.getAttribute('aria-label'))).toEqual([
        'Open Chat', 'Open Library', 'Open Home', 'Open Calendar', 'Open Settings',
      ]);
      expect(navButtons[0]).toBe(chatBtn);
      expect(navButtons[2]).toBe(homeBtn);
      expect(navButtons[4]).toBe(settingsBtn);

      expect(homeBtn).toHaveAttribute('aria-current', 'page');
      expect(chatBtn).not.toHaveAttribute('aria-current');
      expect(libraryBtn).not.toHaveAttribute('aria-current');

      act(() => { fireEvent.click(chatBtn); });
      expect(useStore.getState().currentView).toBe('chat');
      expect(chatBtn).toHaveAttribute('aria-current', 'page');
      expect(homeBtn).not.toHaveAttribute('aria-current');

      act(() => { fireEvent.click(libraryBtn); });
      expect(useStore.getState().currentView).toBe('knowledge');
      expect(libraryBtn).toHaveAttribute('aria-current', 'page');
      expect(chatBtn).not.toHaveAttribute('aria-current');

      act(() => { fireEvent.click(calendarBtn); });
      expect(useStore.getState().currentView).toBe('calendar');
      expect(calendarBtn).toHaveAttribute('aria-current', 'page');

      act(() => { fireEvent.click(settingsBtn); });
      expect(useStore.getState().currentView).toBe('settings');
      expect(settingsBtn).toHaveAttribute('aria-current', 'page');

      act(() => { fireEvent.click(homeBtn); });
      expect(useStore.getState().currentView).toBe('dashboard');
      expect(homeBtn).toHaveAttribute('aria-current', 'page');
    });

    it('provides accessible dialog semantics and keyboard dismissal for mobile menu overlay', () => {
      render(<App />);

      const menuButton = screen.getByRole('button', { name: /open navigation menu/i });
      act(() => { fireEvent.click(menuButton); });

      const menuDialog = screen.getByRole('dialog', { name: /mobile navigation/i });
      expect(menuDialog).toBeInTheDocument();
      expect(menuDialog).toHaveAttribute('aria-modal', 'true');

      const closeBtn = screen.getByRole('button', { name: /close navigation menu/i });
      expect(closeBtn).toBeInTheDocument();

      // Press Escape to dismiss
      act(() => { fireEvent.keyDown(document, { key: 'Escape' }); });
      expect(screen.queryByRole('dialog', { name: /mobile navigation/i })).not.toBeInTheDocument();
    });
  });
});

describe('touch navigation gesture thresholds', () => {
  it('scales the deliberate drag distance for narrow and wide phones', () => {
    expect(mobileGestureThreshold(320)).toBe(70);
    expect(mobileGestureThreshold(390)).toBe(86);
    expect(mobileGestureThreshold(480)).toBe(96);
  });

  it('requires a deliberate dominant drag and keeps graph/pinch interactions outside the resolver', () => {
    expect(resolveMobileGestureIntent({ deltaX: -60, deltaY: 4, startX: 180, startedAtTop: true, canNavigateToChat: true, distanceThresholdPx: 98 })).toBeNull();
    expect(resolveMobileGestureIntent({ deltaX: -120, deltaY: 4, startX: 180, startedAtTop: true, canNavigateToChat: true, distanceThresholdPx: 98 })).toBe('open-chat');
    expect(resolveMobileGestureIntent({ deltaX: 120, deltaY: 2, startX: 12, startedAtTop: true, canNavigateToChat: true, distanceThresholdPx: 98 })).toBe('open-menu');
    expect(resolveMobileGestureIntent({ deltaX: 10, deltaY: 120, startX: 180, startedAtTop: false, canNavigateToChat: true, distanceThresholdPx: 98 })).toBeNull();
  });
});
