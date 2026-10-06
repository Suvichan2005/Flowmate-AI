import React, { useState, useRef } from 'react';
import { useStore } from '../store';
import { EntityKind, Entity } from '../types';
import { CalendarClock, Utensils, Upload, FileText, ExternalLink, Calendar as CalendarIcon, Clock, Loader2 } from 'lucide-react';
import MarkdownText from './MarkdownText';

const SchedulesView: React.FC = () => {
    const { entities, setView, addToast, addMessage, activeSessionId } = useStore();
    const [isUploading, setIsUploading] = useState(false);
    const classFileRef = useRef<HTMLInputElement>(null);
    const messFileRef = useRef<HTMLInputElement>(null);

    const handleFileUpload = (type: 'class' | 'mess') => (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setIsUploading(true);
        const reader = new FileReader();
        reader.onload = () => {
            const dataUrl = reader.result as string;
            const channel = activeSessionId || 'general';
            const prompt = type === 'class'
                ? 'Please parse this class schedule timetable image and schedule all recurring classes as events in my calendar.'
                : 'Please parse this mess dining menu image and save the daily breakfast, lunch, snacks, and dinner meal details.';
            
            addMessage('user', prompt, undefined, dataUrl, channel);
            addToast(`${type === 'class' ? 'Timetable' : 'Mess menu'} uploaded! Opening Chat for processing...`, 'success');
            setView('chat');
            setIsUploading(false);
        };
        reader.onerror = () => {
            addToast('Failed to read timetable file', 'error');
            setIsUploading(false);
        };
        reader.readAsDataURL(file);
    };

    // Filter for entities that represents schedules (if any created)
    const classSchedules = entities.filter(e => e.kind === EntityKind.NOTE && e.canonical_tags?.includes('class-schedule'));
    const messSchedules = entities.filter(e => e.kind === EntityKind.NOTE && e.canonical_tags?.includes('mess-schedule'));

    // Events for "Class Schedule" preview (recurring events)
    const recurringEvents = entities.filter(e => e.kind === EntityKind.EVENT && e.recurrence);

    return (
        <div className="flex flex-col h-full bg-slate-950 text-slate-100 p-6 overflow-y-auto">
            {/* Hidden File Inputs */}
            <input
                ref={classFileRef}
                type="file"
                accept="image/*,.pdf"
                className="hidden"
                onChange={handleFileUpload('class')}
            />
            <input
                ref={messFileRef}
                type="file"
                accept="image/*,.pdf"
                className="hidden"
                onChange={handleFileUpload('mess')}
            />

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
                            disabled={isUploading}
                            className="text-xs bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-300 px-3 py-1.5 rounded-lg border border-indigo-500/30 transition-colors flex items-center gap-2 disabled:opacity-50"
                            onClick={() => classFileRef.current?.click()}
                        >
                            {isUploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                            Upload Timetable
                        </button>
                    </div>

                    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 min-h-[300px]">
                        {recurringEvents.length > 0 ? (
                            <div className="space-y-2">
                                <h3 className="text-xs font-bold text-slate-500 uppercase mb-2">Recurring Classes</h3>
                                {recurringEvents.map(e => (
                                    <div key={e.id} className="flex items-center gap-3 p-2 bg-slate-950/50 rounded border border-slate-800/50">
                                        <div className="w-1 h-8 bg-indigo-500 rounded-full" />
                                        <div className="flex-1">
                                            <div className="text-sm font-medium text-slate-200">{e.title}</div>
                                            <div className="text-xs text-slate-500">
                                                {new Date(e.start_time || '').toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • {e.recurrence}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="flex flex-col items-center justify-center h-full text-slate-500 gap-3">
                                <CalendarIcon size={32} className="opacity-20" />
                                <p className="text-sm text-center">No recurring classes found.</p>
                                <p className="text-xs text-center max-w-[200px] opacity-70">
                                    Upload a screenshot of your timetable in the Chat to automatically create events.
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
                            disabled={isUploading}
                            className="text-xs bg-orange-600/20 hover:bg-orange-600/40 text-orange-300 px-3 py-1.5 rounded-lg border border-orange-500/30 transition-colors flex items-center gap-2 disabled:opacity-50"
                            onClick={() => messFileRef.current?.click()}
                        >
                            {isUploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                            Upload Menu
                        </button>
                    </div>

                    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 min-h-[300px]">
                        {messSchedules.length > 0 ? (
                            <div className="space-y-4">
                                {messSchedules.map(note => (
                                    <div key={note.id} className="bg-slate-950 p-4 rounded-lg border border-slate-800">
                                        <h3 className="font-bold text-slate-200 mb-2 border-b border-slate-800 pb-2">{note.title}</h3>
                                        <div className="prose prose-invert prose-xs max-w-none text-slate-400">
                                            <MarkdownText content={note.description || ''} />
                                        </div>
                                        <div className="mt-3 text-[10px] text-slate-600">
                                            Updated: {new Date(note.updated_at).toLocaleDateString()}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="flex flex-col items-center justify-center h-full text-slate-500 gap-3">
                                <Utensils size={32} className="opacity-20" />
                                <p className="text-sm text-center">No mess menu found.</p>
                                <p className="text-xs text-center max-w-[200px] opacity-70">
                                    Upload a photo of the menu board in Chat to digitize it.
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
                        Once you upload a <strong>Class Schedule</strong>, it will create recurring events on your calendar.
                        With a <strong>Mess Menu</strong>, the AI will know what's for lunch when you ask, and can help you track your nutrition in the 'Food' chat channel.
                    </p>
                </div>
            </div>
        </div>
    );
};

export default SchedulesView;
