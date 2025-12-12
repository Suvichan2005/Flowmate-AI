import React, { useMemo } from 'react';
import { Entity, EntityKind, Relationship, RelationshipType } from '../types';
import { Layers, FolderOpen } from 'lucide-react';
import { getActivityEntities } from '../utils/streakCalculation';

interface TimeBreakdownByCategoryProps {
    entities: Entity[];
    relationships: Relationship[];
}

interface CategoryData {
    id: string;
    name: string;
    kind: EntityKind;
    productiveMinutes: number;
    neutralMinutes: number;
    unproductiveMinutes: number;
    totalMinutes: number;
    activityCount: number;
}

/**
 * Component showing time spent breakdown by contexts/projects/goals
 */
const TimeBreakdownByCategory: React.FC<TimeBreakdownByCategoryProps> = ({ 
    entities, 
    relationships 
}) => {
    const categoryBreakdown = useMemo(() => {
        const categories = new Map<string, CategoryData>();

        // Initialize contexts and goals as categories
        entities
            .filter(e => 
                (e.kind === EntityKind.CONTEXT || e.kind === EntityKind.GOAL || e.kind === EntityKind.PROJECT) &&
                e.status !== 'ARCHIVED'
            )
            .forEach(category => {
                categories.set(category.id, {
                    id: category.id,
                    name: category.title,
                    kind: category.kind,
                    productiveMinutes: 0,
                    neutralMinutes: 0,
                    unproductiveMinutes: 0,
                    totalMinutes: 0,
                    activityCount: 0
                });
            });

        // Get all activity entities (including nested logs) using utility
        const allActivities = getActivityEntities(entities);

        // Map activities to categories
        allActivities.forEach(activity => {
            const minutes = activity.duration_minutes || 0;
            const productivity = activity.metadata?.productivity as string | undefined;

            // Find which category this activity belongs to
            const relatedCategories = new Set<string>();

            // Check direct relationships
            relationships.forEach(rel => {
                if (rel.from === activity.id && 
                    (rel.type === RelationshipType.TAGGED_WITH || 
                     rel.type === RelationshipType.PART_OF ||
                     rel.type === RelationshipType.FULFILLS)) {
                    if (categories.has(rel.to)) {
                        relatedCategories.add(rel.to);
                    }
                }
            });

            // If no categories found, try to find parent entity and its categories
            if (relatedCategories.size === 0 && activity.parent_id) {
                const parent = entities.find(e => e.id === activity.parent_id);
                if (parent) {
                    relationships.forEach(rel => {
                        if (rel.from === parent.id && 
                            (rel.type === RelationshipType.TAGGED_WITH || 
                             rel.type === RelationshipType.PART_OF ||
                             rel.type === RelationshipType.FULFILLS)) {
                            if (categories.has(rel.to)) {
                                relatedCategories.add(rel.to);
                            }
                        }
                    });
                }
            }

            // If still no categories, check canonical tags
            if (relatedCategories.size === 0 && activity.canonical_tags) {
                activity.canonical_tags.forEach(tag => {
                    const tagEntity = entities.find(e => e.title === tag && e.kind === EntityKind.TAG);
                    if (tagEntity && categories.has(tagEntity.id)) {
                        relatedCategories.add(tagEntity.id);
                    }
                });
            }

            // Distribute time across all related categories
            relatedCategories.forEach(categoryId => {
                const category = categories.get(categoryId);
                if (category) {
                    category.totalMinutes += minutes;
                    category.activityCount += 1;

                    if (productivity === 'PRODUCTIVE') {
                        category.productiveMinutes += minutes;
                    } else if (productivity === 'UNPRODUCTIVE') {
                        category.unproductiveMinutes += minutes;
                    } else {
                        category.neutralMinutes += minutes;
                    }
                }
            });
        });

        // Convert to array and filter out categories with no time
        return Array.from(categories.values())
            .filter(c => c.totalMinutes > 0)
            .sort((a, b) => b.totalMinutes - a.totalMinutes);
    }, [entities, relationships]);

    const totalMinutes = categoryBreakdown.reduce((sum, c) => sum + c.totalMinutes, 0);

    const getIcon = (kind: EntityKind) => {
        switch (kind) {
            case EntityKind.CONTEXT:
                return '🏷️';
            case EntityKind.GOAL:
                return '🎯';
            case EntityKind.PROJECT:
                return '📁';
            default:
                return '📊';
        }
    };

    if (categoryBreakdown.length === 0) {
        return (
            <div className="bg-gray-800/30 border border-gray-700 rounded-xl p-5">
                <h3 className="text-sm font-medium text-gray-300 mb-4 flex items-center gap-2">
                    <Layers size={16} className="text-indigo-400" />
                    Time by Category
                </h3>
                <div className="flex flex-col items-center justify-center h-32 text-gray-500">
                    <FolderOpen size={32} className="mb-2 opacity-50" />
                    <p className="text-sm">No categorized activities yet</p>
                    <p className="text-xs mt-1 text-gray-600">Tag activities with contexts or projects</p>
                </div>
            </div>
        );
    }

    return (
        <div className="bg-gray-800/30 border border-gray-700 rounded-xl p-5">
            <h3 className="text-sm font-medium text-gray-300 mb-4 flex items-center gap-2">
                <Layers size={16} className="text-indigo-400" />
                Time by Category
                <span className="text-xs text-gray-500 ml-auto">
                    Total: {Math.round(totalMinutes / 60 * 10) / 10}h
                </span>
            </h3>

            <div className="space-y-3">
                {categoryBreakdown.map(category => {
                    const percentage = totalMinutes > 0 ? (category.totalMinutes / totalMinutes) * 100 : 0;
                    const prodPercent = category.totalMinutes > 0 
                        ? (category.productiveMinutes / category.totalMinutes) * 100 
                        : 0;

                    return (
                        <div key={category.id} className="bg-gray-900/40 rounded-lg p-3">
                            {/* Header */}
                            <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2">
                                    <span className="text-base">{getIcon(category.kind)}</span>
                                    <span className="text-sm font-medium text-white">
                                        {category.name}
                                    </span>
                                </div>
                                <div className="text-xs text-gray-400">
                                    {Math.round(category.totalMinutes / 60 * 10) / 10}h
                                    <span className="text-gray-600 ml-1">
                                        ({Math.round(percentage)}%)
                                    </span>
                                </div>
                            </div>

                            {/* Progress bar showing productive/neutral/unproductive split */}
                            <div className="flex h-2 w-full rounded-full overflow-hidden bg-gray-800">
                                <div 
                                    style={{ 
                                        width: `${(category.productiveMinutes / category.totalMinutes) * 100}%` 
                                    }}
                                    className="bg-teal-500 transition-all"
                                />
                                <div 
                                    style={{ 
                                        width: `${(category.neutralMinutes / category.totalMinutes) * 100}%` 
                                    }}
                                    className="bg-gray-500 transition-all"
                                />
                                <div 
                                    style={{ 
                                        width: `${(category.unproductiveMinutes / category.totalMinutes) * 100}%` 
                                    }}
                                    className="bg-rose-500 transition-all"
                                />
                            </div>

                            {/* Stats */}
                            <div className="flex items-center gap-3 mt-2 text-xs">
                                <div className="flex items-center gap-1">
                                    <div className="w-1.5 h-1.5 rounded-full bg-teal-500" />
                                    <span className="text-gray-400">
                                        {Math.round(prodPercent)}%
                                    </span>
                                </div>
                                <div className="text-gray-600">
                                    {category.activityCount} activities
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default TimeBreakdownByCategory;
