import WorkspaceStatus from './WorkspaceStatus';
import AppearanceSettings from './AppearanceSettings';
import React, { useRef, useState, useEffect } from 'react';
import { useStore } from '../store';
import { AlertTriangle, Download, Upload, FileText, Trash2, Bot, EyeOff, MapPin, Navigation, RefreshCw, Shield, Activity, Brain, Clock, Plus } from 'lucide-react';
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

const DEFAULT_FEATURE_TOGGLES: FeatureToggles = {
  food_tracking: true,
  attendance_tracking: true,
  people_tracking: true,
  gamification: true,
  quick_streaks: true,
};

const SettingsView: React.FC = () => {
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
    <div className="flex-1 overflow-y-auto bg-slate-950 p-6 md:p-8">
      <header className="mb-8 border-b border-slate-800 pb-6 pl-14">
        <h1 className="text-2xl font-bold text-slate-100">Settings</h1>
        <p className="text-slate-400 text-sm mt-1">
          Configure your Flowmate preferences and environment.
        </p>
      </header>

      <div className="max-w-2xl space-y-8">

        <WorkspaceStatus detailed />
        <AppearanceSettings />
        {import.meta.env.DEV && <section aria-label="Developer and experimental tools" className="p-4 border border-slate-700 rounded-lg space-y-3">
          <h2 className="text-lg text-slate-100">Developer / Experimental</h2>
          <p className="text-sm text-slate-400">Development-only prototypes, separate from normal workspace behavior.</p>
          <button onClick={() => useStore.getState().toggleDeveloperMode()}>Toggle diagnostics</button>
        </section>}

        {/* Model & API Key Settings */}
        <section>
          <h2 className="text-lg font-semibold text-slate-200 mb-4">AI Model & Runtime Access</h2>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-5">
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-2">Preferred Model for your own Gemini key</label>
              <select
                value={settings.preferred_model}
                onChange={(e) => handleChange('preferred_model', e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 text-slate-200 rounded-lg p-2.5 focus:ring-2 focus:ring-indigo-500/50 outline-none"
              >
                <option value="gemini-3.8-flash">Gemini 3.8 Flash (Recommended)</option>
                <option value="gemini-3.7-flash">Gemini 3.7 Flash (Stable)</option>
                <option value="gemini-3.1-pro-preview">Gemini 3.1 Pro Preview (Advanced)</option>
              </select>
              <p className="text-xs text-slate-500 mt-2">
                Managed access uses Gemini 3.8 Flash. This preference applies only when you use your own Gemini API key.
              </p>
            </div>

            <div className="pt-4 border-t border-slate-800/80">
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-slate-200">
                  Your Gemini API Key (Optional BYOK)
                </label>
                <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full ${
                  hasAiApiKey()
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                    : 'bg-slate-800 text-slate-400 border border-slate-700'
                }`}>
                  {hasAiApiKey() ? 'Your key active' : hasManagedAiIdentity() ? 'Included access available' : currentUser ? 'Managed access unavailable here' : 'Sign in for included access'}
                </span>
              </div>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  placeholder="Paste your Gemini API key to use BYOK"
                  className="flex-1 bg-slate-950 border border-slate-700 text-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-indigo-500/50 outline-none"
                />
                <button
                  onClick={() => {
                    setEphemeralApiKey(apiKeyInput.trim() || null);
                    setKeySavedToast(true);
                    setTimeout(() => setKeySavedToast(false), 3000);
                  }}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-medium transition-colors"
                >
                  Save Key
                </button>
                {hasAiApiKey() && (
                  <button
                    onClick={() => {
                      setApiKeyInput('');
                      setEphemeralApiKey(null);
                    }}
                    className="px-3 py-2 bg-slate-800 hover:bg-rose-900/40 text-slate-400 hover:text-rose-300 border border-slate-700 rounded-lg text-xs font-medium transition-colors"
                  >
                    Clear
                  </button>
                )}
              </div>
              {keySavedToast && (
                <p className="text-xs text-emerald-400 mt-2 font-medium">✓ Runtime key updated in memory.</p>
              )}
              <div className="mt-3 p-3 bg-slate-950/60 rounded-lg border border-slate-800/80 text-xs text-slate-400 space-y-1">
                <p className="font-semibold text-slate-300">Security & Privacy Disclosures:</p>
                <ul className="list-disc list-inside space-y-0.5 text-slate-400">
                  <li>Your key is held <strong>in memory for this browser session only</strong>.</li>
                  <li>It is <strong>never</strong> written to disk, localStorage, or git.</li>
                  <li>It is sent directly from your browser only to Google's official Gemini endpoint.</li>
                  <li>Signed-in users receive 10 successful AI turns with Flowmate managed Gemini access for the lifetime of the account. After that, add your own key here to continue. BYOK keys remain browser-session-only.</li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* Feature Toggles */}
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

        {/* Privacy & Context (P1-03) */}
        <section id="privacy-settings-section">
          <h2 className="text-lg font-semibold text-slate-200 mb-4 flex items-center gap-2">
            <Shield size={18} className="text-indigo-400" /> Privacy & Context
          </h2>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-6">
            <p className="text-xs text-slate-400 leading-relaxed">
              Flowmate is built privacy-first. Every sensitive context source operates under explicit capability permissions.
              Live context is ephemeral and never silently written to persistent memory.
            </p>

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
        <section>
          <h2 className="text-lg font-semibold text-slate-200 mb-4">Sync & Backup</h2>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
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

        {/* Data Management */}
        <section>
          <h2 className="text-lg font-semibold text-slate-200 mb-4">Data Management</h2>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
            <p className="text-sm text-slate-400 mb-4">
              Your data is stored locally in your browser. Create backups regularly.
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

        {/* Debug Tools */}
        <section>
          <h2 className="text-lg font-semibold text-slate-200 mb-4">Debug Tools</h2>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
            <p className="text-sm text-slate-400">
              Advanced tools for troubleshooting and maintenance.
            </p>

            <div className="space-y-3">
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

      </div>
    </div>
  );
};

export default SettingsView;
