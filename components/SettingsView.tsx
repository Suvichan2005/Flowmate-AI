import AppearanceSettings from './AppearanceSettings';
import React, { useRef, useState, useEffect } from 'react';
import { useFocusTrap } from '../utils/accessibility';
import { useStore } from '../store';
import { AlertTriangle, Download, Upload, FileText, Trash2, Bot, EyeOff, MapPin, Navigation, RefreshCw, Shield, Activity, Brain, Clock, Plus, ChevronDown } from 'lucide-react';
import { exportToMarkdown, downloadMarkdown } from '../utils/exportMarkdown';
import {
  liveContext,
  privacyManager,
  DeviceLocationWithFreshness,
  GeolocationPermissionState,
  SensitiveAccessLogEntry,
  DEFAULT_PRIVACY_POLICY,
  extractMemoryItem,
  extractSituationalItem,
  MemoryCategory,
} from '../services/context';
import { UserSettings, FeatureToggles } from '../types';
import { getEphemeralApiKey, setEphemeralApiKey, hasAiApiKey } from '../services/ai/client';
import { hasManagedAiIdentity } from '../services/ai/managedClient';
import ManagedAiAdminPanel from './ManagedAiAdminPanel';
import AiModelSelector from './AiModelSelector';
import ManagedAiUsagePanel from './ManagedAiUsagePanel';
import { clearOnboardingProfile } from '../services/onboardingProfile';
import { hasWorkspaceCloudSyncConsent, setWorkspaceCloudSyncConsentForUser, subscribeToWorkspaceCloudSyncConsent } from '../services/workspaceSyncConsent';

const DEFAULT_FEATURE_TOGGLES: FeatureToggles = {
  food_tracking: true,
  attendance_tracking: true,
  people_tracking: true,
  gamification: true,
  quick_streaks: true,
};

