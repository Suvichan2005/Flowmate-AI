import React, { useRef } from 'react';
import { useStore } from '../store';
import { AlertTriangle, Download, Upload, FileText, Trash2, Bot, EyeOff } from 'lucide-react';
import { exportToMarkdown, downloadMarkdown } from '../utils/exportMarkdown';

const SettingsView: React.FC = () => {
  const { settings, updateSettings, entities, relationships, messages, importData } = useStore();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleChange = (key: keyof typeof settings, value: any) => {
    updateSettings({ [key]: value });
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

        {/* Model Settings */}
        <section>
          <h2 className="text-lg font-semibold text-slate-200 mb-4">Model Configuration</h2>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-2">Preferred Model</label>
              <select
                value={settings.preferred_model}
                onChange={(e) => handleChange('preferred_model', e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 text-slate-200 rounded-lg p-2.5 focus:ring-2 focus:ring-indigo-500/50 outline-none"
              >
                <option value="gemini-2.5-flash">Gemini 2.5 Flash (Recommended)</option>
                <option value="gemini-3-pro-preview">Gemini 3 Pro Preview</option>
                <option value="gpt-5-nano">GPT-5 Nano (Simulation)</option>
              </select>
              <p className="text-xs text-slate-500 mt-2">
                This model will be used by the orchestrator for all reasoning tasks.
              </p>
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
                <label className="block text-sm font-medium text-slate-200">🍕 Food Tracking</label>
                <p className="text-xs text-slate-500">Track meals, spending, and eating habits</p>
              </div>
              <button
                onClick={() => {
                  const current = settings.feature_toggles || { food_tracking: true, attendance_tracking: true, people_tracking: true };
                  handleChange('feature_toggles', { ...current, food_tracking: !current.food_tracking });
                }}
                className={`w-12 h-6 rounded-full transition-colors relative ${(settings.feature_toggles?.food_tracking ?? true) ? 'bg-indigo-600' : 'bg-slate-700'}`}
              >
                <span className={`absolute top-1 left-1 bg-white w-4 h-4 rounded-full transition-transform ${(settings.feature_toggles?.food_tracking ?? true) ? 'translate-x-6' : ''}`} />
              </button>
            </div>

            <div className="flex items-center justify-between py-2 border-b border-slate-800">
              <div>
                <label className="block text-sm font-medium text-slate-200">📚 Attendance Tracking</label>
                <p className="text-xs text-slate-500">Track class attendance and calculate skip limits</p>
              </div>
              <button
                onClick={() => {
                  const current = settings.feature_toggles || { food_tracking: true, attendance_tracking: true, people_tracking: true };
                  handleChange('feature_toggles', { ...current, attendance_tracking: !current.attendance_tracking });
                }}
                className={`w-12 h-6 rounded-full transition-colors relative ${(settings.feature_toggles?.attendance_tracking ?? true) ? 'bg-indigo-600' : 'bg-slate-700'}`}
              >
                <span className={`absolute top-1 left-1 bg-white w-4 h-4 rounded-full transition-transform ${(settings.feature_toggles?.attendance_tracking ?? true) ? 'translate-x-6' : ''}`} />
              </button>
            </div>

            <div className="flex items-center justify-between py-2">
              <div>
                <label className="block text-sm font-medium text-slate-200">👥 People Tracking</label>
                <p className="text-xs text-slate-500">Track relationships, promises, and contacts</p>
              </div>
              <button
                onClick={() => {
                  const current = settings.feature_toggles || { food_tracking: true, attendance_tracking: true, people_tracking: true };
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