import React, { useState, useEffect } from 'react';
import { useStore } from '../store';
import {
  ExtractedClassSlot,
  ExtractedMessMenu,
  extractTimetableFromImage,
  extractMessMenuFromImage,
  createTimetableOperations,
  createMessMenuOperation,
  buildAttendanceBridge,
  DAY_MAP,
} from '../services/ai/timetable';
import { processFileAttachment } from '../utils/imageProcessing';
import {
  X,
  Check,
  Plus,
  Trash2,
  Clock,
  Calendar,
  Loader2,
  AlertCircle,
  Sparkles,
  Utensils,
  BookOpen,
  MapPin,
  RefreshCw,
} from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';

interface ScheduleImportModalProps {
  type: 'class' | 'mess';
  file: File;
  onClose: () => void;
  onSuccess: (count: number) => void;
}

const DAYS_OF_WEEK: ExtractedClassSlot['dayOfWeek'][] = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];

const ScheduleImportModal: React.FC<ScheduleImportModalProps> = ({
  type,
  file,
  onClose,
  onSuccess,
}) => {
  const { applyOperations, subjects, classSchedule, addToast, settings } = useStore();

  const [step, setStep] = useState<'analyzing' | 'review' | 'error'>('analyzing');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string>('');
  const [dataUrl, setDataUrl] = useState<string>('');

  // Class timetable state
  const [classes, setClasses] = useState<ExtractedClassSlot[]>([]);

  // Mess menu state
  const [messMenu, setMessMenu] = useState<ExtractedMessMenu | null>(null);
  const [messTitle, setMessTitle] = useState('');
  const [messMarkdown, setMessMarkdown] = useState('');

  // Run AI extraction on mount
  useEffect(() => {
    let isMounted = true;

    const runExtraction = async () => {
      try {
        setStep('analyzing');
        setErrorMessage(null);

        // Process file for vision input (compression + resize for images, base64 for PDFs)
        const base64 = await processFileAttachment(file);
        if (!isMounted) return;

        setDataUrl(base64);
        setPreviewUrl(base64.startsWith('data:image') ? base64 : '');

        if (type === 'class') {
          const extracted = await extractTimetableFromImage(base64, settings.preferred_model);
          if (!isMounted) return;

          if (extracted.length === 0) {
            setStep('error');
            setErrorMessage('No recurring class slots could be detected in this image. You can try another clearer image or add classes manually.');
            return;
          }

          setClasses(extracted);
          setStep('review');
        } else {
          const extracted = await extractMessMenuFromImage(base64, settings.preferred_model);
          if (!isMounted) return;

          setMessMenu(extracted);
          setMessTitle(extracted.title || 'Hostel Mess Menu');
          setMessMarkdown(extracted.rawMarkdown || '');
          setStep('review');
        }
      } catch (err: any) {
        if (!isMounted) return;
        console.error('Schedule extraction failed:', err);
        setStep('error');
        setErrorMessage(
          err?.message || 'Failed to extract schedules from the uploaded file. Please check your network and API key.'
        );
      }
    };

    runExtraction();

    return () => {
      isMounted = false;
    };
  }, [file, type, settings.preferred_model]);

  // Class manipulation handlers
  const handleToggleSelect = (id: string) => {
    setClasses(prev =>
      prev.map(c => (c.id === id ? { ...c, selected: !c.selected } : c))
    );
  };

  const handleSelectAll = (select: boolean) => {
    setClasses(prev => prev.map(c => ({ ...c, selected: select })));
  };

  const handleUpdateClass = (id: string, updates: Partial<ExtractedClassSlot>) => {
    setClasses(prev =>
      prev.map(c => {
        if (c.id !== id) return c;
        const updated = { ...c, ...updates };
        if (updates.dayOfWeek) {
          updated.dayIndex = DAY_MAP[updates.dayOfWeek.toLowerCase()] ?? 1;
        }
        return updated;
      })
    );
  };

  const handleDeleteClass = (id: string) => {
    setClasses(prev => prev.filter(c => c.id !== id));
  };

  const handleAddClass = () => {
    const newSlot: ExtractedClassSlot = {
      id: uuidv4(),
      subject: 'New Course',
      dayOfWeek: 'Monday',
      dayIndex: 1,
      startTime: '09:00',
      endTime: '10:00',
      room: '',
      instructor: '',
      selected: true,
    };
    setClasses(prev => [...prev, newSlot]);
  };

  // Commit handlers
  const handleConfirmClasses = () => {
    const selectedClasses = classes.filter(c => c.selected);
    if (selectedClasses.length === 0) {
      addToast('Please select at least one class to import', 'warning');
      return;
    }

    try {
      // 1. Create EVENT operations with WEEKLY recurrence
      const ops = createTimetableOperations(selectedClasses);

      // 2. Synchronize store subjects and classSchedule for AttendanceTracker
      const { updatedSubjects, updatedSchedules } = buildAttendanceBridge(
        selectedClasses,
        subjects,
        classSchedule
      );

      useStore.setState({
        subjects: updatedSubjects,
        classSchedule: updatedSchedules,
      });

      // 3. Apply operations to store (creates entities and syncs to cloud if enabled)
      applyOperations(ops);

      addToast(`Successfully imported ${selectedClasses.length} recurring classes!`, 'success');
      onSuccess(selectedClasses.length);
      onClose();
    } catch (err: any) {
      console.error('Failed to commit timetable operations:', err);
      addToast('Failed to save classes to schedule', 'error');
    }
  };

  const handleConfirmMess = () => {
    if (!messMarkdown.trim()) {
      addToast('Mess menu cannot be empty', 'warning');
      return;
    }

    try {
      const op = createMessMenuOperation({
        title: messTitle.trim() || 'Hostel Mess Menu',
        days: messMenu?.days || [],
        notes: messMenu?.notes,
        rawMarkdown: messMarkdown,
      });

      applyOperations([op]);

      addToast('Successfully saved dining mess menu!', 'success');
      onSuccess(1);
      onClose();
    } catch (err: any) {
      console.error('Failed to commit mess menu operation:', err);
      addToast('Failed to save mess menu', 'error');
    }
  };

  const selectedCount = classes.filter(c => c.selected).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/50">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-xl ${type === 'class' ? 'bg-indigo-500/10 text-indigo-400' : 'bg-orange-500/10 text-orange-400'}`}>
              {type === 'class' ? <BookOpen size={20} /> : <Utensils size={20} />}
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
                {type === 'class' ? 'Import Class Timetable' : 'Import Dining Mess Menu'}
                <span className="text-xs font-normal text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded-full border border-indigo-500/20 flex items-center gap-1">
                  <Sparkles size={10} />
                  AI Vision
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                {file.name} ({(file.size / 1024).toFixed(1)} KB)
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* STEP 1: ANALYZING */}
          {step === 'analyzing' && (
            <div className="flex flex-col items-center justify-center py-16 text-center space-y-4">
              <div className="relative">
                <div className="w-16 h-16 rounded-2xl bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
                  <Loader2 className="w-8 h-8 animate-spin" />
                </div>
                <div className="absolute -top-1 -right-1 w-4 h-4 bg-indigo-500 rounded-full animate-ping" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-medium text-slate-200">
                  Analyzing {type === 'class' ? 'Timetable Schedule' : 'Dining Menu'} with Gemini AI...
                </h3>
                <p className="text-xs text-slate-400 max-w-md">
                  {type === 'class'
                    ? 'Detecting courses, day grids, lecture periods, and room numbers...'
                    : 'Parsing daily breakfast, lunch, snacks, and dinner meal details...'}
                </p>
              </div>
              {previewUrl && (
                <div className="mt-4 max-w-xs max-h-40 rounded-xl overflow-hidden border border-slate-800 shadow-md">
                  <img src={previewUrl} alt="Upload preview" className="w-full h-full object-cover opacity-80" />
                </div>
              )}
            </div>
          )}

          {/* STEP 2: ERROR */}
          {step === 'error' && (
            <div className="flex flex-col items-center justify-center py-12 text-center space-y-4">
              <div className="w-14 h-14 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400">
                <AlertCircle size={28} />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-semibold text-slate-200">Extraction Could Not Be Completed</h3>
                <p className="text-xs text-rose-300 max-w-md bg-rose-500/10 p-3 rounded-lg border border-rose-500/20 text-left">
                  {errorMessage}
                </p>
              </div>
              <div className="flex items-center gap-3 mt-4">
                <button
                  onClick={onClose}
                  className="px-4 py-2 text-xs font-medium text-slate-400 hover:text-slate-200 bg-slate-800 hover:bg-slate-700 rounded-xl transition-colors"
                >
                  Cancel
                </button>
                {type === 'class' && (
                  <button
                    onClick={() => {
                      setStep('review');
                      handleAddClass();
                    }}
                    className="px-4 py-2 text-xs font-medium text-indigo-300 hover:text-white bg-indigo-600/30 hover:bg-indigo-600 rounded-xl transition-colors border border-indigo-500/30 flex items-center gap-2"
                  >
                    <Plus size={14} />
                    Enter Classes Manually
                  </button>
                )}
              </div>
            </div>
          )}

          {/* STEP 3: REVIEW CLASS TIMETABLE */}
          {step === 'review' && type === 'class' && (
            <div className="space-y-4">
              {/* Review summary header */}
              <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-950/60 p-3.5 rounded-xl border border-slate-800/80">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-indigo-300 bg-indigo-500/15 px-2.5 py-1 rounded-lg border border-indigo-500/20">
                    {classes.length} classes detected
                  </span>
                  <span className="text-xs text-slate-400">
                    ({selectedCount} selected for import)
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleSelectAll(true)}
                    className="text-[11px] text-slate-400 hover:text-slate-200 px-2 py-1 rounded hover:bg-slate-800"
                  >
                    Select All
                  </button>
                  <button
                    onClick={() => handleSelectAll(false)}
                    className="text-[11px] text-slate-400 hover:text-slate-200 px-2 py-1 rounded hover:bg-slate-800"
                  >
                    Deselect All
                  </button>
                  <button
                    onClick={handleAddClass}
                    className="text-xs text-indigo-400 hover:text-indigo-300 bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/30 px-3 py-1 rounded-lg flex items-center gap-1.5 transition-colors"
                  >
                    <Plus size={13} />
                    Add Class
                  </button>
                </div>
              </div>

              {/* Editable Class Slots Table */}
              <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-950/40">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs text-slate-300">
                    <thead className="bg-slate-900/80 text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-800">
                      <tr>
                        <th className="py-2.5 px-3 w-10 text-center">Import</th>
                        <th className="py-2.5 px-3">Subject / Course</th>
                        <th className="py-2.5 px-3 w-32">Day</th>
                        <th className="py-2.5 px-3 w-24">Start</th>
                        <th className="py-2.5 px-3 w-24">End</th>
                        <th className="py-2.5 px-3 w-28">Room</th>
                        <th className="py-2.5 px-3 w-10"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {classes.map(item => (
                        <tr
                          key={item.id}
                          className={`transition-colors hover:bg-slate-900/50 ${!item.selected ? 'opacity-40 bg-slate-950/20' : ''}`}
                        >
                          {/* Checkbox */}
                          <td className="py-2.5 px-3 text-center">
                            <input
                              type="checkbox"
                              checked={!!item.selected}
                              onChange={() => handleToggleSelect(item.id)}
                              className="w-4 h-4 rounded text-indigo-600 bg-slate-800 border-slate-700 focus:ring-indigo-500 focus:ring-offset-slate-900 cursor-pointer"
                            />
                          </td>

                          {/* Subject */}
                          <td className="py-2.5 px-3">
                            <input
                              type="text"
                              value={item.subject}
                              onChange={e => handleUpdateClass(item.id, { subject: e.target.value })}
                              className="w-full bg-slate-900/60 border border-slate-800 focus:border-indigo-500 rounded px-2.5 py-1 text-slate-200 text-xs focus:outline-none"
                              placeholder="Course Name"
                            />
                          </td>

                          {/* Day of Week */}
                          <td className="py-2.5 px-3">
                            <select
                              value={item.dayOfWeek}
                              onChange={e => handleUpdateClass(item.id, { dayOfWeek: e.target.value as any })}
                              className="w-full bg-slate-900/60 border border-slate-800 focus:border-indigo-500 rounded px-2 py-1 text-slate-200 text-xs focus:outline-none"
                            >
                              {DAYS_OF_WEEK.map(d => (
                                <option key={d} value={d}>
                                  {d}
                                </option>
                              ))}
                            </select>
                          </td>

                          {/* Start Time */}
                          <td className="py-2.5 px-3">
                            <input
                              type="text"
                              value={item.startTime}
                              onChange={e => handleUpdateClass(item.id, { startTime: e.target.value })}
                              className="w-full bg-slate-900/60 border border-slate-800 focus:border-indigo-500 rounded px-2 py-1 text-slate-200 text-xs font-mono focus:outline-none text-center"
                              placeholder="09:00"
                            />
                          </td>

                          {/* End Time */}
                          <td className="py-2.5 px-3">
                            <input
                              type="text"
                              value={item.endTime}
                              onChange={e => handleUpdateClass(item.id, { endTime: e.target.value })}
                              className="w-full bg-slate-900/60 border border-slate-800 focus:border-indigo-500 rounded px-2 py-1 text-slate-200 text-xs font-mono focus:outline-none text-center"
                              placeholder="10:00"
                            />
                          </td>

                          {/* Room */}
                          <td className="py-2.5 px-3">
                            <input
                              type="text"
                              value={item.room || ''}
                              onChange={e => handleUpdateClass(item.id, { room: e.target.value })}
                              className="w-full bg-slate-900/60 border border-slate-800 focus:border-indigo-500 rounded px-2 py-1 text-slate-300 text-xs focus:outline-none"
                              placeholder="LH-101"
                            />
                          </td>

                          {/* Delete */}
                          <td className="py-2.5 px-3 text-right">
                            <button
                              onClick={() => handleDeleteClass(item.id)}
                              className="text-slate-500 hover:text-rose-400 p-1 rounded hover:bg-slate-800 transition-colors"
                              title="Remove slot"
                            >
                              <Trash2 size={13} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: REVIEW MESS MENU */}
          {step === 'review' && type === 'mess' && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Menu Title</label>
                <input
                  type="text"
                  value={messTitle}
                  onChange={e => setMessTitle(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 focus:border-orange-500 rounded-xl px-3 py-2 text-slate-200 text-sm focus:outline-none"
                  placeholder="Hostel Mess Dining Menu"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">
                  Extracted Dining Schedule (Markdown)
                </label>
                <textarea
                  value={messMarkdown}
                  onChange={e => setMessMarkdown(e.target.value)}
                  rows={12}
                  className="w-full bg-slate-950 border border-slate-800 focus:border-orange-500 rounded-xl p-3 text-slate-200 text-xs font-mono focus:outline-none resize-none leading-relaxed"
                  placeholder="Markdown menu content..."
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-800 bg-slate-900/50">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-slate-400 hover:text-slate-200 bg-slate-800/80 hover:bg-slate-800 rounded-xl transition-colors"
          >
            Cancel
          </button>

          {step === 'review' && (
            <button
              onClick={type === 'class' ? handleConfirmClasses : handleConfirmMess}
              disabled={type === 'class' && selectedCount === 0}
              className={`flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-medium text-white shadow-lg transition-all active:scale-95 disabled:opacity-50 disabled:pointer-events-none ${
                type === 'class'
                  ? 'bg-indigo-600 hover:bg-indigo-500 shadow-indigo-600/20'
                  : 'bg-orange-600 hover:bg-orange-500 shadow-orange-600/20'
              }`}
            >
              <Check size={14} />
              {type === 'class'
                ? `Confirm & Add ${selectedCount} ${selectedCount === 1 ? 'Class' : 'Classes'} to Schedule`
                : 'Confirm & Save Mess Menu'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default ScheduleImportModal;