const SettingsView: React.FC<{ onShowOnboarding?: () => void }> = ({ onShowOnboarding }) => {
  const { settings, updateSettings, entities, relationships, messages, importData, kernelEntities, applyOperations, deleteEntity } = useStore();
  const currentUser = useStore(state => state.currentUser);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [liveReading, setLiveReading] = useState<DeviceLocationWithFreshness | null>(() => liveContext.getLastReading());
  const [permission, setPermission] = useState<GeolocationPermissionState>('prompt');
  const [isAcquiring, setIsAcquiring] = useState(false);
  const [reverseGeoAddress, setReverseGeoAddress] = useState<string | null>(null);
  const [auditLogs, setAuditLogs] = useState<SensitiveAccessLogEntry[]>(() => privacyManager.getAccessLogs());

  // Memory UI State (P1-07)
  const [newMemoryContent, setNewMemoryContent] = useState('');
  const [newMemoryCategory, setNewMemoryCategory] = useState<MemoryCategory>('preference');

  // Ephemeral Gemini API Key State
  const [apiKeyInput, setApiKeyInput] = useState<string>(() => getEphemeralApiKey() || '');
  const [keySavedToast, setKeySavedToast] = useState(false);
  const [profileMessage, setProfileMessage] = useState('');
  const [workspaceSyncEnabled, setWorkspaceSyncEnabled] = useState(() => hasWorkspaceCloudSyncConsent(currentUser?.uid));
  const [showWorkspaceSyncConsent, setShowWorkspaceSyncConsent] = useState(false);
  const [workspaceSyncConsentAcknowledged, setWorkspaceSyncConsentAcknowledged] = useState(false);
  const [workspaceSyncMessage, setWorkspaceSyncMessage] = useState('');
  const workspaceSyncDialogRef = useRef<HTMLElement>(null);
  const workspaceSyncTriggerRef = useRef<HTMLButtonElement>(null);
  const workspaceSyncFocusReturnRef = useRef<HTMLElement | null>(null);

  useFocusTrap(workspaceSyncDialogRef, showWorkspaceSyncConsent);

  useEffect(() => {
    if (!showWorkspaceSyncConsent) return;
    workspaceSyncFocusReturnRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setShowWorkspaceSyncConsent(false);
      setWorkspaceSyncConsentAcknowledged(false);
    };
    document.addEventListener('keydown', dismiss);
    return () => {
      document.removeEventListener('keydown', dismiss);
      const target = workspaceSyncFocusReturnRef.current;
      requestAnimationFrame(() => {
        if (target?.isConnected) target.focus();
        else workspaceSyncTriggerRef.current?.focus();
      });
    };
  }, [showWorkspaceSyncConsent]);

  useEffect(() => {
    setWorkspaceSyncEnabled(hasWorkspaceCloudSyncConsent(currentUser?.uid));
    setWorkspaceSyncMessage('');
    setShowWorkspaceSyncConsent(false);
    setWorkspaceSyncConsentAcknowledged(false);
  }, [currentUser?.uid]);

  useEffect(() => subscribeToWorkspaceCloudSyncConsent(({ uid, enabled }) => {
    if (uid !== currentUser?.uid) return;
    setWorkspaceSyncEnabled(enabled);
    setWorkspaceSyncMessage(enabled
      ? 'Cloud sync is enabled for this account on this device.'
      : 'Cloud sync is off on this device. Existing cloud data was not deleted.');
  }), [currentUser?.uid]);

  const disableWorkspaceCloudSync = () => {
    if (!currentUser || !setWorkspaceCloudSyncConsentForUser(currentUser.uid, false)) {
      setWorkspaceSyncMessage('Could not save this privacy choice. Your workspace remains local until consent can be saved.');
      return;
    }
    setWorkspaceSyncEnabled(false);
    setWorkspaceSyncMessage('Cloud sync is off on this device. Existing cloud data was not deleted. A write already in flight may finish.');
  };

  const enableWorkspaceCloudSync = () => {
    if (!currentUser || !workspaceSyncConsentAcknowledged) return;
    if (!setWorkspaceCloudSyncConsentForUser(currentUser.uid, true)) {
      setWorkspaceSyncMessage('Could not save this privacy choice. Cloud sync remains off.');
      return;
    }
    setWorkspaceSyncEnabled(true);
    setShowWorkspaceSyncConsent(false);
    setWorkspaceSyncConsentAcknowledged(false);
    setWorkspaceSyncMessage('Cloud sync is enabled for this account on this device. Other devices require their own choice.');
  };

  const closeWorkspaceSyncConsent = () => {
    setShowWorkspaceSyncConsent(false);
    setWorkspaceSyncConsentAcknowledged(false);
  };

  const memoryEntities = Object.values(kernelEntities || {})
    .filter(e => e.schema_id === 'system/memory_item' && e.lifecycle.deleted_at === null)
    .map(extractMemoryItem);

  const situationalEntities = Object.values(kernelEntities || {})
    .filter(e => e.schema_id === 'system/situational_state' && e.lifecycle.deleted_at === null)
    .map(extractSituationalItem);

  useEffect(() => {
    liveContext.checkPermission().then(p => setPermission(p));
    const r = liveContext.getLastReading();
    if (r) {
      setLiveReading(r);
    }
    setAuditLogs(privacyManager.getAccessLogs());
  }, []);

  const currentPrivacyPolicy = settings.privacy_preferences || DEFAULT_PRIVACY_POLICY;

  const handleUpdateCapabilityMode = (capability: 'device_location', mode: 'allow' | 'ask' | 'deny') => {
    const updated = {
      ...currentPrivacyPolicy,
      capabilities: {
        ...currentPrivacyPolicy.capabilities,
        [capability]: {
          ...currentPrivacyPolicy.capabilities[capability],
          read: mode,
        },
      },
    };
    handleChange('privacy_preferences', updated);
  };

  const handleAcquireLocation = async () => {
    setIsAcquiring(true);
    try {
      const reading = await liveContext.acquireLocation({
        forceFresh: true,
        reason: 'User manual location check in Settings',
      });
      setLiveReading(reading);
      const perm = await liveContext.checkPermission();
      setPermission(perm);
      if (reading) {
        privacyManager.recordAccess(
          'device_location',
          'read',
          'User manual location check in Settings',
          settings.privacy_preferences,
        );
        const address = await liveContext.reverseGeocode(reading.lat, reading.lon);
        setReverseGeoAddress(address);
      }
      setAuditLogs(privacyManager.getAccessLogs());
    } finally {
      setIsAcquiring(false);
    }
  };

  const handleSetAsHome = () => {
    if (!liveReading) return;
    const locText = reverseGeoAddress || `${liveReading.lat.toFixed(4)}, ${liveReading.lon.toFixed(4)}`;
    handleChange('home_location', locText);
  };

  const handleClearLocationCache = () => {
    liveContext.clearCache();
    setLiveReading(null);
    setReverseGeoAddress(null);
  };

  const handleClearAudit = () => {
    privacyManager.clearAccessLogs();
    setAuditLogs([]);
  };

  const handleChange = <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => {
    updateSettings({ [key]: value });
  };

  const handleAddMemory = () => {
    if (!newMemoryContent.trim()) return;
    const nowIso = new Date().toISOString();
    applyOperations([
      {
        type: 'create_entity',
        payload: {
          schema_id: 'system/memory_item',
          title: newMemoryContent.trim().slice(0, 60),
          lifecycle: { status: 'active' },
          attributes: {
            content: newMemoryContent.trim(),
            category: newMemoryCategory,
            source_type: 'user_explicit',
            confidence: 1.0,
            status: 'active',
            privacy_tier: 'internal',
          },
          provenance: {
            source_type: 'user',
            observed_at: nowIso,
            confidence: 1.0,
            is_inferred: false,
            user_confirmed: true,
          },
        },
      },
    ]);
    setNewMemoryContent('');
  };

  const handleDeleteMemory = (id: string) => {
    deleteEntity(id);
  };

  const handleExportJSON = () => {
    const data = {
      version: 1,
      timestamp: new Date().toISOString(),
      entities,
      relationships,
      messages,
      settings
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `flowmate_backup_${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExportMarkdown = () => {
    const md = exportToMarkdown(entities, relationships, { title: 'Flowmate Export' });
    downloadMarkdown(md);
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target?.result as string);
        if (json.entities && Array.isArray(json.entities)) {
          if (confirm("This will overwrite your current data. Are you sure?")) {
            importData(json);
            alert("Data imported successfully.");
          }
        } else {
          alert("Invalid backup file format.");
        }
      } catch (err) {
        console.error(err);
        alert("Failed to parse JSON file.");
      }
      if (fileInputRef.current) fileInputRef.current.value = '';
    };
    reader.readAsText(file);
  };

  const handleReset = () => {
    if (confirm("DANGER: This will permanently delete all your entities, history, and settings. This action cannot be undone. Are you sure?")) {
      localStorage.removeItem('flowmate-storage');
      window.location.reload();
    }
  };

  return (
    <div className="flex-1 w-full min-w-0 overflow-y-auto bg-ideapad-base p-4 sm:p-6 lg:p-8">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3 border-b border-ideapad-border pb-4">
        <div>
          <h1 className="text-2xl font-bold text-ideapad-text">Settings</h1>
          <p className="mt-1 text-sm text-ideapad-muted">Make Flowmate work the way you do.</p>
        </div>
        <span className="pb-0.5 text-xs text-ideapad-muted">Most preferences save automatically</span>
      </header>

      <div data-testid="settings-content" className="w-full max-w-none min-w-0 space-y-3">

        <details open name="flowmate-settings-sections" data-testid="settings-group-general" className="settings-group">
          <summary className="settings-group-summary">
            <span className="min-w-0"><span className="block text-sm font-semibold text-slate-100">General</span><span className="mt-0.5 block text-xs font-normal text-slate-400">Appearance and personal profile</span></span>
            <ChevronDown aria-hidden="true" size={17} className="settings-group-chevron" />
          </summary>
          <div id="general-settings" className="settings-group-content space-y-5">
        <AppearanceSettings />
        <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
          <h2 className="text-lg font-semibold text-slate-100">Your Flowmate profile</h2>
          <p className="mt-1 text-sm leading-6 text-slate-400">Review the optional context you shared during setup. It stays in this browser and is added to AI requests only if you opted in.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={onShowOnboarding} className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-200 hover:border-emerald-500 hover:text-emerald-200">Review onboarding answers</button>
            <button type="button" onClick={() => {
              if (!window.confirm('Clear the optional onboarding answers saved in this browser? This does not change your workspace or conversations.')) return;
              try {
                clearOnboardingProfile(currentUser?.uid || 'guest');
                setProfileMessage('Your local onboarding answers and draft were cleared.');
              } catch {
                setProfileMessage('Flowmate could not clear this browser’s onboarding answers.');
              }
            }} className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-300 hover:border-rose-500/60 hover:text-rose-200">Clear saved answers</button>
          </div>
          {profileMessage && <p role="status" className="mt-2 text-xs text-slate-400">{profileMessage}</p>}
        </section>
        </div>
        </details>

        {/* Model & API Key Settings */}
        <details name="flowmate-settings-sections" data-testid="settings-group-ai" className="settings-group">
          <summary className="settings-group-summary">
            <span className="min-w-0"><span className="block text-sm font-semibold text-slate-100">AI & Models</span><span className="mt-0.5 block text-xs font-normal text-slate-400">Choose your model, review included access or add your own key</span></span>
            <ChevronDown aria-hidden="true" size={17} className="settings-group-chevron" />
          </summary>
          <div className="settings-group-content space-y-5">
        <section id="ai-model-settings">
          <AiModelSelector />
          <ManagedAiUsagePanel />
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-5">
            <div className="pt-4 border-t border-slate-800/80">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <label className="block text-sm font-semibold text-ideapad-text">
                  Use your own Gemini key
                </label>
                <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full ${
                  hasAiApiKey()
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                    : 'bg-slate-800 text-slate-400 border border-slate-700'
                }`}>
                  {hasAiApiKey() ? 'Your key active' : hasManagedAiIdentity() ? 'Guest and account access available' : currentUser ? 'Managed access unavailable here' : 'AI provider unavailable here'}
                </span>
              </div>
              <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
                <input
                  type="password"
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  placeholder="Paste your Gemini API key to use BYOK"
                  aria-label="Your Gemini API key"
                  autoComplete="off"
                  spellCheck={false}
                  className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-mono text-slate-200 outline-none focus:ring-2 focus:ring-emerald-500/40"
                />
                <button
                  onClick={() => {
                    setEphemeralApiKey(apiKeyInput.trim() || null);
                    setKeySavedToast(true);
                    setTimeout(() => setKeySavedToast(false), 3000);
                  }}
                  className="min-h-10 shrink-0 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300"
                >
                  Save Key
                </button>
                {hasAiApiKey() && (
                  <button
                    onClick={() => {
                      setApiKeyInput('');
                      setEphemeralApiKey(null);
                    }}
                    className="min-h-10 shrink-0 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-medium text-slate-300 transition-colors hover:bg-rose-900/40 hover:text-rose-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300"
                  >
                    Clear
                  </button>
                )}
              </div>
              {keySavedToast && (
                <p className="text-xs text-emerald-400 mt-2 font-medium">✓ Runtime key updated in memory.</p>
              )}
              <details className="mt-3 rounded-lg border border-ideapad-border/70 px-3 py-2 text-xs text-ideapad-muted">
                <summary className="cursor-pointer font-medium text-ideapad-text">How your key is handled</summary>
                <p className="mt-2 leading-5">Your key stays in this browser session and is sent directly to Google. Flowmate does not persist it. Included access and daily briefing usage are shown above.</p>
              </details>
            </div>
          </div>
        </section>

        <ManagedAiAdminPanel />
          </div>
        </details>

        {/* Feature Toggles */}
        <details name="flowmate-settings-sections" data-testid="settings-group-preferences" className="settings-group">
          <summary className="settings-group-summary">
            <span className="min-w-0"><span className="block text-sm font-semibold text-slate-100">Preferences</span><span className="mt-0.5 block text-xs font-normal text-slate-400">Productivity, assistant style and time settings</span></span>
            <ChevronDown aria-hidden="true" size={17} className="settings-group-chevron" />
          </summary>
          <div className="settings-group-content space-y-5">
        <section>
          <h2 className="text-lg font-semibold text-slate-200 mb-4">Features</h2>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
            <p className="text-sm text-slate-400 mb-2">
              Enable or disable features to customize your experience.
            </p>


            <div className="flex items-center justify-between py-2 border-b border-slate-800">
              <div>
                <label className="block text-sm font-medium text-slate-200">🧠 Productivity Score Method</label>
                <p className="text-xs text-slate-500">
                  {settings.productivity_calc_method === 'AWAKE_TIME'
                    ? 'Relative to Awake Time (24h - Sleep)'
                    : 'Relative to Logged Time'}
                </p>
              </div>
              <button
                onClick={() => {
                  const method = settings.productivity_calc_method === 'AWAKE_TIME' ? 'LOGGED_TIME' : 'AWAKE_TIME';
                  handleChange('productivity_calc_method', method);
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${settings.productivity_calc_method === 'AWAKE_TIME' ? 'bg-indigo-600 text-white' : 'bg-slate-700 text-slate-300'}`}
              >
                {settings.productivity_calc_method === 'AWAKE_TIME' ? 'Awake Time' : 'Logged Time'}
              </button>
            </div>

            <div className="flex items-center justify-between py-2">
              <div>
                <label className="block text-sm font-medium text-slate-200">👥 People Tracking</label>
                <p className="text-xs text-slate-500">Track relationships, promises, and contacts</p>
              </div>
              <button
                onClick={() => {
                  const current = settings.feature_toggles || DEFAULT_FEATURE_TOGGLES;
                  handleChange('feature_toggles', { ...current, people_tracking: !current.people_tracking });
                }}
                className={`w-12 h-6 rounded-full transition-colors relative ${(settings.feature_toggles?.people_tracking ?? true) ? 'bg-indigo-600' : 'bg-slate-700'}`}
              >
                <span className={`absolute top-1 left-1 bg-white w-4 h-4 rounded-full transition-transform ${(settings.feature_toggles?.people_tracking ?? true) ? 'translate-x-6' : ''}`} />
              </button>
            </div>
          </div>
        </section>

        {/* AI Persona Settings */}
        <section>
          <h2 className="text-lg font-semibold text-slate-200 mb-4 flex items-center gap-2">
            <Bot size={18} /> AI Persona
          </h2>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-2">Custom System Instructions</label>
              <textarea
                value={settings.custom_instructions || ''}
                onChange={(e) => handleChange('custom_instructions', e.target.value)}
                placeholder="e.g. 'You are a strict military commander. Be concise and demanding.'"
                className="w-full bg-slate-950 border border-slate-700 text-slate-200 rounded-lg p-3 min-h-[100px] focus:ring-2 focus:ring-indigo-500/50 outline-none resize-y text-sm"
              />
              <p className="text-xs text-slate-500 mt-2">
                Define the tone, style, and rules for Flowmate.
              </p>
            </div>
          </div>
        </section>

        {/* Environment */}
        <section>
          <h2 className="text-lg font-semibold text-slate-200 mb-4">Environment</h2>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-2">Timezone</label>
              <input
                type="text"
                value={settings.timezone}
                onChange={(e) => handleChange('timezone', e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 text-slate-200 rounded-lg p-2.5 focus:ring-2 focus:ring-indigo-500/50 outline-none"
              />
            </div>

            <div className="flex items-center justify-between pt-2">
              <div>
                <label className="block text-sm font-medium text-slate-200">Debug Mode</label>
                <p className="text-xs text-slate-500">Show raw orchestrator outputs in console.</p>
              </div>
              <button
                onClick={() => handleChange('debug_mode', !settings.debug_mode)}
                className={`w-12 h-6 rounded-full transition-colors relative ${settings.debug_mode ? 'bg-indigo-600' : 'bg-slate-700'}`}
              >
                <span className={`absolute top-1 left-1 bg-white w-4 h-4 rounded-full transition-transform ${settings.debug_mode ? 'translate-x-6' : ''}`} />
              </button>
            </div>
          </div>
        </section>
          </div>
        </details>

        {/* Privacy & Context (P1-03) */}
        <details name="flowmate-settings-sections" data-testid="settings-group-privacy" className="settings-group">
          <summary className="settings-group-summary">
            <span className="min-w-0"><span className="block text-sm font-semibold text-slate-100">Privacy & Sync</span><span className="mt-0.5 block text-xs font-normal text-slate-400">Personal context, connected services and workspace sync consent</span></span>
            <ChevronDown aria-hidden="true" size={17} className="settings-group-chevron" />
          </summary>
          <div className="settings-group-content space-y-5">
        <section id="privacy-settings-section">
          <h2 className="text-lg font-semibold text-slate-200 mb-4 flex items-center gap-2">
            <Shield size={18} className="text-indigo-400" /> Privacy & Context
          </h2>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-6">
            <p className="text-sm text-ideapad-muted leading-relaxed">Choose what Flowmate can save, sync or share with AI. Workspace sync and AI context are separate choices.</p>

            {/* Live Context Capabilities */}
            <div className="space-y-4">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Live Device Capabilities</h3>

              {/* Device Location Capability */}
              <div className="bg-slate-950/70 border border-slate-800 rounded-lg p-4 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-start gap-2.5">
                    <Navigation className="text-indigo-400 w-4 h-4 mt-0.5 shrink-0" />
                    <div>
                      <div className="text-sm font-medium text-slate-200">Device Geolocation</div>
                      <div className="text-xs text-slate-500">
                        Authoritative request-time GPS coordinates for travel routing and commute planning.
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 self-end sm:self-auto">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] text-slate-500">Hardware:</span>
                      <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${
                        permission === 'granted'
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                          : permission === 'denied'
                          ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                          : permission === 'unsupported'
                          ? 'bg-slate-700 text-slate-300'
                          : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                      }`}>
                        {permission.toUpperCase()}
                      </span>
                    </div>

                    <select
                      value={currentPrivacyPolicy.capabilities.device_location?.read || 'ask'}
                      onChange={(e) => handleUpdateCapabilityMode('device_location', e.target.value as any)}
                      className="bg-slate-900 border border-slate-700 text-slate-200 text-xs rounded-lg px-2.5 py-1.5 focus:ring-2 focus:ring-indigo-500/50 outline-none"
                    >
                      <option value="ask">Ask on Demand</option>
                      <option value="allow">Allow Always</option>
                      <option value="deny">Deny Access</option>
                    </select>
                  </div>
                </div>

                {/* Ephemeral reading monitor */}
                {liveReading ? (
                  <div className="bg-slate-900/90 rounded-md p-3 border border-slate-800/80 text-xs space-y-1.5">
                    <div className="flex items-center justify-between text-slate-300">
                      <span className="font-mono">
                        {liveReading.lat.toFixed(5)}°N, {liveReading.lon.toFixed(5)}°E
                      </span>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${
                        liveReading.freshnessTier === 'fresh'
                          ? 'bg-emerald-500/20 text-emerald-400'
                          : liveReading.freshnessTier === 'recent'
                          ? 'bg-blue-500/20 text-blue-400'
                          : 'bg-amber-500/20 text-amber-400'
                      }`}>
                        {liveReading.freshnessTier} (±{Math.round(liveReading.accuracy_meters)}m)
                      </span>
                    </div>
                    {reverseGeoAddress && (
                      <div className="text-slate-400 truncate">
                        <span className="text-slate-500">Reverse Geocoded:</span> {reverseGeoAddress}
                      </div>
                    )}
                    <div className="text-[11px] text-slate-500">
                      Acquired {Math.max(0, Math.round((Date.now() - liveReading.timestamp) / 1000))}s ago ({liveReading.source})
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-slate-500">
                    No active device location reading. Ephemeral live location is requested on-demand when calculating travel routes.
                  </p>
                )}

                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    type="button"
                    onClick={handleAcquireLocation}
                    disabled={isAcquiring}
                    className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-900/50 text-white rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isAcquiring ? 'animate-spin' : ''}`} />
                    {isAcquiring ? 'Acquiring GPS...' : 'Acquire Fresh Location'}
                  </button>

                  {liveReading && (
                    <>
                      <button
                        type="button"
                        onClick={handleSetAsHome}
                        className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 border border-slate-700"
                      >
                        <MapPin className="w-3.5 h-3.5 text-indigo-400" />
                        Set as Home Base
                      </button>
                      <button
                        type="button"
                        onClick={handleClearLocationCache}
                        className="px-2.5 py-1.5 text-slate-400 hover:text-rose-400 rounded-lg text-xs transition-colors"
                      >
                        Clear Cache
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Connected Services (Extensible Architecture Placeholder) */}
            <div className="space-y-3">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Connected Services (Preview)</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="bg-slate-950/40 border border-slate-800/60 rounded-lg p-3 text-xs flex items-center justify-between">
                  <span className="text-slate-300 font-medium">Google Calendar</span>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-400 font-mono">SIMULATED / NOT CONNECTED</span>
                </div>
                <div className="bg-slate-950/40 border border-slate-800/60 rounded-lg p-3 text-xs flex items-center justify-between">
                  <span className="text-slate-300 font-medium">Gmail</span>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800/80 text-slate-500 font-mono">UPCOMING</span>
                </div>
                <div className="bg-slate-950/40 border border-slate-800/60 rounded-lg p-3 text-xs flex items-center justify-between">
                  <span className="text-slate-300 font-medium">Contacts & People</span>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800/80 text-slate-500 font-mono">UPCOMING</span>
                </div>
                <div className="bg-slate-950/40 border border-slate-800/60 rounded-lg p-3 text-xs flex items-center justify-between">
                  <span className="text-slate-300 font-medium">Drive / Files</span>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800/80 text-slate-500 font-mono">UPCOMING</span>
                </div>
              </div>
              <p className="text-[11px] text-slate-500 italic">
                Flowmate strictly enforces separate Read and Mutation permissions for all future personal data integrations.
              </p>
            </div>

            {/* Sensitive Context Access Audit Log */}
            <div className="space-y-3 pt-2 border-t border-slate-800">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Activity size={15} className="text-indigo-400" />
                  <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Sensitive Access Audit History</h3>
                </div>
                {auditLogs.length > 0 && (
                  <button
                    type="button"
                    onClick={handleClearAudit}
                    className="text-[11px] text-slate-400 hover:text-rose-400 transition-colors"
                  >
                    Clear History
                  </button>
                )}
              </div>

              {auditLogs.length > 0 ? (
                <div className="bg-slate-950 border border-slate-800 rounded-lg divide-y divide-slate-800/60 max-h-48 overflow-y-auto">
                  {auditLogs.map((entry) => (
                    <div key={entry.id} className="p-2.5 text-xs flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-indigo-500/20 text-indigo-300">
                          {entry.capabilityId}
                        </span>
                        <span className="text-slate-300 truncate">{entry.reason}</span>
                      </div>
                      <span className="text-[10px] text-slate-500 shrink-0">
                        {Math.max(0, Math.round((Date.now() - entry.timestamp) / 1000))}s ago
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-500 bg-slate-950/40 border border-slate-800/50 rounded-lg p-3">
                  No sensitive context accessed yet in this session.
                </p>
              )}
            </div>
          </div>
        </section>

        {/* Persistent Memory & Situational State (P1-07) */}
        <section id="context-memory-section">
          <h2 className="text-lg font-semibold text-slate-200 mb-4 flex items-center gap-2">
            <Brain size={18} className="text-indigo-400" /> Persistent Memory & Situational State
          </h2>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-6">
            <p className="text-xs text-slate-400 leading-relaxed">
              Flowmate maintains durable knowledge about you, what matters to you, and your active situation.
              Inferred memories require your confirmation before becoming active.
            </p>

            {/* Add Explicit Memory Form */}
            <div className="bg-slate-950/70 border border-slate-800 rounded-lg p-4 space-y-3">
              <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Add Explicit Memory</h3>
              <div className="flex flex-col sm:flex-row gap-2">
                <select
                  value={newMemoryCategory}
                  onChange={(e) => setNewMemoryCategory(e.target.value as MemoryCategory)}
                  className="bg-slate-900 border border-slate-700 text-slate-200 text-xs rounded-lg px-2.5 py-2 focus:ring-2 focus:ring-indigo-500/50 outline-none shrink-0"
                >
                  <option value="preference">Preference</option>
                  <option value="fact">Fact</option>
                  <option value="routine">Routine</option>
                  <option value="project_context">Project Context</option>
                  <option value="goal_aspiration">Goal & Aspiration</option>
                  <option value="relationship">Relationship</option>
                </select>
                <input
                  type="text"
                  value={newMemoryContent}
                  onChange={(e) => setNewMemoryContent(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAddMemory(); }}
                  placeholder="e.g. 'I prefer concise bullet points in responses' or 'I work on Flowmate on weekends'"
                  className="flex-1 bg-slate-900 border border-slate-700 text-slate-200 text-xs rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-500/50 outline-none"
                />
                <button
                  type="button"
                  onClick={handleAddMemory}
                  disabled={!newMemoryContent.trim()}
                  className="px-3 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-900/50 text-white rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-1.5 shrink-0"
                >
                  <Plus size={14} /> Add Memory
                </button>
              </div>
            </div>

            {/* Active Persistent Memories */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  Durable Knowledge ({memoryEntities.length})
                </h3>
              </div>

              {memoryEntities.length > 0 ? (
                <div className="bg-slate-950 border border-slate-800 rounded-lg divide-y divide-slate-800/60 max-h-60 overflow-y-auto">
                  {memoryEntities.map((m) => (
                    <div key={m.id} className="p-3 text-xs flex items-start justify-between gap-3">
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                            {m.category}
                          </span>
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                            m.source_type === 'user_explicit'
                              ? 'bg-emerald-500/10 text-emerald-400'
                              : 'bg-amber-500/10 text-amber-400'
                          }`}>
                            {m.source_type === 'user_explicit' ? 'explicit (100%)' : `inferred (${Math.round(m.confidence * 100)}%)`}
                          </span>
                          {m.status === 'conflicted' && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] bg-rose-500/20 text-rose-300 border border-rose-500/30">
                              Conflicted
                            </span>
                          )}
                        </div>
                        <div className="text-slate-200 leading-snug">{m.content}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDeleteMemory(m.id)}
                        className="text-slate-500 hover:text-rose-400 transition-colors p-1 shrink-0"
                        title="Delete memory"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-500 bg-slate-950/40 border border-slate-800/50 rounded-lg p-3">
                  No persistent memories stored yet. Tell Flowmate your preferences or add one above!
                </p>
              )}
            </div>

            {/* Active Situational States */}
            <div className="space-y-3">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                <Clock size={13} className="text-amber-400" /> Active Situational States ({situationalEntities.length})
              </h3>
              {situationalEntities.length > 0 ? (
                <div className="bg-slate-950 border border-slate-800 rounded-lg divide-y divide-slate-800/60 max-h-48 overflow-y-auto">
                  {situationalEntities.map((s) => (
                    <div key={s.id} className="p-3 text-xs flex items-start justify-between gap-3">
                      <div className="space-y-1 min-w-0">
                        <div className="text-slate-200 font-medium">{s.topic}</div>
                        {s.details && <div className="text-slate-400 text-[11px]">{s.details}</div>}
                        <div className="text-[10px] text-slate-500">
                          Active until: {new Date(s.valid_until).toLocaleDateString()}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDeleteMemory(s.id)}
                        className="text-slate-500 hover:text-rose-400 transition-colors p-1 shrink-0"
                        title="Delete situational state"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-500 bg-slate-950/40 border border-slate-800/50 rounded-lg p-3">
                  No active temporary situational states (e.g., travel this week, temporary deadlines).
                </p>
              )}
            </div>
          </div>
        </section>

        {/* Location & Travel Preferences */}
        <section>
          <h2 className="text-lg font-semibold text-slate-200 mb-4 flex items-center gap-2">
            <MapPin size={18} /> Location & Travel
          </h2>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
            {/* Default Starting Location / Home Base */}
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-2">Default Starting Location / Home Base</label>
              <input
                type="text"
                value={settings.home_location || ''}
                onChange={(e) => handleChange('home_location', e.target.value)}
                placeholder="e.g. Campus 25, KIIT University or 123 Main St, New York"
                className="w-full bg-slate-950 border border-slate-700 text-slate-200 rounded-lg p-2.5 focus:ring-2 focus:ring-indigo-500/50 outline-none text-sm"
              />
              <p className="text-xs text-slate-500 mt-1">
                Used as fallback origin when live device location is unavailable or denied.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-2">Station Arrival Buffer (minutes)</label>
                <input
                  type="number"
                  min={10}
                  max={180}
                  value={settings.travel_preferences?.station_buffer_minutes ?? 45}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10) || 45;
                    handleChange('travel_preferences', {
                      ...settings.travel_preferences,
                      station_buffer_minutes: val,
                    });
                  }}
                  className="w-full bg-slate-950 border border-slate-700 text-slate-200 rounded-lg p-2.5 focus:ring-2 focus:ring-indigo-500/50 outline-none text-sm"
                />
                <p className="text-xs text-slate-500 mt-1">Buffer time before train departure to reach platform & coach.</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-400 mb-2">Airport Arrival Buffer (minutes)</label>
                <input
                  type="number"
                  min={30}
                  max={300}
                  value={settings.travel_preferences?.airport_buffer_minutes ?? 120}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10) || 120;
                    handleChange('travel_preferences', {
                      ...settings.travel_preferences,
                      airport_buffer_minutes: val,
                    });
                  }}
                  className="w-full bg-slate-950 border border-slate-700 text-slate-200 rounded-lg p-2.5 focus:ring-2 focus:ring-indigo-500/50 outline-none text-sm"
                />
                <p className="text-xs text-slate-500 mt-1">Buffer time before flight departure for check-in & security.</p>
              </div>
            </div>
          </div>
        </section>

        {/* Sync Settings */}
        <section id="privacy-sync-settings" className="scroll-mt-16">
          <h2 className="text-lg font-semibold text-slate-200 mb-4">Privacy, Sync & Backup</h2>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
            <div className="space-y-3">
              <label className="flex items-start gap-3 rounded-lg border border-ideapad-border bg-ideapad-base p-4 text-sm">
                <input type="checkbox" checked={settings.sync_ai_preferences === true} onChange={event => updateSettings({ sync_ai_preferences: event.target.checked })} className="mt-0.5 accent-emerald-500" />
                <span><span className="block font-medium text-ideapad-text">Sync AI preferences to my account</span><span className="mt-1 block text-xs leading-5 text-ideapad-muted">When enabled, model and reasoning choices sync across signed-in devices.</span></span>
              </label>
              <label className="flex items-start gap-3 rounded-lg border border-ideapad-border bg-ideapad-base p-4 text-sm">
                <input type="checkbox" checked={settings.save_voice_transcripts === true} onChange={event => updateSettings({ save_voice_transcripts: event.target.checked })} className="mt-0.5 accent-emerald-500" />
                <span><span className="block font-medium text-ideapad-text">Save voice transcripts in chat history</span><span className="mt-1 block text-xs leading-5 text-ideapad-muted">Off by default. Raw audio is not stored by Flowmate.</span></span>
              </label>
            </div>
            <div className="rounded-lg border border-slate-700 bg-slate-950/50 p-4 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-200">Workspace cloud sync</label>
                  <p className="mt-1 text-xs text-slate-400 leading-relaxed">
                    {workspaceSyncEnabled
                      ? 'Enabled for this account on this device. Flowmate stores workspace content in its Firebase project.'
                      : 'Off by default. Signing in or using managed AI does not upload your workspace.'}
                  </p>
                </div>
                {currentUser ? (
                  workspaceSyncEnabled ? (
                    <button ref={workspaceSyncTriggerRef} type="button" onClick={disableWorkspaceCloudSync}
                      className="shrink-0 rounded-lg border border-slate-600 px-3 py-2 text-xs text-slate-200 hover:bg-slate-800">
                      Turn off cloud sync
                    </button>
                  ) : (
                    <button ref={workspaceSyncTriggerRef} type="button" onClick={() => setShowWorkspaceSyncConsent(true)}
                      className="shrink-0 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200 hover:bg-emerald-500/20">
                      Review and enable
                    </button>
                  )
                ) : (
                  <span className="shrink-0 rounded-full bg-slate-800 px-3 py-1.5 text-[11px] text-slate-300">Local only</span>
                )}
              </div>
              <p className="text-[11px] text-slate-500">
                Standard Flowmate cloud sync is not end-to-end encrypted. Authorized Firebase project administrators can technically access stored content. This choice is separate from AI, Google Calendar and sign-in.
              </p>
              {workspaceSyncMessage && <p role="status" className="text-xs text-slate-300">{workspaceSyncMessage}</p>}
              {!currentUser && <p className="text-xs text-slate-400">Sign in only if you want to review cloud sync. You can keep using this device locally.</p>}
            </div>

            <div className="flex items-center justify-between">
              <div>
                <label className="block text-sm font-medium text-slate-200">Google Calendar Sync</label>
                <p className="text-xs text-slate-500">Sync scheduled events to your Google Calendar.</p>
              </div>
              <button
                onClick={() => handleChange('sync_enabled', !settings.sync_enabled)}
                className={`w-12 h-6 rounded-full transition-colors relative ${settings.sync_enabled ? 'bg-indigo-600' : 'bg-slate-700'}`}
              >
                <span className={`absolute top-1 left-1 bg-white w-4 h-4 rounded-full transition-transform ${settings.sync_enabled ? 'translate-x-6' : ''}`} />
              </button>
            </div>

            {settings.sync_enabled && (
              <div className="bg-yellow-500/10 border border-yellow-500/20 p-3 rounded-lg flex items-start gap-2">
                <AlertTriangle className="text-yellow-500 w-4 h-4 mt-0.5 shrink-0" />
                <p className="text-xs text-yellow-200">
                  Sync is currently in simulated mode for this developer preview.
                </p>
              </div>
            )}
          </div>
        </section>
          </div>
        </details>

        {/* Data Management */}
        <details name="flowmate-settings-sections" data-testid="settings-group-data" className="settings-group">
          <summary className="settings-group-summary">
            <span className="min-w-0"><span className="block text-sm font-semibold text-slate-100">Data & Backup</span><span className="mt-0.5 block text-xs font-normal text-slate-400">Export, restore or reset this workspace</span></span>
            <ChevronDown aria-hidden="true" size={17} className="settings-group-chevron" />
          </summary>
          <div className="settings-group-content">
        <section id="data-backup-settings">
          <h2 className="text-lg font-semibold text-slate-200 mb-4">Data Management</h2>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
            <p className="text-sm text-slate-400 mb-4">
              {workspaceSyncEnabled
                ? 'Your workspace is stored locally and synchronized to standard Flowmate cloud storage on this device. Create backups regularly.'
                : 'Your workspace is stored locally in this browser. Create backups regularly.'}
            </p>
            <div className="grid grid-cols-2 gap-3 mb-6">
              <button
                onClick={handleExportJSON}
                className="py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium flex items-center justify-center gap-2 border border-slate-700 transition-colors"
              >
                <Download size={16} />
                Export JSON
              </button>
              <button
                onClick={handleExportMarkdown}
                className="py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium flex items-center justify-center gap-2 border border-slate-700 transition-colors"
              >
                <FileText size={16} />
                Export Markdown
              </button>
              <button
                onClick={handleImportClick}
                className="py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium flex items-center justify-center gap-2 border border-slate-700 transition-colors col-span-2"
              >
                <Upload size={16} />
                Import Backup
              </button>
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                accept=".json"
                className="hidden"
              />
            </div>

            <div className="pt-6 border-t border-slate-800">
              <button
                onClick={handleReset}
                className="text-red-400 hover:text-red-300 text-sm font-medium flex items-center gap-2 transition-colors hover:underline decoration-red-400/30"
              >
                <Trash2 size={16} />
                Reset All Data (Factory Reset)
              </button>
            </div>
          </div>
        </section>
          </div>
        </details>

        {/* Debug Tools */}
        <details name="flowmate-settings-sections" data-testid="settings-group-advanced" className="settings-group">
          <summary className="settings-group-summary">
            <span className="min-w-0"><span className="block text-sm font-semibold text-slate-100">Advanced</span><span className="mt-0.5 block text-xs font-normal text-slate-400">Troubleshooting and maintenance tools</span></span>
            <ChevronDown aria-hidden="true" size={17} className="settings-group-chevron" />
          </summary>
          <section className="mt-4">
          <h2 className="text-lg font-semibold text-slate-200 mb-4">Debug Tools</h2>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
            <p className="text-sm text-slate-400">
              Advanced tools for troubleshooting and maintenance.
            </p>

            <div className="space-y-3">
              {import.meta.env.DEV && <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
                <p className="mb-2 text-xs text-slate-400">Development-only prototypes, separate from normal workspace behavior.</p>
                <button type="button" onClick={() => useStore.getState().toggleDeveloperMode()} className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-300 hover:bg-slate-800">Toggle diagnostics</button>
              </div>}
              <button
                onClick={async () => {
                  const accessToken = localStorage.getItem('flowmate_google_calendar_token');
                  if (!accessToken) {
                    alert('❌ No Google Calendar token found. Please sync in Calendar first.');
                    return;
                  }

                  if (!confirm('This will delete duplicate events from your Google Calendar. Continue?')) return;

                  try {
                    const oneYearAgo = new Date();
                    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
                    const sixMonthsFromNow = new Date();
                    sixMonthsFromNow.setMonth(sixMonthsFromNow.getMonth() + 6);

                    const params = new URLSearchParams({
                      timeMin: oneYearAgo.toISOString(),
                      timeMax: sixMonthsFromNow.toISOString(),
                      singleEvents: 'true',
                      maxResults: '2500',
                      orderBy: 'startTime'
                    });

                    const response = await fetch(
                      `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
                      { headers: { 'Authorization': `Bearer ${accessToken}` } }
                    );

                    if (!response.ok) {
                      alert(`❌ API error: ${response.status}. Try syncing again first.`);
                      return;
                    }

                    const data = await response.json();
                    const events = data.items || [];

                    // Group by title + start time
                    const groups: Record<string, any[]> = {};
                    events.forEach((e: any) => {
                      let startVal = e.start?.dateTime || e.start?.date || '';
                      // Normalize midnight ISO to date string to catch duplicates where one is All-Day and one is 00:00 timed
                      if (startVal.includes('T00:00:00')) {
                        startVal = startVal.split('T')[0];
                      }
                      const key = `${e.summary || 'Untitled'}|${startVal}`;
                      if (!groups[key]) groups[key] = [];
                      groups[key].push(e);
                    });

                    const duplicates = Object.values(groups).filter(g => g.length > 1);
                    if (duplicates.length === 0) {
                      alert('✅ No duplicates found! Your Google Calendar is clean.');
                      return;
                    }

                    const toDelete = duplicates.flatMap(g => g.slice(1));
                    let deleted = 0;

                    for (const event of toDelete) {
                      const res = await fetch(
                        `https://www.googleapis.com/calendar/v3/calendars/primary/events/${event.id}`,
                        { method: 'DELETE', headers: { 'Authorization': `Bearer ${accessToken}` } }
                      );
                      if (res.ok || res.status === 204) deleted++;
                      await new Promise(r => setTimeout(r, 100));
                    }

                    alert(`✅ Cleaned up ${deleted} duplicate events from Google Calendar!`);
                  } catch (err: any) {
                    alert(`❌ Error: ${err.message}`);
                  }
                }}
                className="w-full py-2.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 font-medium flex items-center justify-center gap-2 border border-amber-500/30 transition-colors"
              >
                <Trash2 size={16} />
                Clean Google Calendar Duplicates
              </button>

              <button
                onClick={() => {
                  const currentEntities = entities;
                  const duplicateIds: string[] = [];

                  // Method 1: Same google_calendar_id
                  const seenGcal = new Map<string, string>();
                  currentEntities.forEach(e => {
                    const gcalId = e.metadata?.google_calendar_id;
                    if (gcalId) {
                      if (seenGcal.has(gcalId)) {
                        duplicateIds.push(e.id);
                      } else {
                        seenGcal.set(gcalId, e.id);
                      }
                    }
                  });

                  // Method 2: Same title + start_time (for events without gcal id)
                  const seenTitleTime = new Map<string, string>();
                  currentEntities.forEach(e => {
                    if (!duplicateIds.includes(e.id)) { // Skip already marked as duplicate
                      const key = `${e.title}|${e.start_time || e.deadline || ''}`;
                      if (seenTitleTime.has(key)) {
                        duplicateIds.push(e.id);
                      } else {
                        seenTitleTime.set(key, e.id);
                      }
                    }
                  });

                  if (duplicateIds.length === 0) {
                    alert('✅ No duplicate entities found in Flowmate!');
                    return;
                  }

                  if (!confirm(`Found ${duplicateIds.length} duplicate entities. Delete them?`)) return;

                  const { applyOperations } = useStore.getState();
                  const ops = duplicateIds.map(id => ({
                    type: 'delete_entity' as const,
                    payload: { id }
                  }));
                  applyOperations(ops);

                  alert(`✅ Removed ${duplicateIds.length} duplicate entities from Flowmate!`);
                }}
                className="w-full py-2.5 rounded-lg bg-purple-500/10 hover:bg-purple-500/20 text-purple-300 font-medium flex items-center justify-center gap-2 border border-purple-500/30 transition-colors"
              >
                <Trash2 size={16} />
                Clean Flowmate Cache Duplicates
              </button>
            </div>

            <div className="space-y-3 pt-4 border-t border-slate-700">
              <p className="text-xs text-slate-400 font-medium">Bulk Actions</p>
              <button
                onClick={() => {
                  const birthdayEvents = entities.filter(e => {
                    const title = (e.title || '').toLowerCase();
                    return title.includes('birthday') || title.includes('bday');
                  });

                  if (birthdayEvents.length === 0) {
                    alert('No birthday events found.');
                    return;
                  }

                  if (!confirm(`Found ${birthdayEvents.length} birthday events. Hide all from AI?`)) return;

                  const { applyOperations } = useStore.getState();
                  const ops = birthdayEvents.map(e => ({
                    type: 'update_entity' as const,
                    payload: {
                      id: e.id,
                      fields: {
                        metadata: {
                          ...e.metadata,
                          hidden: true
                        }
                      }
                    }
                  }));
                  applyOperations(ops);

                  alert(`✅ Hidden ${birthdayEvents.length} birthday events from AI!`);
                }}
                className="w-full py-2.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 font-medium flex items-center justify-center gap-2 border border-slate-600 transition-colors"
              >
                <EyeOff size={16} />
                Hide All Birthdays from AI
              </button>
            </div>

            <p className="text-xs text-slate-500 mt-2">
              Use these if sync created duplicate events. Always backup first!
            </p>
          </div>
          </section>
        </details>

      </div>
      {showWorkspaceSyncConsent && currentUser && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4" onMouseDown={event => {
          if (event.target === event.currentTarget) closeWorkspaceSyncConsent();
        }}>
          <section ref={workspaceSyncDialogRef} role="dialog" aria-modal="true" aria-labelledby="workspace-sync-consent-title"
            className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
            <h2 id="workspace-sync-consent-title" className="text-lg font-semibold text-slate-100">Enable workspace cloud sync?</h2>
            <p className="mt-3 text-sm leading-relaxed text-slate-300">
              Flowmate will read and sync this device's workspace with the signed-in account. This can include goals, projects, tasks, relationships, conversations, profile settings and activity records. Existing cloud content will be merged with local content.
            </p>
            <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-100">
              This is standard Firestore storage, not end-to-end encryption. Authorized administrators of the Flowmate Firebase project can technically read stored workspace content. Your AI provider and Google Calendar choices remain separate.
            </p>
            <label className="mt-4 flex items-start gap-3 text-sm text-slate-200">
              <input type="checkbox" checked={workspaceSyncConsentAcknowledged}
                onChange={event => setWorkspaceSyncConsentAcknowledged(event.target.checked)} className="mt-1" />
              <span>I understand this device will upload and read workspace content in standard Flowmate cloud storage.</span>
            </label>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={closeWorkspaceSyncConsent}
                className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800">Keep local</button>
              <button type="button" disabled={!workspaceSyncConsentAcknowledged} onClick={enableWorkspaceCloudSync}
                className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white enabled:hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50">Enable on this device</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
};

export default SettingsView;
