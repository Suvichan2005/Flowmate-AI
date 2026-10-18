import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Brain, ChevronDown, Loader2 } from 'lucide-react';
import { useStore } from '../store';
import { getByokLiveModelOptions, getByokModelOptions, hasAiApiKey, subscribeToApiKeyStatus } from '../services/ai/client';
import { getManagedModelOptions, hasManagedAiIdentity, type ManagedLiveModelOption, type ManagedModelOption, type ReasoningLevel } from '../services/ai/managedClient';
import { defaultReasoningForIdentity, GEMINI_4_ARGON_UNAVAILABLE_REASON, type ModelOption } from '../services/ai/modelCatalog';

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
  const compactRootRef = useRef<HTMLDivElement>(null);
  const compactTriggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => subscribeToApiKeyStatus(configured => setByok(configured)), []);

  useEffect(() => {
    if (!compact || !open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !compactRootRef.current?.contains(event.target)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        compactTriggerRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [compact, open]);

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

  const controls = (
    <div className={compact ? 'space-y-3' : 'grid gap-4 sm:grid-cols-2'}>
      <label className="block text-sm">
        <span className="mb-1.5 block font-medium text-slate-300">Model</span>
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
          {!selected && <option value="__unavailable__">{loading ? 'Checking available models…' : settings.preferred_model ? `Saved model unavailable: ${settings.preferred_model}` : 'No validated model available'}</option>}
          {options.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}
        </select>
      </label>
      <label className="block text-sm sm:col-span-2">
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
          {!selectedLive && <option value="__live_unavailable__">{loading ? 'Checking Live access…' : `Saved Live model unavailable: ${selectedLiveModelId}`}</option>}
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
      <p className="text-[11px] text-slate-500 sm:col-span-2">Live voice uses separate provider session usage; it does not spend chat turns or Dashboard briefing allowances. Regular Live has no selectable reasoning level. Extended Thinking is only listed when the provider and account/key support it.</p>
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
          {availableReasoningOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
      {savedReasoningUnavailable && <p role="status" className="text-xs text-amber-300 sm:col-span-2">Your saved {savedReasoning} reasoning level is not available for this account and model. Choose a supported level before sending another managed request.</p>}
      {selected && <p className="text-xs text-slate-400 sm:col-span-2">{selected.description} {selected.inputTokenLimit && selected.outputTokenLimit ? `Provider limits: ${selected.inputTokenLimit.toLocaleString()} input and ${selected.outputTokenLimit.toLocaleString()} output tokens.` : ''}</p>}
      <p className="text-[11px] text-slate-500 sm:col-span-2">{byok ? 'Uses your key from this browser session.' : privileged ? 'Flowmate managed access · privileged account' : 'Flowmate managed access · approved everyday model only'} {settings.sync_ai_preferences ? 'Model and reasoning choices sync to your account because you opted in in Settings.' : 'Model and reasoning choices are saved on this device only.'}</p>
      {catalogError && <p role="status" className="text-xs text-amber-300 sm:col-span-2">Could not validate model access with the current provider. No alternate model will be selected automatically.</p>}
      {!byok && !privileged && <p className="text-xs text-slate-500 sm:col-span-2">Low and Medium are available on the everyday managed tier; High requires an explicitly privileged account or your own key.</p>}
      {selected?.id === 'gemini-4-argon' && <p className="text-xs text-slate-500 sm:col-span-2">{GEMINI_4_ARGON_UNAVAILABLE_REASON}</p>}
    </div>
  );

  if (!compact) return <section aria-label="Model and reasoning preferences" className="rounded-xl border border-slate-800 bg-slate-900 p-5 space-y-2">
    <h3 className="text-base font-semibold text-slate-100">Model and reasoning</h3>
    <p className="text-sm text-slate-400">Choose the model and effort Flowmate will request. Unsupported choices are rejected instead of silently substituted.</p>
    {controls}
  </section>;

  const compactModelLabel = selectedName.replace(/^Gemini\s+/i, '');
  return <div ref={compactRootRef} className="relative z-30 shrink-0">
    <button
      ref={compactTriggerRef}
      type="button"
      data-testid="ai-model-selector-trigger"
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label={`Model and reasoning: ${selectedName}, ${reasoningNeedsChoice ? 'choose level' : defaultReasoning}`}
      title={`${selectedName} · ${reasoningNeedsChoice ? 'Choose reasoning' : defaultReasoning}`}
      onClick={() => setOpen(value => !value)}
      className="inline-flex h-10 max-w-[10rem] min-w-0 items-center gap-1.5 rounded-xl border border-ideapad-border bg-ideapad-surface px-2.5 text-xs text-ideapad-text transition-colors hover:bg-ideapad-surface-variant focus-visible:outline-offset-2 max-[380px]:max-w-[7.5rem]"
    >
      {loading ? <Loader2 size={14} className="animate-spin shrink-0" /> : <Brain size={14} className="shrink-0 text-ideapad-mint" />}
      <span className="min-w-0 truncate">{compactModelLabel}</span>
      <span className="shrink-0 rounded-md bg-ideapad-surface-variant px-1.5 py-0.5 text-[10px] font-medium text-ideapad-mint">{reasoningNeedsChoice ? 'Set' : defaultReasoning[0].toUpperCase() + defaultReasoning.slice(1)}</span>
      <ChevronDown size={13} className={`shrink-0 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
    </button>
    {open && <div role="dialog" aria-label="Model and reasoning" className="absolute bottom-full right-0 mb-12 w-[min(21rem,calc(100vw-1.5rem))] rounded-2xl border border-ideapad-border bg-ideapad-surface p-3 shadow-2xl sm:p-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-ideapad-text">Model</h3>
        {privileged && <span className="rounded-full bg-ideapad-surface-variant px-2 py-1 text-[10px] text-ideapad-mint">Privileged</span>}
      </div>
      {options.length > 0 ? <div role="listbox" aria-label="Available AI models" className="max-h-48 space-y-1 overflow-y-auto">
        {options.map(model => <button key={model.id} type="button" role="option" aria-selected={selected?.id === model.id} onClick={() => changeModel(model)} className={`flex w-full items-start gap-2 rounded-xl px-3 py-2.5 text-left transition-colors ${selected?.id === model.id ? 'bg-ideapad-surface-variant text-ideapad-text' : 'text-ideapad-muted hover:bg-ideapad-surface-variant/70'}`}>
          <Brain size={15} className={`mt-0.5 shrink-0 ${selected?.id === model.id ? 'text-ideapad-mint' : 'text-ideapad-muted'}`} />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">{model.name}</span>
            <span className="mt-0.5 block text-[11px] leading-4 text-ideapad-muted">{model.description}</span>
          </span>
          {selected?.id === model.id && <span aria-hidden="true" className="mt-1 text-xs text-ideapad-mint">✓</span>}
        </button>)}
      </div> : <p role="status" className="rounded-xl bg-ideapad-surface-variant px-3 py-2 text-xs text-ideapad-muted">{loading ? 'Checking available models…' : catalogError ? 'Model access could not be verified.' : 'No model is available for this provider.'}</p>}
      {selected && <>
        <div className="mt-3 border-t border-ideapad-border pt-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h4 className="text-xs font-semibold text-ideapad-text">Reasoning</h4>
            <span className="text-[10px] text-ideapad-muted">{reasoningNeedsChoice ? 'Choose a supported level' : `${defaultReasoning[0].toUpperCase()} selected`}</span>
          </div>
          <div role="group" aria-label="Reasoning level" className="grid grid-cols-3 gap-1 rounded-xl bg-ideapad-base p-1">
            {reasoningOptions.map(level => <button key={level} type="button" aria-pressed={!reasoningNeedsChoice && defaultReasoning === level} onClick={() => changeReasoning(level)} className={`rounded-lg px-2 py-2 text-xs font-medium transition-colors ${!reasoningNeedsChoice && defaultReasoning === level ? 'bg-ideapad-surface-variant text-ideapad-mint shadow-sm' : 'text-ideapad-muted hover:text-ideapad-text'}`}>{level[0].toUpperCase() + level.slice(1)}</button>)}
          </div>
        </div>
        {savedReasoningUnavailable && <p role="status" className="mt-2 text-[11px] text-amber-300">Your saved reasoning level is unavailable for this model. Choose one above.</p>}
      </>}
    </div>}
  </div>;
};

export default AiModelSelector;
