import React, { useState, useMemo } from 'react';
import { useStore } from '../store';
import { Subject, ClassSchedule, Holiday, AttendanceLog } from '../types';
import {
    GraduationCap, Plus, Calendar, Check, X, Clock, BookOpen, User, MapPin,
    Percent, AlertTriangle, CheckCircle2, XCircle, CalendarOff, Trash2, ChevronDown, ChevronUp
} from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

const AttendanceTracker: React.FC = () => {
    const subjects = useStore(state => state.subjects);
    const classSchedule = useStore(state => state.classSchedule);
    const holidays = useStore(state => state.holidays);
    const attendanceLogs = useStore(state => state.attendanceLogs);

    const [showAddSubject, setShowAddSubject] = useState(false);
    const [expandedSubject, setExpandedSubject] = useState<string | null>(null);
    const [newSubject, setNewSubject] = useState({
        name: '',
        code: '',
        teacher_name: '',
        min_attendance: 75
    });
    const [scheduleSlots, setScheduleSlots] = useState<Array<{
        day: 0 | 1 | 2 | 3 | 4 | 5 | 6;
        start: string;
        end: string;
        room: string;
    }>>([{ day: 1, start: '09:00', end: '10:00', room: '' }]);

    // Calculate attendance stats per subject
    const subjectStats = useMemo(() => {
        return subjects.map(subject => {
            const logs = attendanceLogs.filter(l => l.subject_id === subject.id);
            const present = logs.filter(l => l.status === 'present').length;
            const absent = logs.filter(l => l.status === 'absent').length;
            const cancelled = logs.filter(l => l.status === 'cancelled').length;
            const total = present + absent;
            const percentage = total > 0 ? Math.round((present / total) * 100) : 100;

            // Calculate classes that can be skipped while staying above min_attendance
            const required = subject.min_attendance;
            const canSkip = total > 0
                ? Math.floor((present * 100 / required) - total)
                : 0;

            // Get schedule for this subject
            const schedule = classSchedule.filter(c => c.subject_id === subject.id);

            return {
                ...subject,
                present,
                absent,
                cancelled,
                total,
                percentage,
                canSkip: Math.max(0, canSkip),
                schedule,
                status: percentage >= subject.min_attendance ? 'safe' :
                    percentage >= subject.min_attendance - 5 ? 'warning' : 'danger'
            };
        });
    }, [subjects, attendanceLogs, classSchedule]);

    // Today's classes
    const todayClasses = useMemo(() => {
        const today = new Date().getDay() as 0 | 1 | 2 | 3 | 4 | 5 | 6;
        const todayDate = new Date().toISOString().split('T')[0];

        // Check if today is a holiday
        const isHoliday = holidays.some(h => h.date === todayDate);
        if (isHoliday) return [];

        return classSchedule
            .filter(c => c.day_of_week === today)
            .map(c => {
                const subject = subjects.find(s => s.id === c.subject_id);
                const log = attendanceLogs.find(l =>
                    l.subject_id === c.subject_id && l.date === todayDate
                );
                return {
                    ...c,
                    subject,
                    logged: !!log,
                    logStatus: log?.status
                };
            })
            .sort((a, b) => a.start_time.localeCompare(b.start_time));
    }, [classSchedule, subjects, holidays, attendanceLogs]);

    // Weekly schedule overview
    const weeklySchedule = useMemo(() => {
        const week: Record<number, typeof classSchedule> = {};
        for (let i = 0; i < 7; i++) {
            week[i] = classSchedule.filter(c => c.day_of_week === i)
                .sort((a, b) => a.start_time.localeCompare(b.start_time));
        }
        return week;
    }, [classSchedule]);

    const addSlot = () => {
        setScheduleSlots([...scheduleSlots, { day: 1, start: '09:00', end: '10:00', room: '' }]);
    };

    const removeSlot = (index: number) => {
        setScheduleSlots(scheduleSlots.filter((_, i) => i !== index));
    };

    const updateSlot = (index: number, field: string, value: any) => {
        setScheduleSlots(scheduleSlots.map((slot, i) =>
            i === index ? { ...slot, [field]: value } : slot
        ));
    };

    const handleAddSubject = (e: React.FormEvent) => {
        e.preventDefault();
        if (!newSubject.name.trim()) return;

        const subjectId = uuidv4();

        // Add subject
        useStore.setState(state => ({
            subjects: [...state.subjects, {
                id: subjectId,
                name: newSubject.name.trim(),
                code: newSubject.code.trim() || undefined,
                teacher_name: newSubject.teacher_name.trim() || undefined,
                min_attendance: newSubject.min_attendance,
                color: ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6'][state.subjects.length % 6]
            }]
        }));

        // Add schedule slots
        if (scheduleSlots.length > 0) {
            useStore.setState(state => ({
                classSchedule: [
                    ...state.classSchedule,
                    ...scheduleSlots.map(slot => ({
                        id: uuidv4(),
                        subject_id: subjectId,
                        day_of_week: slot.day,
                        start_time: slot.start,
                        end_time: slot.end,
                        room: slot.room.trim() || undefined
                    }))
                ]
            }));
        }

        // Reset form
        setNewSubject({ name: '', code: '', teacher_name: '', min_attendance: 75 });
        setScheduleSlots([{ day: 1, start: '09:00', end: '10:00', room: '' }]);
        setShowAddSubject(false);
    };

    const handleLogAttendance = (subjectId: string, status: 'present' | 'absent' | 'cancelled') => {
        const todayDate = new Date().toISOString().split('T')[0];

        // Remove existing log for today if any
        useStore.setState(state => ({
            attendanceLogs: [
                ...state.attendanceLogs.filter(l =>
                    !(l.subject_id === subjectId && l.date === todayDate)
                ),
                {
                    id: uuidv4(),
                    subject_id: subjectId,
                    date: todayDate,
                    status
                }
            ]
        }));
    };

    const handleDeleteSubject = (subjectId: string) => {
        if (!confirm('Delete this subject and all attendance records?')) return;
        useStore.setState(state => ({
            subjects: state.subjects.filter(s => s.id !== subjectId),
            classSchedule: state.classSchedule.filter(c => c.subject_id !== subjectId),
            attendanceLogs: state.attendanceLogs.filter(l => l.subject_id !== subjectId)
        }));
    };

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'safe': return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30';
            case 'warning': return 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30';
            case 'danger': return 'text-red-400 bg-red-500/10 border-red-500/30';
            default: return 'text-slate-400 bg-slate-500/10 border-slate-500/30';
        }
    };

    return (
        <div className="h-full overflow-y-auto">
            <div className="max-w-5xl mx-auto p-6 space-y-6">
                {/* Header */}
                <div className="flex items-center justify-between flex-wrap gap-4 pl-8">
                    <div>
                        <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
                            <GraduationCap className="text-blue-400" /> Attendance Tracker
                        </h1>
                        <p className="text-sm text-slate-500">Track class attendance & calculate skip limits</p>
                    </div>
                    <button
                        onClick={() => setShowAddSubject(true)}
                        className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600 text-white rounded-lg font-medium shadow-lg shadow-blue-500/20 transition-all"
                    >
                        <Plus size={18} /> Add Subject
                    </button>
                </div>

                {/* Today's Classes */}
                {todayClasses.length > 0 && (
                    <div className="bg-gradient-to-r from-cyan-500/10 to-blue-500/10 border border-cyan-500/30 rounded-xl p-4">
                        <h3 className="text-sm font-medium text-cyan-300 mb-3 flex items-center gap-2">
                            <Calendar size={14} /> Today's Classes ({DAYS[new Date().getDay()]})
                        </h3>
                        <div className="space-y-2">
                            {todayClasses.map(cls => (
                                <div key={cls.id} className="flex items-center justify-between p-3 bg-slate-900/60 rounded-lg">
                                    <div className="flex items-center gap-4">
                                        <div className="text-center">
                                            <div className="text-sm font-medium text-cyan-400">{cls.start_time}</div>
                                            <div className="text-[10px] text-slate-500">{cls.end_time}</div>
                                        </div>
                                        <div>
                                            <div className="text-sm font-medium text-slate-200">
                                                {cls.subject?.name || 'Unknown'}
                                            </div>
                                            <div className="flex items-center gap-2 text-[10px] text-slate-500">
                                                {cls.room && (
                                                    <span className="flex items-center gap-0.5">
                                                        <MapPin size={10} /> {cls.room}
                                                    </span>
                                                )}
                                                {cls.subject?.teacher_name && (
                                                    <span className="flex items-center gap-0.5">
                                                        <User size={10} /> {cls.subject.teacher_name}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                    {!cls.logged ? (
                                        <div className="flex gap-1">
                                            <button
                                                onClick={() => handleLogAttendance(cls.subject_id, 'present')}
                                                className="px-2 py-1.5 bg-emerald-500/20 text-emerald-400 rounded text-xs font-medium hover:bg-emerald-500/30 transition-colors flex items-center gap-1"
                                            >
                                                <Check size={12} /> Present
                                            </button>
                                            <button
                                                onClick={() => handleLogAttendance(cls.subject_id, 'absent')}
                                                className="px-2 py-1.5 bg-red-500/20 text-red-400 rounded text-xs font-medium hover:bg-red-500/30 transition-colors flex items-center gap-1"
                                            >
                                                <X size={12} /> Absent
                                            </button>
                                            <button
                                                onClick={() => handleLogAttendance(cls.subject_id, 'cancelled')}
                                                className="px-2 py-1.5 bg-slate-500/20 text-slate-400 rounded text-xs font-medium hover:bg-slate-500/30 transition-colors flex items-center gap-1"
                                            >
                                                <CalendarOff size={12} /> Off
                                            </button>
                                        </div>
                                    ) : (
                                        <span className={`text-xs px-2 py-1 rounded ${cls.logStatus === 'present' ? 'text-emerald-400 bg-emerald-500/20' :
                                                cls.logStatus === 'absent' ? 'text-red-400 bg-red-500/20' :
                                                    'text-slate-400 bg-slate-500/20'
                                            }`}>
                                            {cls.logStatus === 'present' ? '✓ Present' :
                                                cls.logStatus === 'absent' ? '✗ Absent' : '— Cancelled'}
                                        </span>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Weekly Schedule Overview */}
                {classSchedule.length > 0 && (
                    <div className="bg-slate-800/30 border border-slate-700/50 rounded-xl p-4">
                        <h3 className="text-sm font-medium text-slate-300 mb-3 flex items-center gap-2">
                            <Clock size={14} /> Weekly Schedule
                        </h3>
                        <div className="grid grid-cols-7 gap-1 text-[10px]">
                            {DAYS.map((day, i) => (
                                <div key={day} className="text-center">
                                    <div className="font-medium text-slate-400 mb-1">{day}</div>
                                    <div className="space-y-0.5">
                                        {weeklySchedule[i]?.map(cls => {
                                            const subject = subjects.find(s => s.id === cls.subject_id);
                                            return (
                                                <div
                                                    key={cls.id}
                                                    className="px-1 py-0.5 rounded text-[8px] truncate"
                                                    style={{ backgroundColor: (subject?.color || '#6366f1') + '30', color: subject?.color || '#6366f1' }}
                                                    title={`${subject?.name} ${cls.start_time}-${cls.end_time} ${cls.room || ''}`}
                                                >
                                                    {cls.start_time}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Subject Cards */}
                {subjectStats.length > 0 ? (
                    <div className="grid md:grid-cols-2 gap-4">
                        {subjectStats.map(subject => (
                            <div
                                key={subject.id}
                                className={`border rounded-xl p-4 ${getStatusColor(subject.status)}`}
                            >
                                <div className="flex items-start justify-between mb-3">
                                    <div className="flex-1">
                                        <div className="flex items-center gap-2">
                                            <h3 className="font-medium text-slate-200">{subject.name}</h3>
                                            {subject.code && (
                                                <span className="text-[10px] px-1.5 py-0.5 bg-slate-700/50 rounded text-slate-400">
                                                    {subject.code}
                                                </span>
                                            )}
                                        </div>
                                        {subject.teacher_name && (
                                            <div className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                                                <User size={10} /> {subject.teacher_name}
                                            </div>
                                        )}
                                    </div>
                                    <div className="text-right">
                                        <div className="text-2xl font-bold">{subject.percentage}%</div>
                                        <div className="text-[10px] text-slate-500">
                                            min {subject.min_attendance}%
                                        </div>
                                    </div>
                                </div>

                                <div className="flex items-center gap-4 text-xs mb-3">
                                    <span className="flex items-center gap-1 text-emerald-400">
                                        <CheckCircle2 size={10} /> {subject.present} P
                                    </span>
                                    <span className="flex items-center gap-1 text-red-400">
                                        <XCircle size={10} /> {subject.absent} A
                                    </span>
                                    {subject.cancelled > 0 && (
                                        <span className="flex items-center gap-1 text-slate-500">
                                            <CalendarOff size={10} /> {subject.cancelled} C
                                        </span>
                                    )}
                                </div>

                                {/* Schedule for this subject */}
                                {subject.schedule.length > 0 && (
                                    <div className="text-[10px] text-slate-500 mb-3 flex flex-wrap gap-2">
                                        {subject.schedule.map(s => (
                                            <span key={s.id} className="px-1.5 py-0.5 bg-slate-700/30 rounded">
                                                {DAYS[s.day_of_week]} {s.start_time}{s.room ? ` @${s.room}` : ''}
                                            </span>
                                        ))}
                                    </div>
                                )}

                                <div className="flex items-center justify-between">
                                    {subject.canSkip > 0 ? (
                                        <span className="text-xs text-emerald-400 flex items-center gap-1">
                                            ✓ Can skip {subject.canSkip} more
                                        </span>
                                    ) : (
                                        <span className="text-xs text-red-400 flex items-center gap-1">
                                            <AlertTriangle size={10} /> Don't skip!
                                        </span>
                                    )}
                                    <button
                                        onClick={() => handleDeleteSubject(subject.id)}
                                        className="p-1.5 text-slate-600 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
                                        title="Delete subject"
                                    >
                                        <Trash2 size={12} />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="text-center py-12 text-slate-500">
                        <GraduationCap size={48} className="mx-auto mb-3 opacity-50" />
                        <p className="text-lg font-medium">No subjects added</p>
                        <p className="text-sm">Add your subjects to start tracking attendance</p>
                    </div>
                )}

                {/* Add Subject Modal */}
                {showAddSubject && (
                    <>
                        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40" onClick={() => setShowAddSubject(false)} />
                        <div className="fixed inset-0 flex items-center justify-center z-50 p-4 overflow-y-auto">
                            <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-lg shadow-2xl my-8">
                                <h2 className="text-lg font-bold text-slate-100 mb-4 flex items-center gap-2">
                                    <BookOpen className="text-blue-400" /> Add Subject
                                </h2>
                                <form onSubmit={handleAddSubject} className="space-y-4">
                                    {/* Basic Info */}
                                    <div>
                                        <label className="block text-xs text-slate-500 mb-1">Subject Name *</label>
                                        <input
                                            type="text"
                                            value={newSubject.name}
                                            onChange={e => setNewSubject({ ...newSubject, name: e.target.value })}
                                            placeholder="e.g., Artificial Intelligence"
                                            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-blue-500"
                                            autoFocus
                                        />
                                    </div>

                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-xs text-slate-500 mb-1">Code</label>
                                            <input
                                                type="text"
                                                value={newSubject.code}
                                                onChange={e => setNewSubject({ ...newSubject, code: e.target.value })}
                                                placeholder="CS401"
                                                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-blue-500"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs text-slate-500 mb-1">Min Attendance %</label>
                                            <input
                                                type="number"
                                                min="0"
                                                max="100"
                                                value={newSubject.min_attendance}
                                                onChange={e => setNewSubject({ ...newSubject, min_attendance: parseInt(e.target.value) || 75 })}
                                                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-blue-500"
                                            />
                                        </div>
                                    </div>

                                    <div>
                                        <label className="block text-xs text-slate-500 mb-1">Teacher Name</label>
                                        <input
                                            type="text"
                                            value={newSubject.teacher_name}
                                            onChange={e => setNewSubject({ ...newSubject, teacher_name: e.target.value })}
                                            placeholder="Prof. Ronaly Padhy"
                                            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-blue-500"
                                        />
                                    </div>

                                    {/* Schedule Slots */}
                                    <div>
                                        <div className="flex items-center justify-between mb-2">
                                            <label className="block text-xs text-slate-500">Class Schedule</label>
                                            <button
                                                type="button"
                                                onClick={addSlot}
                                                className="text-xs text-blue-400 hover:text-blue-300"
                                            >
                                                + Add Slot
                                            </button>
                                        </div>
                                        <div className="space-y-2 max-h-48 overflow-y-auto">
                                            {scheduleSlots.map((slot, i) => (
                                                <div key={i} className="flex items-center gap-2 p-2 bg-slate-800/50 rounded-lg">
                                                    <select
                                                        value={slot.day}
                                                        onChange={e => updateSlot(i, 'day', parseInt(e.target.value))}
                                                        className="bg-slate-700 border-0 rounded px-2 py-1 text-xs text-slate-200"
                                                    >
                                                        {DAYS.map((d, di) => (
                                                            <option key={d} value={di}>{d}</option>
                                                        ))}
                                                    </select>
                                                    <input
                                                        type="time"
                                                        value={slot.start}
                                                        onChange={e => updateSlot(i, 'start', e.target.value)}
                                                        className="bg-slate-700 border-0 rounded px-2 py-1 text-xs text-slate-200"
                                                    />
                                                    <span className="text-slate-500 text-xs">-</span>
                                                    <input
                                                        type="time"
                                                        value={slot.end}
                                                        onChange={e => updateSlot(i, 'end', e.target.value)}
                                                        className="bg-slate-700 border-0 rounded px-2 py-1 text-xs text-slate-200"
                                                    />
                                                    <input
                                                        type="text"
                                                        value={slot.room}
                                                        onChange={e => updateSlot(i, 'room', e.target.value)}
                                                        placeholder="Room"
                                                        className="bg-slate-700 border-0 rounded px-2 py-1 text-xs text-slate-200 w-16"
                                                    />
                                                    {scheduleSlots.length > 1 && (
                                                        <button
                                                            type="button"
                                                            onClick={() => removeSlot(i)}
                                                            className="text-slate-500 hover:text-red-400"
                                                        >
                                                            <X size={14} />
                                                        </button>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                        <p className="text-[10px] text-slate-600 mt-1">
                                            e.g., Mon 9:00-10:00 @ A-310, Tue 11:00-12:00 @ B-111
                                        </p>
                                    </div>

                                    <div className="flex gap-3 pt-2">
                                        <button
                                            type="button"
                                            onClick={() => setShowAddSubject(false)}
                                            className="flex-1 py-2 bg-slate-800 text-slate-300 rounded-lg hover:bg-slate-700 transition-colors"
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            type="submit"
                                            disabled={!newSubject.name.trim()}
                                            className="flex-1 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 transition-colors"
                                        >
                                            Add Subject
                                        </button>
                                    </div>
                                </form>
                            </div>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export default AttendanceTracker;
