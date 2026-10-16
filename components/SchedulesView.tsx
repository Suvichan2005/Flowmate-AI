import React, { useState, useRef, useMemo } from 'react';
import { useStore } from '../store';
import { getActiveEntities } from '../store/helpers';
import { EntityKind, Entity } from '../types';
import {
    CalendarClock,
    Utensils,
    Upload,
    FileText,
    Calendar as CalendarIcon,
    Clock,
    Trash2,
    BookOpen,
    MapPin,
    User,
    Repeat,
} from 'lucide-react';
import MarkdownText from './MarkdownText';
import ScheduleImportModal from './ScheduleImportModal';

const SchedulesView: React.FC = () => {
    const { entities: rawEntities, selectEntity, deleteEntity, addToast } = useStore();
    const entities = useMemo(() => getActiveEntities(rawEntities), [rawEntities]);

    const [importFile, setImportFile] = useState<{ file: File; type: 'class' | 'mess' } | null>(null);
    const classFileRef = useRef<HTMLInputElement>(null);
    const messFileRef = useRef<HTMLInputElement>(null);

    const handleFileSelect = (type: 'class' | 'mess') => (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        // Open in-place import modal
        setImportFile({ file, type });

        // Reset input value so the same file can be re-selected if canceled
        e.target.value = '';
    };

    const handleDeleteRecurringEvent = (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        deleteEntity(id);
        addToast('Removed recurring class from schedule', 'info');
    };

    const handleDeleteMessNote = (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        deleteEntity(id);
        addToast('Removed mess menu', 'info');
    };

    // Filter for entities that represent schedules
    const messSchedules = entities.filter(
        e => e.kind === EntityKind.NOTE && e.canonical_tags?.includes('mess-schedule')
    );

    // Events for "Class Schedule" preview (recurring events)
    const recurringEvents = entities.filter(
        e => e.kind === EntityKind.EVENT && e.recurrence
    );

    return (
        <div className="flex flex-col h-full bg-slate-950 text-slate-100 p-6 overflow-y-auto">
            {/* Hidden File Inputs */}
            <input
                ref={classFileRef}
                type="file"
                accept="image/*,.pdf"
                className="hidden"
                onChange={handleFileSelect('class')}
            />
            <input
                ref={messFileRef}
                type="file"
                accept="image/*,.pdf"
                className="hidden"
                onChange={handleFileSelect('mess')}
            />

            {/* In-Place Schedule Import Modal */}
            {importFile && (
                <ScheduleImportModal
                    type={importFile.type}
                    file={importFile.file}
                    onClose={() => setImportFile(null)}
                    onSuccess={() => setImportFile(null)}
                />
            )}

            <header className="flex items-center justify-between mb-8 pl-14">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <CalendarClock className="text-indigo-400" />
                        Schedules
                    </h1>
                    <p className="text-slate-400 text-sm mt-1">Manage your academic and dining timetables</p>
                </div>
            </header>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Class Schedule Section */}
                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <h2 className="text-lg font-semibold flex items-center gap-2 text-indigo-200">
                            <Clock size={18} />
                            Class Schedule
                        </h2>
                        <button
                            className="text-xs bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-300 px-3 py-1.5 rounded-lg border border-indigo-500/30 transition-colors flex items-center gap-2"
                            onClick={() => classFileRef.current?.click()}
                        >
                            <Upload size={12} />
                            Upload Timetable
                        </button>
                    </div>

                    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 min-h-[300px]">
                        {recurringEvents.length > 0 ? (
                            <div className="space-y-2">
                                <div className="flex items-center justify-between mb-2">
                                    <h3 className="text-xs font-bold text-slate-500 uppercase">
                                        Recurring Classes ({recurringEvents.length})
                                    </h3>
                                </div>
                                <div className="space-y-2">
                                    {recurringEvents.map(e => (
                                        <div
                                            key={e.id}
                                            onClick={() => selectEntity(e.id)}
                                            className="group flex items-center gap-3 p-2.5 bg-slate-950/60 hover:bg-slate-950 rounded-xl border border-slate-800/60 hover:border-indigo-500/40 transition-all cursor-pointer"
                                        >
                                            <div className="w-1.5 h-10 bg-indigo-500 rounded-full" />
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-sm font-medium text-slate-200 truncate">
                                                        {e.title}
                                                    </span>
                                                    <Repeat size={11} className="text-amber-400 shrink-0" />
                                                </div>
                                                <div className="text-xs text-slate-400 flex flex-wrap items-center gap-2 mt-0.5">
                                                    <span>
                                                        {e.metadata?.day_of_week ? `${e.metadata.day_of_week} ` : ''}
                                                        {new Date(e.start_time || '').toLocaleTimeString([], {
                                                            hour: '2-digit',
                                                            minute: '2-digit',
                                                        })}
                                                    </span>
                                                    <span>•</span>
                                                    <span>{e.recurrence}</span>
                                                    {e.metadata?.room && (
                                                        <>
                                                            <span>•</span>
                                                            <span className="flex items-center gap-1 text-indigo-300">
                                                                <MapPin size={11} />
                                                                {e.metadata.room}
                                                            </span>
                                                        </>
                                                    )}
                                                    {e.metadata?.instructor && (
                                                        <>
                                                            <span>•</span>
                                                            <span className="flex items-center gap-1 text-slate-400">
                                                                <User size={11} />
                                                                {e.metadata.instructor}
                                                            </span>
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                            <button
                                                onClick={ev => handleDeleteRecurringEvent(ev, e.id)}
                                                className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-rose-400 p-1.5 rounded-lg hover:bg-slate-900 transition-all"
                                                title="Remove recurring class"
                                            >
                                                <Trash2 size={13} />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ) : (
                            <div className="flex flex-col items-center justify-center h-full text-slate-500 gap-3 py-16">
                                <CalendarIcon size={32} className="opacity-20" />
                                <p className="text-sm text-center">No recurring classes found.</p>
                                <p className="text-xs text-center max-w-[220px] opacity-70">
                                    Click <strong>Upload Timetable</strong> above to import your weekly schedule with AI vision.
                                </p>
                            </div>
                        )}
                    </div>
                </div>

                {/* Mess Schedule Section */}
                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <h2 className="text-lg font-semibold flex items-center gap-2 text-orange-200">
                            <Utensils size={18} />
                            Mess Menu
                        </h2>
                        <button
                            className="text-xs bg-orange-600/20 hover:bg-orange-600/40 text-orange-300 px-3 py-1.5 rounded-lg border border-orange-500/30 transition-colors flex items-center gap-2"
                            onClick={() => messFileRef.current?.click()}
                        >
                            <Upload size={12} />
                            Upload Menu
                        </button>
                    </div>

                    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 min-h-[300px]">
                        {messSchedules.length > 0 ? (
                            <div className="space-y-4">
                                {messSchedules.map(note => (
                                    <div
                                        key={note.id}
                                        className="group bg-slate-950 p-4 rounded-xl border border-slate-800 hover:border-orange-500/30 transition-all"
                                    >
                                        <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-3">
                                            <h3 className="font-bold text-slate-200 text-sm">{note.title}</h3>
                                            <button
                                                onClick={ev => handleDeleteMessNote(ev, note.id)}
                                                className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-rose-400 p-1 rounded hover:bg-slate-900 transition-all"
                                                title="Delete mess menu"
                                            >
                                                <Trash2 size={13} />
                                            </button>
                                        </div>
                                        <div className="prose prose-invert prose-xs max-w-none text-slate-300 leading-relaxed">
                                            <MarkdownText content={note.description || ''} />
                                        </div>
                                        <div className="mt-3 text-[10px] text-slate-500">
                                            Updated: {new Date(note.updated_at).toLocaleDateString()}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="flex flex-col items-center justify-center h-full text-slate-500 gap-3 py-16">
                                <Utensils size={32} className="opacity-20" />
                                <p className="text-sm text-center">No mess menu found.</p>
                                <p className="text-xs text-center max-w-[220px] opacity-70">
                                    Click <strong>Upload Menu</strong> above to digitize your hostel dining schedule.
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Context Awareness Explainer */}
            <div className="mt-8 p-4 bg-slate-900/50 border border-indigo-500/20 rounded-xl flex items-start gap-3">
                <div className="p-2 bg-indigo-500/10 rounded-lg text-indigo-400">
                    <FileText size={20} />
                </div>
                <div>
                    <h3 className="font-semibold text-sm text-indigo-300 mb-1">How Schedules Work</h3>
                    <p className="text-xs text-slate-400 leading-relaxed">
                        Flowmate uses your uploaded schedules to organize your day.
                        Once you upload a <strong>Class Schedule</strong>, it will create recurring events on your calendar and populate your Attendance Tracker.
                        With a <strong>Mess Menu</strong>, the AI will know what&apos;s for lunch when you ask, and can help you track your nutrition in the &apos;Food&apos; chat channel.
                    </p>
                </div>
            </div>
        </div>
    );
};

export default SchedulesView;
