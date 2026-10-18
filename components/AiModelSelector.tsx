import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Brain, Check, ChevronDown } from 'lucide-react';
import { useStore } from '../store';
import { getByokLiveModelOptions, getByokModelOptions, hasAiApiKey, subscribeToApiKeyStatus } from '../services/ai/client';
import { getManagedModelOptions, hasManagedAiIdentity, type ManagedLiveModelOption, type ManagedModelOption, type ReasoningLevel } from '../services/ai/managedClient';
import { defaultReasoningForIdentity, GEMINI_4_ARGON_UNAVAILABLE_REASON, type ModelOption } from '../services/ai/modelCatalog';

interface PickerPosition {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
  above: boolean;
}

const measurePickerPosition = (anchor: DOMRect, composerTop = anchor.top): PickerPosition => {
  const viewport = window.visualViewport;
  const viewportLeft = viewport?.offsetLeft ?? 0;
  const viewportTop = viewport?.offsetTop ?? 0;
  const viewportWidth = viewport?.width ?? window.innerWidth;
  const viewportHeight = viewport?.height ?? window.innerHeight;
  const viewportRight = viewportLeft + viewportWidth;
  const viewportBottom = viewportTop + viewportHeight;
  const width = Math.max(1, Math.min(288, viewportWidth - 24));
  const aboveSpace = Math.max(0, composerTop - viewportTop - 10);
  const belowSpace = Math.max(0, viewportBottom - anchor.bottom - 10);
  const above = aboveSpace >= 220 || aboveSpace >= belowSpace;
  const availableSpace = above ? aboveSpace : belowSpace;
  const maxHeight = Math.max(120, Math.min(360, availableSpace));
  const left = Math.min(
    Math.max(anchor.right - width, viewportLeft + 12),
    Math.max(viewportLeft + 12, viewportRight - width - 12),
  );

  return {
    left,
    top: above ? composerTop - 8 : anchor.bottom + 8,
    width,
    maxHeight,
    above,
  };
};

