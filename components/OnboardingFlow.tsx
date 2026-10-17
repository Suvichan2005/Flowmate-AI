import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, LockKeyhole, X } from 'lucide-react';
import { useFocusTrap } from '../utils/accessibility';
import {
  readOnboardingDraft,
  readOnboardingProfile,
  saveOnboardingDraft,
  saveOnboardingProfile,
  type OnboardingProfile,
} from '../services/onboardingProfile';

type ProfileDraft = Omit<OnboardingProfile, 'updatedAt'>;

interface OnboardingFlowProps {
  identity: string;
  onClose: () => void;
  onSignIn: () => void;
  onContinueInChat: () => void;
}

const emptyProfile: ProfileDraft = {
  preferredName: '', ageRange: '', broadRegion: '', role: '', roleContext: '',
  currentGoal: '', currentFriction: '', supportPreference: '', includeInAiRequests: false,
};

const roles = ['Student', 'Working professional', 'Building something', 'Managing home or personal life', 'Other'];

export function targetedQuestion(role: string): { label: string; placeholder: string } {
  if (role === 'Student') return { label: 'What are you studying, and what stage are you at?', placeholder: 'For example: computer science, final year' };
  if (role === 'Working professional') return { label: 'What kind of work or team are you part of?', placeholder: 'For example: product design at a small startup' };
  if (role === 'Building something') return { label: 'What are you building, and who is it for?', placeholder: 'A sentence or two is enough' };
  if (role === 'Managing home or personal life') return { label: 'What routines or responsibilities take most of your attention?', placeholder: 'Share only what would help Flowmate organize your work' };
  return { label: 'What does a typical week look like for you?', placeholder: 'Anything that helps Flowmate make useful suggestions' };
}

export function targetedSupportQuestion(profile: Pick<ProfileDraft, 'role' | 'roleContext' | 'currentGoal' | 'currentFriction'>): { label: string; placeholder: string } {
  const goal = profile.currentGoal.toLowerCase();
  const context = profile.roleContext.toLowerCase();
  const friction = profile.currentFriction.toLowerCase();
  if (/exam|study|course|class|degree|learn/.test(goal)) return { label: 'What would make a good study week realistic for you?', placeholder: 'For example: a few focused sessions, with room for classes and rest' };
  if (/build|project|launch|app|product|work|client/.test(goal)) return { label: 'What is the smallest milestone that would feel like progress?', placeholder: 'A first draft, one finished task, a user conversation…' };
  if (/procrastinat|distract|focus|scroll|put it off/.test(friction)) return { label: 'What most often pulls your attention away from that goal?', placeholder: 'A recurring distraction or moment is enough; no need to share anything private' };
  if (/overwhelm|too much|where to start|overloaded/.test(friction)) return { label: 'Which part feels hardest to start?', placeholder: 'Pick one step, decision, or source of uncertainty' };
  if (/time|busy|schedule|packed|shift|commut/.test(`${friction} ${context}`)) return { label: 'When do you realistically have a little room for this?', placeholder: 'A time window or weekly constraint is enough' };
  if (friction.trim()) return { label: 'When does that obstacle tend to show up?', placeholder: 'A time of day, a type of task, or a situation—only what feels useful' };
  if (profile.role === 'Managing home or personal life') return { label: 'Which routine would you most like help making easier?', placeholder: 'Keep it broad; you can decide the details later' };
  return { label: 'What kind of support would feel most useful?', placeholder: 'A gentle reminder, a clear next step, planning time, or something else' };
}

