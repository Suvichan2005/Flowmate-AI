import React, { useState } from 'react';
import { ToonOperation } from '../types';
import { Check, X, Edit3, ChevronDown, ChevronRight, Square, CheckSquare } from 'lucide-react';

interface PreviewModalProps {
  ops: ToonOperation[];
  onConfirm: (selectedOps: ToonOperation[]) => void;
  onCancel: () => void;
}

const PreviewModal: React.FC<PreviewModalProps> = ({ ops, onConfirm, onCancel }) => {
  // Track selected ops and edited values
  const [selected, setSelected] = useState<boolean[]>(ops.map(() => true));
  const [expanded, setExpanded] = useState<boolean[]>(ops.map(() => false));
  const [editedOps, setEditedOps] = useState<ToonOperation[]>([...ops]);

  const toggleSelect = (idx: number) => {
    const newSelected = [...selected];
    newSelected[idx] = !newSelected[idx];
    setSelected(newSelected);
  };

  const toggleExpand = (idx: number) => {
    const newExpanded = [...expanded];
    newExpanded[idx] = !newExpanded[idx];
    setExpanded(newExpanded);
  };

  const updateOpField = (idx: number, field: string, value: string) => {
    const newOps = [...editedOps];
    if (field === 'title' || field === 'description') {
      newOps[idx] = { ...newOps[idx], payload: { ...newOps[idx].payload, [field]: value } };
    } else if (field.startsWith('fields.')) {
      const subField = field.replace('fields.', '');
      newOps[idx] = {
        ...newOps[idx],
        payload: {
          ...newOps[idx].payload,
          fields: { ...newOps[idx].payload.fields, [subField]: value }
        }
      };
    }
    setEditedOps(newOps);
  };

  const handleConfirm = () => {
    const selectedOps = editedOps.filter((_, idx) => selected[idx]);
    onConfirm(selectedOps);
  };

  const selectedCount = selected.filter(Boolean).length;

  const getOpColor = (type: string) => {
    if (type.includes('create')) return 'bg-emerald-500/20 text-emerald-300';
    if (type.includes('update')) return 'bg-amber-500/20 text-amber-300';
    if (type.includes('link')) return 'bg-blue-500/20 text-blue-300';
    if (type.includes('log')) return 'bg-purple-500/20 text-purple-300';
    return 'bg-indigo-500/20 text-indigo-300';
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl max-w-2xl w-full max-h-[80vh] flex flex-col">
        <div className="p-5 border-b border-slate-800">
          <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
            <Edit3 className="w-5 h-5 text-indigo-400" />
            Review {ops.length} Operation{ops.length !== 1 ? 's' : ''}
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            Select which changes to apply. Click to expand and edit.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {editedOps.map((op, idx) => (
            <div
              key={idx}
              className={`rounded-lg border transition-all ${selected[idx] ? 'bg-slate-800/70 border-slate-600' : 'bg-slate-800/30 border-slate-800 opacity-60'
                }`}
            >
              {/* Op Header - Click to expand */}
              <div className="flex items-center gap-3 p-3 cursor-pointer" onClick={() => toggleExpand(idx)}>
                <button
                  onClick={(e) => { e.stopPropagation(); toggleSelect(idx); }}
                  className="shrink-0 text-slate-400 hover:text-white transition-colors"
                >
                  {selected[idx] ? <CheckSquare size={20} className="text-indigo-400" /> : <Square size={20} />}
                </button>

                <span className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded ${getOpColor(op.type)}`}>
                  {op.type.replace('_', ' ')}
                </span>

                <span className="flex-1 text-sm text-slate-200 truncate font-medium">
                  {op.payload.title || op.payload.fields?.title || op.payload.fields?.description?.slice(0, 40) || 'Operation'}
                </span>

                {expanded[idx] ? <ChevronDown size={16} className="text-slate-500" /> : <ChevronRight size={16} className="text-slate-500" />}
              </div>

              {/* Expanded Content */}
              {expanded[idx] && (
                <div className="px-4 pb-4 space-y-3 border-t border-slate-700/50 pt-3">
                  {Object.entries(op.payload).map(([key, value]) => {
                    if (key === 'id' || value === null || value === undefined) return null;

                    // Editable fields
                    if ((key === 'title' || key === 'description') && typeof value === 'string') {
                      return (
                        <div key={key} className="space-y-1">
                          <label className="text-xs text-slate-500 font-medium uppercase">{key}</label>
                          <input
                            type="text"
                            value={value}
                            onChange={(e) => updateOpField(idx, key, e.target.value)}
                            disabled={!selected[idx]}
                            className="w-full bg-slate-700/50 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 focus:ring-2 focus:ring-indigo-500/50 outline-none disabled:opacity-50"
                          />
                        </div>
                      );
                    }

                    // Nested fields object
                    if (key === 'fields' && typeof value === 'object') {
                      return (
                        <div key={key} className="space-y-2">
                          <label className="text-xs text-slate-500 font-medium uppercase">Updates</label>
                          {Object.entries(value).map(([fKey, fVal]) => (
                            <div key={fKey} className="flex items-center gap-2">
                              <span className="text-xs text-slate-500 w-24 shrink-0">{fKey}:</span>
                              {typeof fVal === 'string' || typeof fVal === 'number' ? (
                                <input
                                  type="text"
                                  value={String(fVal)}
                                  onChange={(e) => updateOpField(idx, `fields.${fKey}`, e.target.value)}
                                  disabled={!selected[idx]}
                                  className="flex-1 bg-slate-700/50 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200 focus:ring-2 focus:ring-indigo-500/50 outline-none disabled:opacity-50"
                                />
                              ) : (
                                <span className="text-xs text-slate-400 font-mono">{JSON.stringify(fVal)}</span>
                              )}
                            </div>
                          ))}
                        </div>
                      );
                    }

                    // Display-only fields
                    return (
                      <div key={key} className="flex items-start gap-2 text-sm">
                        <span className="text-slate-500 w-24 shrink-0">{key}:</span>
                        <span className="text-slate-300 font-mono text-xs break-all">
                          {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="p-4 border-t border-slate-800 flex items-center justify-between bg-slate-900 rounded-b-xl">
          <span className="text-sm text-slate-500">{selectedCount} of {ops.length} selected</span>
          <div className="flex gap-2">
            <button
              onClick={onCancel}
              className="px-4 py-2 rounded-lg text-slate-300 hover:bg-slate-800 transition-colors flex items-center gap-2 text-sm"
            >
              <X className="w-4 h-4" />
              Reject All
            </button>
            <button
              onClick={handleConfirm}
              disabled={selectedCount === 0}
              className="px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors flex items-center gap-2 text-sm font-medium"
            >
              <Check className="w-4 h-4" />
              Apply {selectedCount > 0 ? `(${selectedCount})` : ''}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PreviewModal;