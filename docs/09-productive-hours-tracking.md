# Productive Hours Tracking

> **Status:** ✅ Implemented (December 2024)  
> **Priority:** P1 - Core Feature  
> **Location:** AnalyticsView & FocusTimer

## Overview

The Productive Hours Tracking feature helps users understand their productivity patterns by categorizing activities and visualizing time usage throughout the day and week.

## Core Concepts

### Productivity Categories

Every activity in Flowmate can be tagged with one of three productivity types:

| Type | Value | Description | Examples |
|------|-------|-------------|----------|
| **PRODUCTIVE** | +1 | Work that moves goals forward | Coding, studying, exercise, learning, creation |
| **NEUTRAL** | 0 | Necessary maintenance activities | Chores, commute, eating, hygiene, errands |
| **UNPRODUCTIVE** | -1 | Time-wasting activities | Gaming, social media, TV, idle browsing |

### Data Sources

The system aggregates productivity data from two sources:
1. **Legacy ACTIVITY entities** - Standalone activity entries
2. **Embedded activity logs** - `metadata.activity_log` entries within other entities

This dual-source approach ensures all logged activities are included in analytics.

## Components

### 1. DailyProductivityBar

**Location:** `components/DailyProductivityBar.tsx`

Displays a 24-hour timeline showing productivity breakdown by hour.

**Features:**
- Visual bar chart with color-coded hours:
  - 🟢 Green = Productive (≥60% productive)
  - 🟡 Yellow = Neutral (mixed)
  - 🔴 Red = Unproductive (≥60% unproductive)
  - ⚫ Grey = No data
- Peak and low productivity hour indicators
- Hover tooltips with detailed minute breakdown
- Automatic height scaling based on activity volume

**Usage:**
```tsx
<DailyProductivityBar entities={entities} selectedDate="2024-12-12" />
```

### 2. WeeklyProductivityInsights

**Location:** `components/WeeklyProductivityInsights.tsx`

Shows weekly productivity patterns and actionable insights.

**Features:**
- Most productive day of the week
- Best time of day for focused work
- Day-by-day breakdown with visual bars
- Time-of-day performance comparison
- Actionable insights (e.g., "Evening productivity drops to 42%")

**Data Analysis:**
- Uses last 30 days of data for reliable patterns
- Groups by 6 time periods:
  - Early Morning (5-8 AM)
  - Morning (9-11 AM)
  - Afternoon (12-3 PM)
  - Evening (4-7 PM)
  - Night (8-11 PM)
  - Late Night (12-4 AM)

### 3. TimeBreakdownByCategory

**Location:** `components/TimeBreakdownByCategory.tsx`

Shows time distribution across contexts, goals, and projects.

**Features:**
- Total time per category
- Productivity split within each category
- Percentage of total time
- Activity count per category
- Visual progress bars showing productive/neutral/unproductive split

**Category Detection:**
Activities are linked to categories through:
1. Direct TAGGED_WITH relationships
2. PART_OF relationships to projects/goals
3. Parent entity relationships
4. Canonical tags

## Integration Points

### AnalyticsView

All three components are displayed in the AnalyticsView:

```tsx
{/* 24-Hour Daily Productivity Bar */}
<DailyProductivityBar entities={entities} />

{/* Weekly Insights & Time Breakdown */}
<div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
  <WeeklyProductivityInsights entities={entities} />
  <TimeBreakdownByCategory entities={entities} relationships={relationships} />
</div>
```

### FocusTimer Enhancement

**Location:** `components/FocusTimer.tsx`

When completing a focus session, users can now categorize the session:

1. Click "Finish" button
2. Select productivity type:
   - ⚡ Productive
   - ☕ Neutral  
   - 🎮 Downtime
3. Activity is logged with the selected type

This provides immediate feedback and helps build awareness of productivity patterns.

### AI Integration

The AI already supports productivity tagging through system instructions:

```typescript
// AI automatically categorizes activities
{ type: "log", payload: { 
  entity_id: "...", 
  t: "Studied React", 
  dur: 60, 
  m: { productivity: "PRODUCTIVE" } 
}}
```

Users can ask the AI to:
- "Log 2 hours of productive coding on Flowmate"
- "What was my most productive day this week?"
- "Show me my productivity breakdown"

## Data Utilities

### streakCalculation.ts

The `getActivityEntities()` utility:
- Extracts all ACTIVITY entities
- Processes embedded `metadata.activity_log` entries
- Creates pseudo-entities for consistent processing
- Preserves productivity metadata from parent entities

### Type Definitions

```typescript
// types.ts
export type ProductivityType = 'PRODUCTIVE' | 'NEUTRAL' | 'UNPRODUCTIVE';

export interface ActivityLogEntry {
  id: string;
  timestamp: string;
  title: string;
  duration_minutes: number;
  notes?: string;
  productivity?: ProductivityType;
}
```

## User Workflows

### Logging Activities

**Via AI Chat:**
```
User: "Spent 2 hours coding today"
AI: Creates activity with productivity="PRODUCTIVE"
```

**Via Focus Timer:**
1. Select an entity to focus on
2. Start timer
3. Work on the task
4. Click "Finish"
5. Choose productivity type
6. Activity is logged automatically

**Via Manual Operation:**
```typescript
applyOperations([{
  type: 'log_to_entity',
  payload: {
    entity_id: 'task-123',
    title: 'Worked on feature',
    duration_minutes: 90,
    metadata: { productivity: 'PRODUCTIVE' }
  }
}]);
```

### Viewing Insights

1. Navigate to **Analytics** view
2. Scroll to see:
   - Current day 24-hour breakdown
   - Weekly patterns
   - Time by category
3. Hover over bars for detailed tooltips
4. Use insights to optimize schedule

## Implementation Notes

### Performance

- All components use `useMemo` for expensive calculations
- Data aggregation happens at component level
- Shared utility (`getActivityEntities`) prevents duplication
- No external API calls required

### Accessibility

- Semantic HTML structure
- Color is supplemented with icons
- Tooltips provide detailed text descriptions
- Keyboard navigable (inherits from parent components)

### Responsive Design

- Grid layouts adapt to screen size
- Mobile-friendly touch targets
- Horizontal scrolling prevented
- Text truncation where needed

## Future Enhancements

Potential improvements (not yet implemented):

- [ ] Date picker to view historical days
- [ ] Export productivity report as PDF/CSV
- [ ] Compare weeks/months side-by-side
- [ ] AI-generated productivity recommendations
- [ ] Push notifications for productivity drops
- [ ] Integration with Commitment Load Index
- [ ] Productivity goals and targets
- [ ] Machine learning prediction of productive times

## Related Documentation

- [Feature Roadmap](./FLOWMATE_ROADMAP.md) - Full feature plan
- [Architecture Analysis](./04-architecture-analysis.md) - System design
- [Components Reference](./05-components-reference.md) - All components

---

*Last Updated: December 2024*