const OnboardingFlow: React.FC<OnboardingFlowProps> = ({ identity, onClose, onSignIn, onContinueInChat }) => {
  const dialogRef = React.useRef<HTMLElement>(null);
  const saved = useMemo(() => {
    const profile = readOnboardingProfile(identity);
    const draft = readOnboardingDraft(identity);
    if (!profile) return draft;
    if (!draft) return profile;
    return Date.parse(draft.updatedAt) > Date.parse(profile.updatedAt) ? draft : profile;
  }, [identity]);
  const [draft, setDraft] = useState<ProfileDraft>(() => saved ? {
    preferredName: saved.preferredName,
    ageRange: saved.ageRange,
    broadRegion: saved.broadRegion,
    role: saved.role,
    roleContext: saved.roleContext,
    currentGoal: saved.currentGoal,
    currentFriction: saved.currentFriction,
    supportPreference: saved.supportPreference,
    includeInAiRequests: saved.includeInAiRequests,
  } : emptyProfile);
  const [step, setStep] = useState(saved ? 1 : 0);
  const [saveError, setSaveError] = useState('');
  useFocusTrap(dialogRef, true);
  const onCloseRef = React.useRef(onClose);
  onCloseRef.current = onClose;
  const persistDraft = React.useCallback(() => {
    try {
      saveOnboardingDraft(identity, draft);
      setSaveError('');
      return true;
    } catch {
      setSaveError('Your answers could not be saved in this browser. Check available storage; keep this window open so your draft is not lost.');
      return false;
    }
  }, [identity, draft]);
  const persistDraftRef = React.useRef(persistDraft);
  persistDraftRef.current = persistDraft;
  useEffect(() => {
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (persistDraftRef.current()) onCloseRef.current();
      }
    };
    document.addEventListener('keydown', dismiss);
    return () => {
      document.removeEventListener('keydown', dismiss);
      if (trigger?.isConnected) trigger.focus();
    };
  }, []);
  useEffect(() => {
    if (step > 0) persistDraft();
  }, [step, persistDraft]);
  const detailQuestion = targetedQuestion(draft.role);

  const update = <K extends keyof ProfileDraft>(key: K, value: ProfileDraft[K]) => setDraft(current => ({ ...current, [key]: value }));
  const saveAndClose = (continueInChat = false) => {
    try {
      saveOnboardingProfile(identity, draft);
      setSaveError('');
      onClose();
      if (continueInChat) onContinueInChat();
    } catch {
      setSaveError('Your answers could not be saved in this browser. Check available storage and try again; the dialog will stay open so you do not lose this draft.');
    }
  };
  const pauseAndClose = () => {
    if (persistDraft()) onClose();
  };
  const saveThenSignIn = () => {
    if (persistDraft()) onSignIn();
  };
  const inputClass = 'mt-2 w-full rounded-xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-slate-100 placeholder:text-slate-500 outline-none focus:border-emerald-400';
  const supportQuestion = targetedSupportQuestion(draft);
  const heading = step === 0 ? 'Make Flowmate yours' : step === 1 ? 'A little about you' : step === 2 ? 'What fills your week?' : step === 3 ? 'What context matters?' : step === 4 ? 'What would you like to move forward?' : step === 5 ? 'What kind of help fits you?' : 'Your starting point';

  return <div className="fixed inset-0 z-[140] flex items-center justify-center overflow-y-auto bg-slate-950/80 p-4 backdrop-blur-sm" onMouseDown={event => { if (event.target === event.currentTarget) pauseAndClose(); }}>
    <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="flowmate-onboarding-title" className="my-auto w-full max-w-xl rounded-3xl border border-slate-700 bg-slate-900 p-6 shadow-2xl sm:p-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-xs font-medium text-emerald-300"><span className="h-2 w-2 rounded-full bg-emerald-400" /> Your setup · {step === 0 ? 'start' : `${step} of 6`}</div>
        <button type="button" aria-label="Close onboarding" onClick={pauseAndClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white"><X size={19} /></button>
      </div>
      <h1 id="flowmate-onboarding-title" className="font-serif text-3xl font-semibold text-slate-50">{heading}</h1>
      <p className="mt-2 text-sm leading-6 text-slate-300">
        {step === 0 ? 'A few short answers help Flowmate make your goals, plans and routines fit your life. You can skip setup and start as a guest.' : 'Answer what feels useful. You can skip any question and change these details later.'}
      </p>

      {step === 0 && <div className="mt-7 space-y-3">
        <button type="button" onClick={() => setStep(1)} className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-3 font-semibold text-slate-950 hover:bg-emerald-400"><ArrowRight size={18} /> Continue as a guest</button>
        <button type="button" onClick={saveThenSignIn} className="w-full rounded-xl border border-slate-700 px-4 py-3 font-medium text-slate-100 hover:bg-slate-800">Already have an account? Sign in</button>
        <button type="button" onClick={() => saveAndClose()} className="w-full px-4 py-2 text-sm text-slate-400 hover:text-slate-200">Skip setup for now</button>
        <div className="mt-4 space-y-2 text-xs leading-5 text-slate-400">
          <p className="flex items-start gap-2"><LockKeyhole size={15} className="mt-0.5 shrink-0" /> Your answers stay in this browser. Flowmate uses them in AI requests only if you explicitly turn that on.</p>
          <p>Workspace cloud sync starts off; signing in does not enable it. If you later opt in from Settings, standard Firestore storage is not end-to-end encrypted and authorized Firebase project administrators can technically access it. AI context sharing is a separate choice.</p>
        </div>
      </div>}

      {step === 1 && <div className="mt-6 space-y-4">
        <label className="block text-sm text-slate-200">What should Flowmate call you? <span className="text-slate-500">(optional)</span><input autoFocus className={inputClass} maxLength={60} value={draft.preferredName} onChange={event => update('preferredName', event.target.value)} placeholder="Preferred name" /></label>
        <label className="block text-sm text-slate-200">Age range <span className="text-slate-500">(optional)</span><select className={inputClass} value={draft.ageRange} onChange={event => update('ageRange', event.target.value)}><option value="">Skip this</option><option>Under 18</option><option>18–24</option><option>25–34</option><option>35–44</option><option>45–54</option><option>55+</option><option>Prefer not to say</option></select></label>
        <label className="block text-sm text-slate-200">Where are you based? <span className="text-slate-500">(broad region only, optional)</span><input className={inputClass} maxLength={80} value={draft.broadRegion} onChange={event => update('broadRegion', event.target.value)} placeholder="For example: eastern India, Toronto, or UTC−5" /></label>
      </div>}

      {step === 2 && <div className="mt-6 grid gap-2 sm:grid-cols-2">{roles.map(role => <button key={role} type="button" aria-pressed={draft.role === role} onClick={() => update('role', role)} className={`rounded-xl border px-4 py-3 text-left text-sm transition ${draft.role === role ? 'border-emerald-400 bg-emerald-950/50 text-emerald-100' : 'border-slate-700 bg-slate-950/30 text-slate-300 hover:border-slate-500'}`}>{role}</button>)}</div>}

      {step === 3 && <label className="mt-6 block text-sm text-slate-200">{detailQuestion.label} <span className="text-slate-500">(optional)</span><textarea className={`${inputClass} min-h-28 resize-y`} maxLength={240} value={draft.roleContext} onChange={event => update('roleContext', event.target.value)} placeholder={detailQuestion.placeholder} /></label>}

      {step === 4 && <div className="mt-6 space-y-4">
        <label className="block text-sm text-slate-200">What is one thing you want Flowmate to help you move forward? <span className="text-slate-500">(needed to tailor setup)</span><textarea autoFocus className={`${inputClass} min-h-24 resize-y`} maxLength={240} value={draft.currentGoal} onChange={event => update('currentGoal', event.target.value)} placeholder="A goal, project, habit or life admin task" /></label>
        <label className="block text-sm text-slate-200">What tends to get in the way? <span className="text-slate-500">(optional)</span><textarea className={`${inputClass} min-h-20 resize-y`} maxLength={240} value={draft.currentFriction} onChange={event => update('currentFriction', event.target.value)} placeholder="Optional—skip if you prefer" /></label>
      </div>}

      {step === 5 && <label className="mt-6 block text-sm text-slate-200">{supportQuestion.label} <span className="text-slate-500">(optional)</span><textarea autoFocus className={`${inputClass} min-h-24 resize-y`} maxLength={180} value={draft.supportPreference} onChange={event => update('supportPreference', event.target.value)} placeholder={supportQuestion.placeholder} /></label>}

      {step === 6 && <div className="mt-6 space-y-4">
        <div className="rounded-2xl border border-slate-700 bg-slate-950/50 p-4 text-sm leading-6 text-slate-300">{[draft.preferredName && `Call you ${draft.preferredName}`, draft.ageRange && `Age range: ${draft.ageRange}`, draft.broadRegion && `Broad region: ${draft.broadRegion}`, draft.role, draft.roleContext, draft.currentGoal && `Focus: ${draft.currentGoal}`, draft.currentFriction && `Challenge: ${draft.currentFriction}`, draft.supportPreference && `Helpful support: ${draft.supportPreference}`].filter(Boolean).join(' · ') || 'You can start with a blank slate and add context later.'}</div>
        <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-700 p-4 text-sm text-slate-200"><input type="checkbox" className="mt-1 accent-emerald-400" checked={draft.includeInAiRequests} onChange={event => update('includeInAiRequests', event.target.checked)} /><span><span className="font-semibold">Use this context in my AI requests</span><span className="mt-1 block text-xs leading-5 text-slate-400">Off by default. When enabled, only these answers are added as background to your requests. You can change this later in onboarding settings.</span></span></label>
        <p className="text-xs leading-5 text-slate-500">No date of birth, precise address, health details or other sensitive information is needed. You can start using Flowmate without answering these questions.</p>
      </div>}

      {step > 0 && <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2"><button type="button" onClick={() => setStep(current => Math.max(1, current - 1))} disabled={step === 1} className="inline-flex items-center gap-2 rounded-xl border border-slate-700 px-4 py-2.5 text-sm text-slate-300 disabled:invisible"><ArrowLeft size={16} /> Back</button><button type="button" onClick={() => saveAndClose()} className="rounded-xl px-4 py-2.5 text-sm text-slate-400 hover:text-white">Skip for now</button></div>
        {step < 6 ? <div className="flex flex-wrap justify-end gap-2">{step >= 4 && draft.role && draft.currentGoal.trim() && <button type="button" onClick={() => saveAndClose(true)} className="rounded-xl border border-slate-700 px-4 py-2.5 text-sm font-medium text-slate-200 hover:bg-slate-800">Continue setup in chat</button>}<button type="button" onClick={() => setStep(current => current + 1)} disabled={(step === 2 && !draft.role) || (step === 4 && !draft.currentGoal.trim())} className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50">{step === 5 ? 'Review' : 'Continue'} <ArrowRight size={16} /></button></div> : <div className="flex flex-wrap gap-2"><button type="button" onClick={() => saveAndClose(true)} className="rounded-xl border border-slate-700 px-4 py-2.5 text-sm font-medium text-slate-200 hover:bg-slate-800">Continue setup in chat</button><button type="button" onClick={() => saveAndClose()} className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-slate-950 hover:bg-emerald-400"><Check size={16} /> Finish setup</button></div>}
      </div>}
      {step >= 4 && draft.role && draft.currentGoal.trim() && <p className="mt-3 text-center text-[11px] text-slate-500">Continuing in chat uses one normal AI message. Your answers are sent as context only if you enable the option on the review step.</p>}
      {saveError && <p role="alert" className="mt-4 rounded-xl border border-red-500/30 bg-red-950/30 p-3 text-xs leading-5 text-red-200">{saveError}</p>}
      <p className="mt-5 text-center text-[11px] text-slate-500">{step === 0 ? 'A few minutes now, or a blank slate—your choice.' : 'Saved on this device only. Cloud sync is not enabled for this profile.'}</p>
    </section>
  </div>;
};

export default OnboardingFlow;
