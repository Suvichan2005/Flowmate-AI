import React, { useState, useMemo } from 'react';
import { useStore } from '../store';
import { DietaryType, FoodLogEntry, FoodPreferences, FoodSource } from '../types';
import { UtensilsCrossed, Plus, Heart, TrendingUp, DollarSign, Apple, Coffee, Sun, Moon, X, Star, Flame, Store, Home, MapPin, Building } from 'lucide-react';

const FoodTracker: React.FC = () => {
    const foodLogs = useStore(state => state.foodLogs);
    const settings = useStore(state => state.settings);
    const applyOperations = useStore(state => state.applyOperations);
    // Direct setter for settings - zustand pattern
    const updateFoodPreferences = (prefs: FoodPreferences) => {
        useStore.setState(state => ({
            settings: { ...state.settings, food_preferences: prefs }
        }));
    };
    const [showLogForm, setShowLogForm] = useState(false);
    const [newFood, setNewFood] = useState({
        food_name: '',
        meal_type: 'lunch' as 'breakfast' | 'lunch' | 'dinner' | 'snack',
        calories: '',
        cost: '',
        notes: '',
        source: 'ordered' as FoodSource,
        vendor: '',
        rating: 0
    });

    const prefs = settings.food_preferences || {
        dietary_type: 'non-veg' as DietaryType,
        favorite_foods: [],
        allergies: [],
        disliked_foods: []
    };

    // Stats calculations
    const stats = useMemo(() => {
        const today = new Date().toISOString().split('T')[0];
        const todayLogs = foodLogs.filter(l => l.timestamp.startsWith(today));

        const last7Days = foodLogs.filter(l => {
            const d = new Date(l.timestamp);
            const diff = (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24);
            return diff <= 7;
        });

        const last30Days = foodLogs.filter(l => {
            const d = new Date(l.timestamp);
            const diff = (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24);
            return diff <= 30;
        });

        const todayCalories = todayLogs.reduce((sum, l) => sum + (l.calories || 0), 0);
        const todaySpending = todayLogs.reduce((sum, l) => sum + (l.cost || 0), 0);
        const weeklySpending = last7Days.reduce((sum, l) => sum + (l.cost || 0), 0);
        const monthlySpending = last30Days.reduce((sum, l) => sum + (l.cost || 0), 0);

        // Frequency analysis
        const foodCounts: Record<string, number> = {};
        foodLogs.forEach(l => {
            const name = l.food_name.toLowerCase();
            foodCounts[name] = (foodCounts[name] || 0) + 1;
        });
        const frequentFoods = Object.entries(foodCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([name, count]) => ({ name, count }));

        // Vendor breakdown (new)
        const vendorStats: Record<string, { count: number; spent: number }> = {};
        last30Days.forEach(l => {
            const vendor = l.vendor || 'Unknown';
            if (!vendorStats[vendor]) vendorStats[vendor] = { count: 0, spent: 0 };
            vendorStats[vendor].count++;
            vendorStats[vendor].spent += l.cost || 0;
        });
        const topVendors = Object.entries(vendorStats)
            .sort((a, b) => b[1].count - a[1].count)
            .slice(0, 5);

        // Source breakdown (new)
        const sourceStats = { mess: 0, ordered: 0, homemade: 0, outside: 0, unknown: 0 };
        last30Days.forEach(l => {
            if (l.source && l.source in sourceStats) {
                sourceStats[l.source as keyof typeof sourceStats]++;
            } else {
                sourceStats.unknown++;
            }
        });

        // Meal pattern (new)
        const mealPattern = { breakfast: 0, lunch: 0, dinner: 0, snack: 0 };
        last30Days.forEach(l => {
            if (l.meal_type && l.meal_type in mealPattern) {
                mealPattern[l.meal_type]++;
            }
        });

        return {
            todayCalories,
            todaySpending,
            weeklySpending,
            monthlySpending,
            todayMeals: todayLogs.length,
            frequentFoods,
            topVendors,
            sourceStats,
            mealPattern,
            totalMeals: last30Days.length
        };
    }, [foodLogs]);

    const handleLogFood = (e: React.FormEvent) => {
        e.preventDefault();
        if (!newFood.food_name.trim()) return;

        applyOperations([{
            type: 'log_food',
            payload: {
                food_name: newFood.food_name.trim(),
                meal_type: newFood.meal_type,
                calories: newFood.calories ? Number(newFood.calories) : undefined,
                cost: newFood.cost ? Number(newFood.cost) : undefined,
                notes: newFood.notes || undefined,
                source: newFood.source,
                vendor: newFood.vendor.trim() || undefined,
                rating: newFood.rating > 0 ? newFood.rating : undefined
            }
        }]);

        setNewFood({ food_name: '', meal_type: 'lunch', calories: '', cost: '', notes: '', source: 'ordered', vendor: '', rating: 0 });
        setShowLogForm(false);
    };

    const handleQuickLog = (foodName: string) => {
        applyOperations([{
            type: 'log_food',
            payload: { food_name: foodName, meal_type: 'snack' }
        }]);
    };

    const updateDietaryType = (type: DietaryType) => {
        updateFoodPreferences({ ...prefs, dietary_type: type });
    };

    const mealIcons = {
        breakfast: <Coffee size={14} className="text-amber-400" />,
        lunch: <Sun size={14} className="text-yellow-400" />,
        dinner: <Moon size={14} className="text-indigo-400" />,
        snack: <Apple size={14} className="text-green-400" />
    };

    const [confirmDeleteFood, setConfirmDeleteFood] = useState<string | null>(null);

    const handleDeleteFood = (foodId: string) => {
        if (confirmDeleteFood === foodId) {
            useStore.setState(state => ({
                foodLogs: state.foodLogs.filter(l => l.id !== foodId)
            }));
            setConfirmDeleteFood(null);
        } else {
            setConfirmDeleteFood(foodId);
            setTimeout(() => setConfirmDeleteFood(prev => prev === foodId ? null : prev), 3000);
        }
    };

    return (
        <div className="h-full overflow-y-auto">
            <div className="max-w-4xl mx-auto p-6 space-y-6">
                {/* Header */}
                <div className="flex items-center justify-between flex-wrap gap-4">
                    <div>
                        <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
                            <UtensilsCrossed className="text-orange-400" /> Food Tracker
                        </h1>
                        <p className="text-sm text-slate-500">Track meals, nutrition & spending</p>
                    </div>
                    <div className="flex items-center gap-3">
                        {/* Dietary Dropdown */}
                        <select
                            value={prefs.dietary_type}
                            onChange={(e) => updateDietaryType(e.target.value as DietaryType)}
                            className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-orange-500"
                        >
                            <option value="veg">🥬 Veg</option>
                            <option value="non-veg">🍖 Non-Veg</option>
                            <option value="vegan">🌱 Vegan</option>
                            <option value="eggetarian">🥚 Eggetarian</option>
                        </select>
                        <button
                            onClick={() => setShowLogForm(true)}
                            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 text-white rounded-lg font-medium shadow-lg shadow-orange-500/20 transition-all"
                        >
                            <Plus size={18} /> Log Food
                        </button>
                    </div>
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
                        <div className="flex items-center gap-2 text-slate-500 text-xs uppercase mb-1">
                            <Flame size={14} className="text-orange-400" /> Today
                        </div>
                        <div className="text-2xl font-bold text-slate-100">{stats.todayCalories}</div>
                        <div className="text-xs text-slate-500">calories</div>
                    </div>
                    <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
                        <div className="flex items-center gap-2 text-slate-500 text-xs uppercase mb-1">
                            <UtensilsCrossed size={14} className="text-green-400" /> Meals
                        </div>
                        <div className="text-2xl font-bold text-slate-100">{stats.todayMeals}</div>
                        <div className="text-xs text-slate-500">today</div>
                    </div>
                    <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
                        <div className="flex items-center gap-2 text-slate-500 text-xs uppercase mb-1">
                            <DollarSign size={14} className="text-emerald-400" /> Weekly
                        </div>
                        <div className="text-2xl font-bold text-slate-100">₹{stats.weeklySpending}</div>
                        <div className="text-xs text-slate-500">spent on food</div>
                    </div>
                    <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
                        <div className="flex items-center gap-2 text-slate-500 text-xs uppercase mb-1">
                            <TrendingUp size={14} className="text-blue-400" /> Monthly
                        </div>
                        <div className="text-2xl font-bold text-slate-100">₹{stats.monthlySpending}</div>
                        <div className="text-xs text-slate-500">total spend</div>
                    </div>
                </div>

                {/* Analytics Row */}
                <div className="grid md:grid-cols-2 gap-6">
                    {/* Most Ordered (Display Only - NOT clickable) */}
                    <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
                        <h3 className="text-sm font-medium text-slate-300 mb-3 flex items-center gap-2">
                            <Star size={14} className="text-yellow-400" /> Most Ordered
                        </h3>
                        <div className="flex flex-wrap gap-2">
                            {stats.frequentFoods.length > 0 ? (
                                stats.frequentFoods.map(f => (
                                    <span
                                        key={f.name}
                                        className="px-3 py-1.5 bg-slate-700/50 rounded-full text-xs text-slate-300 flex items-center gap-1"
                                    >
                                        {f.name} <span className="text-yellow-400 font-medium">×{f.count}</span>
                                    </span>
                                ))
                            ) : (
                                <span className="text-xs text-slate-500 italic">Log some meals to see patterns</span>
                            )}
                        </div>
                    </div>

                    {/* Meal Pattern */}
                    <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
                        <h3 className="text-sm font-medium text-slate-300 mb-3 flex items-center gap-2">
                            <TrendingUp size={14} className="text-cyan-400" /> Meal Pattern (30d)
                        </h3>
                        <div className="grid grid-cols-4 gap-2 text-center">
                            <div className="bg-slate-900/50 rounded-lg p-2">
                                <Coffee size={14} className="mx-auto text-amber-400 mb-1" />
                                <div className="text-lg font-bold text-slate-200">{stats.mealPattern.breakfast}</div>
                                <div className="text-[10px] text-slate-500">Breakfast</div>
                            </div>
                            <div className="bg-slate-900/50 rounded-lg p-2">
                                <Sun size={14} className="mx-auto text-yellow-400 mb-1" />
                                <div className="text-lg font-bold text-slate-200">{stats.mealPattern.lunch}</div>
                                <div className="text-[10px] text-slate-500">Lunch</div>
                            </div>
                            <div className="bg-slate-900/50 rounded-lg p-2">
                                <Moon size={14} className="mx-auto text-indigo-400 mb-1" />
                                <div className="text-lg font-bold text-slate-200">{stats.mealPattern.dinner}</div>
                                <div className="text-[10px] text-slate-500">Dinner</div>
                            </div>
                            <div className="bg-slate-900/50 rounded-lg p-2">
                                <Apple size={14} className="mx-auto text-green-400 mb-1" />
                                <div className="text-lg font-bold text-slate-200">{stats.mealPattern.snack}</div>
                                <div className="text-[10px] text-slate-500">Snacks</div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Vendor Analytics (NEW) */}
                {stats.topVendors.length > 0 && (
                    <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
                        <h3 className="text-sm font-medium text-slate-300 mb-3 flex items-center gap-2">
                            <Store size={14} className="text-purple-400" /> Top Vendors (30d)
                        </h3>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                            {stats.topVendors.map(([vendor, data]) => (
                                <div key={vendor} className="bg-slate-900/50 rounded-lg p-3">
                                    <div className="text-sm font-medium text-slate-200 truncate">{vendor}</div>
                                    <div className="flex items-center justify-between mt-1">
                                        <span className="text-xs text-slate-500">{data.count} orders</span>
                                        <span className="text-xs text-green-400">₹{data.spent}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                        {/* Source Breakdown */}
                        <div className="mt-3 pt-3 border-t border-slate-700/50">
                            <div className="flex items-center gap-4 text-xs">
                                <span className="text-slate-500">Sources:</span>
                                {stats.sourceStats.mess > 0 && (
                                    <span className="flex items-center gap-1 text-blue-400">
                                        <Building size={10} /> Mess: {stats.sourceStats.mess}
                                    </span>
                                )}
                                {stats.sourceStats.ordered > 0 && (
                                    <span className="flex items-center gap-1 text-orange-400">
                                        <Store size={10} /> Ordered: {stats.sourceStats.ordered}
                                    </span>
                                )}
                                {stats.sourceStats.homemade > 0 && (
                                    <span className="flex items-center gap-1 text-green-400">
                                        <Home size={10} /> Home: {stats.sourceStats.homemade}
                                    </span>
                                )}
                                {stats.sourceStats.outside > 0 && (
                                    <span className="flex items-center gap-1 text-purple-400">
                                        <MapPin size={10} /> Outside: {stats.sourceStats.outside}
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* Recent Logs */}
                <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
                    <h3 className="text-sm font-medium text-slate-300 mb-3">Recent Meals ({stats.totalMeals} in 30d)</h3>
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                        {foodLogs.slice(-10).reverse().map(log => (
                            <div key={log.id} className="flex items-center justify-between p-2 bg-slate-900/50 rounded-lg group">
                                <div className="flex items-center gap-3">
                                    {log.meal_type && mealIcons[log.meal_type]}
                                    <div>
                                        <span className="text-sm text-slate-200">{log.food_name}</span>
                                        <div className="flex items-center gap-2">
                                            {log.vendor && (
                                                <span className="text-[10px] text-purple-400 bg-purple-500/10 px-1.5 py-0.5 rounded">
                                                    @{log.vendor}
                                                </span>
                                            )}
                                            {log.source && (
                                                <span className={`text-[10px] px-1.5 py-0.5 rounded ${log.source === 'mess' ? 'text-blue-400 bg-blue-500/10' :
                                                    log.source === 'ordered' ? 'text-orange-400 bg-orange-500/10' :
                                                        log.source === 'homemade' ? 'text-green-400 bg-green-500/10' :
                                                            'text-gray-400 bg-gray-500/10'
                                                    }`}>
                                                    {log.source}
                                                </span>
                                            )}
                                            {log.rating && log.rating > 0 && (
                                                <span className="text-[10px] text-yellow-400">{'★'.repeat(log.rating)}</span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-3">
                                    <div className="text-right">
                                        {log.calories && <span className="text-xs text-orange-400">{log.calories} cal</span>}
                                        {log.cost && <span className="text-xs text-green-400 ml-2">₹{log.cost}</span>}
                                        <p className="text-[9px] text-slate-600">{new Date(log.timestamp).toLocaleDateString()}</p>
                                    </div>
                                    <button
                                        onClick={() => handleDeleteFood(log.id)}
                                        className={`p-1 rounded transition-all ${confirmDeleteFood === log.id ? 'opacity-100 text-red-400 bg-red-500/20 ring-1 ring-red-500/40' : 'opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-300 hover:bg-red-500/10'}`}
                                        title={confirmDeleteFood === log.id ? 'Click again to confirm' : 'Delete'}
                                    >
                                        {confirmDeleteFood === log.id ? <span className="text-[10px] font-bold px-1">Sure?</span> : <X size={14} />}
                                    </button>
                                </div>
                            </div>
                        ))}
                        {foodLogs.length === 0 && (
                            <div className="text-center py-8 text-slate-500">
                                <UtensilsCrossed size={32} className="mx-auto mb-2 opacity-50" />
                                <p className="text-sm">No meals logged yet</p>
                                <p className="text-xs">Click "Log Food" to get started</p>
                            </div>
                        )}
                    </div>
                </div>

                {/* Log Food Modal */}
                {showLogForm && (
                    <>
                        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40" onClick={() => setShowLogForm(false)} />
                        <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
                            <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-md shadow-2xl">
                                <div className="flex items-center justify-between mb-4">
                                    <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
                                        <UtensilsCrossed className="text-orange-400" /> Log Food
                                    </h2>
                                    <button onClick={() => setShowLogForm(false)} className="text-slate-500 hover:text-slate-300">
                                        <X size={20} />
                                    </button>
                                </div>

                                <form onSubmit={handleLogFood} className="space-y-4">
                                    <div>
                                        <label className="block text-xs text-slate-500 mb-1">Food Name *</label>
                                        <input
                                            type="text"
                                            value={newFood.food_name}
                                            onChange={e => setNewFood({ ...newFood, food_name: e.target.value })}
                                            placeholder="e.g., Dal Rice, Biryani, Sandwich..."
                                            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-orange-500"
                                            autoFocus
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-xs text-slate-500 mb-1">Meal Type</label>
                                        <div className="flex gap-2">
                                            {(['breakfast', 'lunch', 'dinner', 'snack'] as const).map(type => (
                                                <button
                                                    key={type}
                                                    type="button"
                                                    onClick={() => setNewFood({ ...newFood, meal_type: type })}
                                                    className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1 ${newFood.meal_type === type
                                                        ? 'bg-orange-500/20 text-orange-400 border border-orange-500/50'
                                                        : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                                                        }`}
                                                >
                                                    {mealIcons[type]} {type.charAt(0).toUpperCase() + type.slice(1)}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-xs text-slate-500 mb-1">Calories (optional)</label>
                                            <input
                                                type="number"
                                                value={newFood.calories}
                                                onChange={e => setNewFood({ ...newFood, calories: e.target.value })}
                                                placeholder="e.g., 350"
                                                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-orange-500"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs text-slate-500 mb-1">Cost ₹ (optional)</label>
                                            <input
                                                type="number"
                                                value={newFood.cost}
                                                onChange={e => setNewFood({ ...newFood, cost: e.target.value })}
                                                placeholder="e.g., 80"
                                                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-orange-500"
                                            />
                                        </div>
                                    </div>

                                    <div>
                                        <label className="block text-xs text-slate-500 mb-1">Notes (optional)</label>
                                        <input
                                            type="text"
                                            value={newFood.notes}
                                            onChange={e => setNewFood({ ...newFood, notes: e.target.value })}
                                            placeholder="e.g., From mess, extra spicy..."
                                            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-orange-500"
                                        />
                                    </div>

                                    <button
                                        type="submit"
                                        disabled={!newFood.food_name.trim()}
                                        className="w-full py-3 bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-all"
                                    >
                                        Log Food
                                    </button>
                                </form>
                            </div>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export default FoodTracker;
