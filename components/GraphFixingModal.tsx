import React, { useState, useEffect, useCallback } from 'react';
import { useStore } from '../store';
import { ToonOperation, EntityKind } from '../types';
import {
    analyzeGraphTopology,
    runGraphFixing,
    GraphAnalysis,
    FixProgress
} from '../services/graphAnalyzer';
import {
    X,
    Wand2,
    AlertCircle,
    CheckCircle,
    Loader2,
    GitBranch,
    Link2,
    Tag,
    Play,
    Eye,
    Check,
    XCircle
} from 'lucide-react';

interface GraphFixingModalProps {
    onClose: () => void;
}

const GraphFixingModal: React.FC<GraphFixingModalProps> = ({ onClose }) => {
    const { entities, relationships, applyOperations, addToast } = useStore();

    const [phase, setPhase] = useState<'idle' | 'analyzing' | 'processing' | 'reviewing' | 'applying'>('idle');
    const [analysis, setAnalysis] = useState<GraphAnalysis | null>(null);
    const [progress, setProgress] = useState<FixProgress | null>(null);
    const [suggestedOps, setSuggestedOps] = useState<ToonOperation[]>([]);
    const [selectedOps, setSelectedOps] = useState<Set<number>>(new Set());
    const [logs, setLogs] = useState<string[]>([]);

    // Run initial analysis
    useEffect(() => {
        const result = analyzeGraphTopology(entities, relationships);
        setAnalysis(result);
    }, [entities, relationships]);

    const handleStartFix = useCallback(async () => {
        setPhase('processing');
        setLogs(['Starting graph fixing process...']);

        try {
            const ops = await runGraphFixing(entities, relationships, (p) => {
                setProgress(p);
                setLogs(p.logs);
                if (p.phase === 'reviewing') {
                    setPhase('reviewing');
                    setSuggestedOps(p.operations);
                    // Select all by default
                    setSelectedOps(new Set(p.operations.map((_, i) => i)));
                }
            });
        } catch (error: any) {
            setLogs(prev => [...prev, `Error: ${error.message}`]);
            addToast('Graph fixing failed', 'error');
        }
    }, [entities, relationships, addToast]);

    const handleApply = () => {
        const opsToApply = suggestedOps.filter((_, i) => selectedOps.has(i));
        if (opsToApply.length === 0) {
            addToast('No operations selected', 'info');
            return;
        }

        setPhase('applying');
        applyOperations(opsToApply);
        addToast(`Applied ${opsToApply.length} graph fixes`, 'success');

        setTimeout(() => {
            onClose();
        }, 1000);
    };

    const toggleOp = (index: number) => {
        const next = new Set(selectedOps);
        if (next.has(index)) {
            next.delete(index);
        } else {
            next.add(index);
        }
        setSelectedOps(next);
    };

    const getOpDescription = (op: ToonOperation): string => {
        switch (op.type) {
            case 'link_entities':
                return `Link: ${op.payload.from?.slice(-6) || '?'} → ${op.payload.to?.slice(-6) || '?'} (${op.payload.type})`;
            case 'update_entity':
                const fields = Object.keys(op.payload.fields || {}).join(', ');
                return `Update: ${op.payload.id?.slice(-6)} → ${fields}`;
            case 'delete_entity':
                return `Delete: ${op.payload.id?.slice(-6)}`;
            default:
                return `${op.type}`;
        }
    };

    return (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-2xl max-h-[80vh] flex flex-col shadow-2xl overflow-hidden">

                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-slate-800">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center">
                            <Wand2 size={20} className="text-white" />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-white">Graph Fixing Mode</h2>
                            <p className="text-xs text-slate-400">AI-powered graph analysis and repair</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4">

                    {/* Analysis Summary */}
                    {analysis && phase === 'idle' && (
                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-3">
                                <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700">
                                    <div className="flex items-center gap-2 text-orange-400 mb-2">
                                        <AlertCircle size={16} />
                                        <span className="text-xs font-medium uppercase">Orphans</span>
                                    </div>
                                    <div className="text-2xl font-bold text-white">{analysis.orphans.length}</div>
                                    <div className="text-xs text-slate-500">Unconnected entities</div>
                                </div>

                                <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700">
                                    <div className="flex items-center gap-2 text-blue-400 mb-2">
                                        <GitBranch size={16} />
                                        <span className="text-xs font-medium uppercase">Clusters</span>
                                    </div>
                                    <div className="text-2xl font-bold text-white">{analysis.disjointGroups.length}</div>
                                    <div className="text-xs text-slate-500">Disconnected groups</div>
                                </div>

                                <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700">
                                    <div className="flex items-center gap-2 text-purple-400 mb-2">
                                        <Tag size={16} />
                                        <span className="text-xs font-medium uppercase">Missing Tags</span>
                                    </div>
                                    <div className="text-2xl font-bold text-white">{analysis.missingTags.length}</div>
                                    <div className="text-xs text-slate-500">Need context links</div>
                                </div>

                                <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700">
                                    <div className="flex items-center gap-2 text-emerald-400 mb-2">
                                        <Link2 size={16} />
                                        <span className="text-xs font-medium uppercase">Total Links</span>
                                    </div>
                                    <div className="text-2xl font-bold text-white">{analysis.totalRelationships}</div>
                                    <div className="text-xs text-slate-500">Existing relationships</div>
                                </div>
                            </div>

                            {/* Suggestions */}
                            {analysis.suggestions.length > 0 && (
                                <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4">
                                    <div className="text-sm font-medium text-amber-300 mb-2">Suggestions</div>
                                    <ul className="space-y-1">
                                        {analysis.suggestions.map((s, i) => (
                                            <li key={i} className="text-xs text-amber-200/80 flex items-start gap-2">
                                                <span className="text-amber-500 mt-0.5">•</span>
                                                {s}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}

                            {/* Orphan Preview */}
                            {analysis.orphans.length > 0 && (
                                <div className="border border-slate-700 rounded-xl overflow-hidden">
                                    <div className="bg-slate-800 px-4 py-2 text-xs font-medium text-slate-400">
                                        Orphan Entities (preview)
                                    </div>
                                    <div className="max-h-40 overflow-y-auto">
                                        {analysis.orphans.slice(0, 10).map(e => (
                                            <div key={e.id} className="px-4 py-2 border-t border-slate-800 flex items-center gap-3">
                                                <span className="text-xs px-2 py-0.5 rounded bg-slate-700 text-slate-300 font-mono">
                                                    {e.kind}
                                                </span>
                                                <span className="text-sm text-slate-200 truncate">{e.title}</span>
                                            </div>
                                        ))}
                                        {analysis.orphans.length > 10 && (
                                            <div className="px-4 py-2 text-xs text-slate-500 bg-slate-800/50">
                                                +{analysis.orphans.length - 10} more...
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Processing Phase */}
                    {phase === 'processing' && progress && (
                        <div className="space-y-4">
                            <div className="flex items-center gap-3">
                                <Loader2 className="w-5 h-5 text-indigo-400 animate-spin" />
                                <span className="text-white font-medium">Processing...</span>
                            </div>

                            {/* Progress Bar */}
                            <div className="w-full bg-slate-800 rounded-full h-2">
                                <div
                                    className="bg-indigo-500 h-2 rounded-full transition-all duration-300"
                                    style={{ width: `${(progress.currentChunk / (progress.totalChunks || 1)) * 100}%` }}
                                />
                            </div>
                            <div className="text-xs text-slate-400">
                                Chunk {progress.currentChunk} of {progress.totalChunks}
                            </div>

                            {/* Logs */}
                            <div className="bg-slate-950 rounded-lg p-3 max-h-40 overflow-y-auto font-mono text-xs">
                                {logs.map((log, i) => (
                                    <div key={i} className="text-slate-400">{log}</div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Review Phase */}
                    {phase === 'reviewing' && suggestedOps.length > 0 && (
                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2 text-emerald-400">
                                    <CheckCircle size={18} />
                                    <span className="font-medium">Review Suggested Changes</span>
                                </div>
                                <span className="text-xs text-slate-400">
                                    {selectedOps.size} of {suggestedOps.length} selected
                                </span>
                            </div>

                            <div className="border border-slate-700 rounded-xl overflow-hidden max-h-60 overflow-y-auto">
                                {suggestedOps.map((op, i) => (
                                    <div
                                        key={i}
                                        onClick={() => toggleOp(i)}
                                        className={`px-4 py-3 border-b border-slate-800 last:border-0 cursor-pointer flex items-center gap-3 hover:bg-slate-800/50 transition-colors ${selectedOps.has(i) ? 'bg-indigo-500/10' : ''
                                            }`}
                                    >
                                        <div className={`w-5 h-5 rounded border flex items-center justify-center ${selectedOps.has(i)
                                            ? 'bg-indigo-500 border-indigo-500'
                                            : 'border-slate-600'
                                            }`}>
                                            {selectedOps.has(i) && <Check size={12} className="text-white" />}
                                        </div>
                                        <span className="text-sm text-slate-300 flex-1">{getOpDescription(op)}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {phase === 'reviewing' && suggestedOps.length === 0 && (
                        <div className="text-center py-8">
                            <CheckCircle size={48} className="text-emerald-500 mx-auto mb-4" />
                            <h3 className="text-lg font-medium text-white mb-2">Graph looks healthy!</h3>
                            <p className="text-sm text-slate-400">No automatic fixes suggested.</p>
                        </div>
                    )}

                    {/* Applying Phase */}
                    {phase === 'applying' && (
                        <div className="text-center py-8">
                            <Loader2 size={48} className="text-indigo-500 mx-auto mb-4 animate-spin" />
                            <h3 className="text-lg font-medium text-white">Applying changes...</h3>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-slate-800 flex justify-end gap-3">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm font-medium text-slate-400 hover:text-white transition-colors"
                    >
                        Cancel
                    </button>

                    {phase === 'idle' && analysis && (
                        <button
                            onClick={handleStartFix}
                            disabled={analysis.orphans.length === 0 && analysis.missingTags.length === 0}
                            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium flex items-center gap-2 transition-colors"
                        >
                            <Play size={16} />
                            Start AI Analysis
                        </button>
                    )}

                    {phase === 'reviewing' && suggestedOps.length > 0 && (
                        <button
                            onClick={handleApply}
                            disabled={selectedOps.size === 0}
                            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium flex items-center gap-2 transition-colors"
                        >
                            <Check size={16} />
                            Apply {selectedOps.size} Changes
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default GraphFixingModal;
