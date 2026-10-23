import React from 'react';
import { ArrowRight, CalendarDays, LibraryBig, MessageSquareText, Network, ShieldCheck, Sparkles } from 'lucide-react';

interface WelcomeLandingProps {
  onContinueAsGuest: () => void;
  onPersonalize: () => void;
  onCreateAccount: () => void;
  onSignIn: () => void;
}

const capabilities = [
  { icon: MessageSquareText, title: 'Work through ideas', description: 'Use Chat to plan, reflect and turn a rough thought into a next step.' },
  { icon: Network, title: 'Connect your work', description: 'Keep goals, tasks and projects connected in one personal workspace.' },
  { icon: CalendarDays, title: 'See your time clearly', description: 'Review your schedule and keep daily priorities in view.' },
  { icon: LibraryBig, title: 'Build useful context', description: 'Save notes and knowledge that help you pick up where you left off.' },
];

const WelcomeLanding: React.FC<WelcomeLandingProps> = ({ onContinueAsGuest, onPersonalize, onCreateAccount, onSignIn }) => (
  <main className="min-h-[100dvh] overflow-y-auto bg-ideapad-base text-ideapad-text">
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-6xl flex-col px-5 py-6 sm:px-8 sm:py-10">
      <header className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-ideapad-mint text-slate-950"><Sparkles size={20} aria-hidden="true" /></span>
        <span className="font-serif text-xl font-semibold">Flowmate</span>
      </header>

      <section className="grid flex-1 items-center gap-10 py-10 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16">
        <div className="max-w-2xl">
          <p className="mb-4 text-xs font-semibold uppercase tracking-[0.2em] text-ideapad-mint">A calmer way to move work forward</p>
          <h1 className="font-serif text-4xl font-semibold leading-tight tracking-tight text-ideapad-text sm:text-5xl lg:text-6xl">Your ideas, plans and next steps in one place.</h1>
          <p className="mt-5 max-w-xl text-base leading-7 text-ideapad-muted sm:text-lg">
            Flowmate brings your goals, conversations, schedule and saved knowledge together, so it is easier to see what matters and decide what to do next.
          </p>
          <div className="mt-8 flex max-w-md flex-col gap-3">
            <button type="button" onClick={onContinueAsGuest} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-ideapad-mint px-5 py-3 font-semibold text-slate-950 transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ideapad-mint">
              Explore as a guest <ArrowRight size={18} aria-hidden="true" />
            </button>
            <button type="button" onClick={onPersonalize} className="min-h-10 rounded-xl px-3 py-2 text-sm text-ideapad-muted hover:bg-ideapad-surface-variant hover:text-ideapad-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ideapad-mint">Personalize first (optional)</button>
            <div className="grid grid-cols-2 gap-3">
              <button type="button" onClick={onCreateAccount} className="min-h-11 rounded-xl border border-ideapad-border px-4 py-2.5 text-sm font-medium text-ideapad-text hover:bg-ideapad-surface-variant focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ideapad-mint">Create an account</button>
              <button type="button" onClick={onSignIn} className="min-h-11 rounded-xl px-4 py-2.5 text-sm font-medium text-ideapad-muted hover:bg-ideapad-surface-variant hover:text-ideapad-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ideapad-mint">Sign in</button>
            </div>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {capabilities.map(({ icon: Icon, title, description }) => (
            <article key={title} className="min-h-36 rounded-2xl border border-ideapad-border bg-ideapad-surface/70 p-5">
              <Icon size={19} className="mb-4 text-ideapad-mint" aria-hidden="true" />
              <h2 className="font-medium text-ideapad-text">{title}</h2>
              <p className="mt-2 text-sm leading-5 text-ideapad-muted">{description}</p>
            </article>
          ))}
          <div className="flex gap-3 rounded-2xl border border-ideapad-border bg-ideapad-surface/40 p-4 sm:col-span-2">
            <ShieldCheck size={18} className="mt-0.5 shrink-0 text-ideapad-mint" aria-hidden="true" />
            <p className="text-xs leading-5 text-ideapad-muted">Start locally without an account. Your workspace stays in this browser unless you explicitly enable cloud sync. AI availability depends on the provider and access currently configured for your account.</p>
          </div>
        </div>
      </section>

      <footer className="border-t border-ideapad-border pt-4 text-xs leading-5 text-ideapad-muted">
        Explore first. Create an account when you want to sign in on another device; workspace sync is a separate choice.
      </footer>
    </div>
  </main>
);

export default WelcomeLanding;