const AiModelSelector: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const settings = useStore(state => state.settings);
  const currentUser = useStore(state => state.currentUser);
  const updateSettings = useStore(state => state.updateSettings);
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<ModelOption[]>([]);
  const [liveOptions, setLiveOptions] = useState<ManagedLiveModelOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [catalogError, setCatalogError] = useState(false);
  const [byok, setByok] = useState(hasAiApiKey());
  const [privileged, setPrivileged] = useState(false);
  const [anonymousManaged, setAnonymousManaged] = useState(!currentUser);
  const providerReady = byok || hasManagedAiIdentity();
  const compactRootRef = useRef<HTMLDivElement>(null);
  const compactTriggerRef = useRef<HTMLButtonElement>(null);
  const compactPanelRef = useRef<HTMLDivElement>(null);
  const compactOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [pickerPosition, setPickerPosition] = useState<PickerPosition | null>(null);
  const pickerId = React.useId();

  useEffect(() => subscribeToApiKeyStatus(configured => setByok(configured)), []);

  useEffect(() => {
    if (!compact || !open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      const insideTrigger = compactRootRef.current?.contains(event.target);
      const insidePanel = compactPanelRef.current?.contains(event.target);
      if (!insideTrigger && !insidePanel) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        compactTriggerRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [compact, open]);

  useEffect(() => {
    if (!compact || !open) return;
    let frame = 0;
    const updatePosition = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const anchor = compactTriggerRef.current?.getBoundingClientRect();
        if (anchor) {
          const composerTop = compactRootRef.current?.closest('[data-testid="chat-composer"]')?.getBoundingClientRect().top ?? anchor.top;
          setPickerPosition(measurePickerPosition(anchor, composerTop));
        }
      });
    };
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    window.visualViewport?.addEventListener('resize', updatePosition);
    window.visualViewport?.addEventListener('scroll', updatePosition);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
      window.visualViewport?.removeEventListener('resize', updatePosition);
      window.visualViewport?.removeEventListener('scroll', updatePosition);
    };
  }, [compact, open]);

  useEffect(() => {
    setOpen(false);
    setPickerPosition(null);
  }, [currentUser?.uid, byok]);

  useEffect(() => {
    let current = true;
    const load = async () => {
      setLoading(true);
      setCatalogError(false);
      setPrivileged(false);
      setAnonymousManaged(!currentUser);
      try {
        let next: ModelOption[];
        let nextLive: ManagedLiveModelOption[];
        if (hasAiApiKey()) {
          [next, nextLive] = await Promise.all([getByokModelOptions(), getByokLiveModelOptions()]);
        } else if (hasManagedAiIdentity()) {
          const catalog = await getManagedModelOptions();
          next = catalog.models;
          nextLive = catalog.liveModels;
          setPrivileged(catalog.privileged);
          setAnonymousManaged(catalog.anonymous);
        } else {
          next = [];
          nextLive = [];
        }
        if (current) { setOptions(next); setLiveOptions(nextLive); }
      } catch {
        if (current) {
          setOptions([]);
          setLiveOptions([]);
          setCatalogError(true);
        }
      } finally {
        if (current) setLoading(false);
      }
    };
    void load();
    return () => { current = false; };
  }, [byok, currentUser?.uid]);

  const selected = options.find(model => model.id === settings.preferred_model);
  const savedReasoning = settings.preferred_reasoning_level as ReasoningLevel | undefined;
  const reasoningOptions = selected?.reasoningLevels || [];
  const preferredDefault = defaultReasoningForIdentity(!byok && anonymousManaged);
  const defaultReasoning = selected
    ? (savedReasoning && reasoningOptions.includes(savedReasoning)
      ? savedReasoning
      : reasoningOptions.includes(preferredDefault) ? preferredDefault : reasoningOptions[0] || preferredDefault)
    : preferredDefault;
  const savedReasoningUnavailable = Boolean(selected && savedReasoning && !reasoningOptions.includes(savedReasoning));
  const reasoningNeedsChoice = Boolean(selected && (savedReasoningUnavailable || !reasoningOptions.includes(defaultReasoning)));
  const selectedName = selected?.name || settings.preferred_model;
  const selectedLiveModelId = settings.preferred_live_model || 'gemini-3.8-live';
  const selectedLive = liveOptions.find(model => model.id === selectedLiveModelId);
  const liveReasoning = settings.preferred_live_reasoning_level || 'medium';

  const availableReasoningOptions = useMemo(() => reasoningOptions.map(level => ({
    value: level,
    label: `${level.charAt(0).toUpperCase()}${level.slice(1)}`,
  })), [reasoningOptions]);

  const changeModel = (model: ModelOption) => {
    const nextReasoning = savedReasoning && model.reasoningLevels.includes(savedReasoning)
      ? savedReasoning
      : defaultReasoningForIdentity(!byok && anonymousManaged);
    updateSettings({ preferred_model: model.id, preferred_reasoning_level: model.reasoningLevels.includes(nextReasoning) ? nextReasoning : model.reasoningLevels[0] });
  };

  const changeReasoning = (level: ReasoningLevel) => updateSettings({ preferred_reasoning_level: level });
  const changeLiveModel = (model: ManagedLiveModelOption) => updateSettings({
    preferred_live_model: model.id,
    ...(model.id === 'gemini-3.8-live-extended-thinking'
      ? { preferred_live_reasoning_level: model.reasoningLevels.includes(liveReasoning) ? liveReasoning : 'medium' }
      : {}),
  });

  const openPicker = (focusOptions = false) => {
    const anchor = compactTriggerRef.current?.getBoundingClientRect();
    if (anchor) {
      const composerTop = compactRootRef.current?.closest('[data-testid="chat-composer"]')?.getBoundingClientRect().top ?? anchor.top;
      setPickerPosition(measurePickerPosition(anchor, composerTop));
    }
    setOpen(true);
    if (focusOptions) {
      requestAnimationFrame(() => {
        const selectedIndex = options.findIndex(model => model.id === selected?.id);
        compactOptionRefs.current[selectedIndex >= 0 ? selectedIndex : 0]?.focus();
      });
    }
  };

  const handlePickerKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return;
    const target = event.target;
    if (!(target instanceof HTMLButtonElement) || target.getAttribute('role') !== 'option' || options.length === 0) return;
    event.preventDefault();
    const currentIndex = compactOptionRefs.current.indexOf(target);
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? options.length - 1
        : (currentIndex + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
    compactOptionRefs.current[nextIndex]?.focus();
  };

  const controls = (
    <div className={compact ? 'space-y-3' : 'grid gap-4 sm:grid-cols-2'}>
      <label className="block text-sm">
        <span className="mb-1.5 block font-medium text-slate-300">Text model</span>
        <select
          aria-label="AI model"
          value={selected ? selected.id : '__unavailable__'}
          disabled={loading || options.length === 0}
          onChange={event => {
            const next = options.find(model => model.id === event.target.value);
            if (next) changeModel(next);
          }}
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-emerald-500"
        >
          {!selected && <option value="__unavailable__">{loading ? 'Checking access…' : options.length === 0 ? 'Not connected' : settings.preferred_model ? 'Saved model unavailable' : 'No compatible model'}</option>}
          {options.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}
        </select>
      </label>
      <label className="block text-sm">
        <span className="mb-1.5 block font-medium text-slate-300">Live voice model</span>
        <select
          aria-label="Live voice model"
          value={selectedLive ? selectedLive.id : '__live_unavailable__'}
          disabled={loading || liveOptions.length === 0}
          onChange={event => {
            const next = liveOptions.find(model => model.id === event.target.value);
            if (next) changeLiveModel(next);
          }}
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-emerald-500"
        >
          {!selectedLive && <option value="__live_unavailable__">{loading ? 'Checking access…' : liveOptions.length === 0 ? 'Not connected' : 'Saved model unavailable'}</option>}
          {liveOptions.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}
        </select>
      </label>
      {selectedLive?.id === 'gemini-3.8-live-extended-thinking' && <label className="block text-sm sm:col-span-2">
        <span className="mb-1.5 block font-medium text-slate-300">Live reasoning</span>
        <select
          aria-label="Live reasoning level"
          value={liveReasoning}
          onChange={event => updateSettings({ preferred_live_reasoning_level: event.target.value as 'low' | 'medium' | 'high' })}
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-emerald-500"
        >
          {selectedLive.reasoningLevels.map(level => <option key={level} value={level}>{level[0].toUpperCase() + level.slice(1)}</option>)}
        </select>
      </label>}
      <p className="text-[11px] text-slate-500 sm:col-span-2">Voice use is tracked separately from chat and briefings.</p>
      <label className="block text-sm">
        <span className="mb-1.5 block font-medium text-slate-300">Reasoning</span>
        <select
          aria-label="AI reasoning level"
          value={!reasoningNeedsChoice && availableReasoningOptions.some(option => option.value === defaultReasoning) ? defaultReasoning : ''}
          disabled={!selected || loading}
          onChange={event => changeReasoning(event.target.value as ReasoningLevel)}
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-emerald-500"
        >
          {reasoningNeedsChoice && <option value="">Choose a supported level</option>}
          {!reasoningNeedsChoice && availableReasoningOptions.length === 0 && <option value="">Unavailable for this model</option>}
          {availableReasoningOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
      {savedReasoningUnavailable && <p role="status" className="text-xs text-amber-300 sm:col-span-2">Your saved {savedReasoning} reasoning level is not available for this account and model. Choose a supported level before sending another managed request.</p>}
      {selected && <details className="text-xs text-slate-400 sm:col-span-2">
        <summary className="w-fit cursor-pointer text-slate-300">Model capabilities</summary>
        <p className="mt-1.5 leading-5">{selected.description} {selected.inputTokenLimit && selected.outputTokenLimit ? `Provider limits: ${selected.inputTokenLimit.toLocaleString()} input and ${selected.outputTokenLimit.toLocaleString()} output tokens.` : ''}</p>
      </details>}
      <p role={catalogError || !selected ? 'status' : undefined} className={`text-[11px] sm:col-span-2 ${catalogError ? 'text-amber-300' : 'text-slate-500'}`}>
        {catalogError ? 'Model access could not be verified. No alternate model was selected.' : !providerReady ? 'No AI provider is available for this session.' : byok ? 'Using your key for this browser session.' : privileged ? 'Flowmate managed access · owner account.' : 'Flowmate managed access · supported everyday models.'}
        {' '}{settings.sync_ai_preferences ? 'Preferences sync is on.' : 'Preferences stay on this device.'}
      </p>
      {selected?.id === 'gemini-4-argon' && <p className="text-xs text-slate-500 sm:col-span-2">{GEMINI_4_ARGON_UNAVAILABLE_REASON}</p>}
    </div>
  );

  if (!compact) return <section aria-label="Model and reasoning preferences" className="space-y-3 border-b border-ideapad-border pb-5">
    <h3 className="text-base font-semibold text-slate-100">Model and reasoning</h3>
    <p className="text-sm text-slate-400">Choose the models and reasoning Flowmate should use for text and voice.</p>
    {controls}
  </section>;

  const compactAccessibleLabel = loading
    ? `Choose model. Checking access. Current saved model: ${selectedName}.`
    : !providerReady
      ? 'Model unavailable. Add a Gemini key in Settings to choose a model.'
      : `Choose model and reasoning. Current model: ${selectedName}; reasoning: ${reasoningNeedsChoice ? 'needs selection' : defaultReasoning}.`;
  const picker = open && pickerPosition && typeof document !== 'undefined' ? createPortal(
    <div
      ref={compactPanelRef}
      id={pickerId}
      role="dialog"
      aria-label="Model and reasoning"
      onKeyDown={handlePickerKeyDown}
      data-testid="ai-model-selector-popover"
      className="fixed z-[90] overflow-y-auto overscroll-contain rounded-2xl border border-ideapad-border bg-ideapad-surface p-2.5 shadow-2xl shadow-black/30 [scrollbar-width:thin]"
      style={{
        left: pickerPosition.left,
        top: pickerPosition.top,
        width: pickerPosition.width,
        maxHeight: pickerPosition.maxHeight,
        transform: pickerPosition.above ? 'translateY(-100%)' : undefined,
        WebkitOverflowScrolling: 'touch',
      }}
    >
      <div className="mb-1 flex items-center gap-1.5 px-2 py-1 text-[10px] text-ideapad-muted">
        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-ideapad-mint" />
        <span>{byok ? 'Your API key' : privileged ? 'Owner access' : 'Flowmate access'}</span>
      </div>
      {options.length > 0 ? <div role="listbox" aria-label="Available AI models" className="space-y-0.5">
        {options.map((model, index) => <button
          key={model.id}
          ref={node => { compactOptionRefs.current[index] = node; }}
          type="button"
          role="option"
          aria-selected={selected?.id === model.id}
          onClick={() => changeModel(model)}
          className={`flex min-h-10 w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ideapad-mint ${selected?.id === model.id ? 'bg-ideapad-surface-variant text-ideapad-text' : 'text-ideapad-muted hover:bg-ideapad-surface-variant/70 hover:text-ideapad-text'}`}
        >
          <span aria-hidden="true" className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md ${selected?.id === model.id ? 'bg-ideapad-mint/15 text-ideapad-mint' : 'text-ideapad-muted'}`}>
            {selected?.id === model.id ? <Check size={13} /> : <Brain size={13} />}
          </span>
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{model.name}</span>
          {selected?.id === model.id && <span className="sr-only">Selected</span>}
        </button>)}
      </div> : <p role="status" className="rounded-xl bg-ideapad-surface-variant px-3 py-2 text-xs leading-5 text-ideapad-muted">{loading ? 'Checking available models…' : catalogError ? 'Model access could not be verified. No alternate was selected.' : settings.preferred_model ? `Saved model unavailable: ${settings.preferred_model}` : 'No model is available for this provider.'}</p>}
      {selected && reasoningOptions.length > 0 && <div className="mt-2 border-t border-ideapad-border/70 px-1 pt-2">
        <div className="mb-1.5 flex items-center justify-between gap-2 px-1">
          <h4 className="text-xs font-medium text-ideapad-text">Reasoning</h4>
          <span className="text-[10px] text-ideapad-muted">{reasoningNeedsChoice ? 'Choose a level' : defaultReasoning[0].toUpperCase() + defaultReasoning.slice(1)}</span>
        </div>
        <div role="group" aria-label="Reasoning level" className={`grid ${reasoningOptions.length >= 4 ? 'grid-cols-4' : 'grid-cols-3'} gap-1 rounded-xl bg-ideapad-base p-1`}>
          {reasoningOptions.map(level => <button key={level} type="button" aria-pressed={!reasoningNeedsChoice && defaultReasoning === level} onClick={() => changeReasoning(level)} className={`min-h-9 rounded-lg px-1.5 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-ideapad-mint ${!reasoningNeedsChoice && defaultReasoning === level ? 'bg-ideapad-surface-variant text-ideapad-mint shadow-sm' : 'text-ideapad-muted hover:text-ideapad-text'}`}>{level[0].toUpperCase() + level.slice(1)}</button>)}
        </div>
        {savedReasoningUnavailable && <p role="status" className="mt-2 px-1 text-[11px] leading-4 text-amber-300">The saved reasoning level is unavailable here. Choose a supported level.</p>}
      </div>}
      {selected?.id === 'gemini-4-argon' && <p role="status" className="mt-2 px-1 text-[11px] leading-4 text-amber-300">{GEMINI_4_ARGON_UNAVAILABLE_REASON}</p>}
    </div>,
    document.body,
  ) : null;

  return <div ref={compactRootRef} className="relative z-30 flex shrink-0">
    <button
      ref={compactTriggerRef}
      type="button"
      data-testid="ai-model-selector-trigger"
      aria-controls={open ? pickerId : undefined}
      aria-haspopup="dialog"
      aria-expanded={open}
      disabled={!providerReady}
      aria-label={compactAccessibleLabel}
      title={providerReady ? `${selectedName} · ${reasoningNeedsChoice ? 'Choose reasoning' : defaultReasoning}` : 'Add your Gemini key in Settings to choose a model'}
      onClick={event => open ? setOpen(false) : openPicker(event.detail === 0)}
      onKeyDown={event => {
        if (event.key === 'ArrowDown' && !open) {
          event.preventDefault();
          openPicker(true);
        }
      }}
      className={`inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-ideapad-border px-2.5 transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ideapad-mint active:scale-[0.98] ${!providerReady ? 'cursor-not-allowed text-ideapad-muted/55' : open ? 'bg-ideapad-surface-variant text-ideapad-mint' : 'bg-transparent text-ideapad-muted hover:bg-ideapad-surface-variant hover:text-ideapad-text'}`}
    >
      <Brain size={17} className={open ? 'text-ideapad-mint' : ''} aria-hidden="true" />
      <span className="text-xs font-medium">Model</span>
      <span aria-hidden="true" className="rounded-full bg-ideapad-surface-variant px-1.5 py-0.5 text-[10px] font-medium leading-none text-ideapad-muted">{reasoningNeedsChoice ? 'Set' : defaultReasoning}</span>
      <ChevronDown size={13} className={`text-ideapad-muted transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      <span className="sr-only">{loading ? 'Models loading' : `${selectedName}, ${reasoningNeedsChoice ? 'reasoning needs selection' : `${defaultReasoning} reasoning`}`}</span>
    </button>
    {picker}
  </div>;
};

export default AiModelSelector;
