import React from 'react';
import { ToonOperation } from '../types';
import { Check, X, Edit3, ArrowRight } from 'lucide-react';

interface PreviewModalProps {
  ops: ToonOperation[];
  onConfirm: () => void;
  onCancel: () => void;
}

const PreviewModal: React.FC<PreviewModalProps> = ({ ops, onConfirm, onCancel }) => {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl max-w-2xl w-full max-h-[80vh] flex flex-col">
        <div className="p-6 border-b border-slate-800">
          <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <Edit3 className="w-5 h-5 text-indigo-400" />
            Review Pending Operations
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Flowmate intends to modify your graph. Please confirm these changes.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {ops.map((op, idx) => (
            <div key={idx} className="bg-slate-800/50 rounded-lg p-4 border border-slate-700/50">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-mono uppercase bg-indigo-500/20 text-indigo-300 px-2 py-1 rounded">
                  {op.type}
                </span>
              </div>
              
              <div className="space-y-2">
                {Object.entries(op.payload).map(([key, value]) => {
                  if (key === 'id' || value === null || value === undefined) return null;
                  return (
                    <div key={key} className="grid grid-cols-12 gap-2 text-sm">
                      <span className="col-span-4 text-slate-500 font-medium truncate">{key}:</span>
                      <span className="col-span-8 text-slate-200 font-mono text-xs break-all">
                        {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="p-6 border-t border-slate-800 flex justify-end gap-3 bg-slate-900 rounded-b-xl">
          <button 
            onClick={onCancel}
            className="px-4 py-2 rounded-lg text-slate-300 hover:bg-slate-800 transition-colors flex items-center gap-2 text-sm font-medium"
          >
            <X className="w-4 h-4" />
            Reject
          </button>
          <button 
            onClick={onConfirm}
            className="px-6 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition-colors flex items-center gap-2 text-sm font-medium shadow-lg shadow-indigo-500/20"
          >
            <Check className="w-4 h-4" />
            Confirm Changes
          </button>
        </div>
      </div>
    </div>
  );
};

export default PreviewModal;