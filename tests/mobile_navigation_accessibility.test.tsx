import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import App from '../App';
import Sidebar from '../components/Sidebar';
import { useStore } from '../store';
import { ViewType } from '../types';

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
      { label: 'Timeline', view: 'timeline' },
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

    it('updates aria-current="page" on bottom navigation buttons when switching routes', () => {
      render(<App />);

      const mobileNav = screen.getByRole('navigation', { name: /mobile navigation/i });
      const homeBtn = screen.getByRole('button', { name: 'Home' });
      const chatBtn = screen.getByRole('button', { name: 'Chat' });
      const graphBtn = screen.getByRole('button', { name: 'Graph' });
      const calendarBtn = screen.getByRole('button', { name: 'Calendar' });

      // Initially on dashboard (Home)
      expect(homeBtn).toHaveAttribute('aria-current', 'page');
      expect(chatBtn).not.toHaveAttribute('aria-current');
      expect(graphBtn).not.toHaveAttribute('aria-current');
      expect(calendarBtn).not.toHaveAttribute('aria-current');

      // Click Chat
      act(() => { fireEvent.click(chatBtn); });
      expect(useStore.getState().currentView).toBe('chat');
      expect(chatBtn).toHaveAttribute('aria-current', 'page');
      expect(homeBtn).not.toHaveAttribute('aria-current');
      expect(graphBtn).not.toHaveAttribute('aria-current');
      expect(calendarBtn).not.toHaveAttribute('aria-current');

      // Click Graph
      act(() => { fireEvent.click(graphBtn); });
      expect(useStore.getState().currentView).toBe('chat_graph');
      expect(graphBtn).toHaveAttribute('aria-current', 'page');
      expect(chatBtn).not.toHaveAttribute('aria-current');
      expect(homeBtn).not.toHaveAttribute('aria-current');
      expect(calendarBtn).not.toHaveAttribute('aria-current');

      // Click Calendar
      act(() => { fireEvent.click(calendarBtn); });
      expect(useStore.getState().currentView).toBe('calendar');
      expect(calendarBtn).toHaveAttribute('aria-current', 'page');
      expect(graphBtn).not.toHaveAttribute('aria-current');
      expect(chatBtn).not.toHaveAttribute('aria-current');
      expect(homeBtn).not.toHaveAttribute('aria-current');

      // Click Home
      act(() => { fireEvent.click(homeBtn); });
      expect(useStore.getState().currentView).toBe('dashboard');
      expect(homeBtn).toHaveAttribute('aria-current', 'page');
      expect(calendarBtn).not.toHaveAttribute('aria-current');
    });

    it('provides accessible dialog semantics and keyboard dismissal for mobile menu overlay', () => {
      render(<App />);

      const moreBtn = screen.getByRole('button', { name: 'More' });
      act(() => { fireEvent.click(moreBtn); });

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
