import React, { useState } from 'react';
import { useStore } from '../store';
import { X, Star, Sparkles, Send } from 'lucide-react';
import { EntityKind } from '../types';

interface ReviewPromptProps {
    onClose: () => void;
}

const ReviewPrompt: React.FC<ReviewPromptProps> = ({ onClose }) => {
    const { applyOperations, addToast } = useStore();
    const [rating, setRating] = useState(3);
    const [wentWell, setWentWell] = useState('');
    const [improve, setImprove] = useState('');
    const [gratitude, setGratitude] = useState('');

    const handleSubmit = () => {
        const now = new Date().toISOString();
        const dateStr = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

        // Create a Journal entry with the review
        applyOperations([{
            type: 'create_entity',
            payload: {
                kind: EntityKind.NOTE,
                title: `Daily Review - ${dateStr}`,
                description: `## Rating: ${'⭐'.repeat(rating)}

### What went well?
${wentWell || 'No notes'}

### What could be improved?
${improve || 'No notes'}

### Gratitude
${gratitude || 'No notes'}`,
                metadata: {
                    is_review: true,
                    rating,
                    review_date: now
                }
            }
        }]);

        addToast('Daily review saved!', 'success');
        onClose();
    };

    return (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in">
            <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg mx-4 shadow-2xl animate-in zoom-in-95">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-slate-800">
                    <div className="flex items-center gap-2">
                        <Sparkles className="text-yellow-400" size={20} />
                        <h2 className="text-lg font-semibold text-white">Daily Review</h2>
                    </div>
                    <button onClick={onClose} className="p-1 text-slate-400 hover:text-white">
                        <X size={20} />
                    </button>
                </div>

                {/* Content */}
                <div className="p-4 space-y-5">
                    {/* Rating */}
                    <div>
                        <label className="text-sm text-slate-400 mb-2 block">How was your day? (1-5)</label>
                        <div className="flex gap-2">
                            {[1, 2, 3, 4, 5].map(n => (
                                <button
                                    key={n}
                                    onClick={() => setRating(n)}
                                    className={`p-2 rounded-lg transition-all ${rating >= n ? 'text-yellow-400 scale-110' : 'text-slate-600 hover:text-slate-400'
                                        }`}
                                >
                                    <Star size={28} fill={rating >= n ? 'currentColor' : 'none'} />
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* What went well */}
                    <div>
                        <label className="text-sm text-slate-400 mb-2 block">What went well today?</label>
                        <textarea
                            value={wentWell}
                            onChange={e => setWentWell(e.target.value)}
                            placeholder="Completed my morning routine..."
                            className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-sm text-slate-200 resize-none h-20 focus:ring-2 focus:ring-indigo-500/50 outline-none"
                        />
                    </div>

                    {/* What to improve */}
                    <div>
                        <label className="text-sm text-slate-400 mb-2 block">What could be improved?</label>
                        <textarea
                            value={improve}
                            onChange={e => setImprove(e.target.value)}
                            placeholder="Spend less time on social media..."
                            className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-sm text-slate-200 resize-none h-20 focus:ring-2 focus:ring-indigo-500/50 outline-none"
                        />
                    </div>

                    {/* Gratitude */}
                    <div>
                        <label className="text-sm text-slate-400 mb-2 block">One thing you're grateful for</label>
                        <input
                            type="text"
                            value={gratitude}
                            onChange={e => setGratitude(e.target.value)}
                            placeholder="My supportive family..."
                            className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-sm text-slate-200 focus:ring-2 focus:ring-indigo-500/50 outline-none"
                        />
                    </div>
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-slate-800 flex justify-end">
                    <button
                        onClick={handleSubmit}
                        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-medium flex items-center gap-2"
                    >
                        <Send size={16} />
                        Save Review
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ReviewPrompt;
