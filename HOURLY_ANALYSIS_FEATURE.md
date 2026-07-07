# Hourly Analysis Feature

## Overview
Added comprehensive hourly performance analysis to help you identify the best trading hours and avoid trading the whole day.

## Features Implemented ✅

### 1. **Hourly Performance Grid**
- Shows performance for all 24 hours (IST timezone)
- Color-coded performance levels:
  - 🟢 **Excellent** (60%+ win rate) - Green
  - 🔵 **Good** (50-60% win rate) - Blue  
  - 🟡 **Moderate** (40-50% win rate) - Yellow
  - 🔴 **Poor** (<40% win rate) - Red
  - ⚪ **Insufficient data** (<3 trades) - Gray

### 2. **Key Metrics per Hour**
- Win Rate %
- Total Signals
- Wins/Losses breakdown
- Net R (total return)
- Avg R (average return per trade)

### 3. **Best Trading Hours Summary**
- Automatically identifies optimal hours (50%+ win rate, min. 3 trades)
- Shows time ranges of best performance
- One-click "Filter These" button to apply best hours filter

### 4. **Interactive Hour Filtering**
- Click any hour card to filter trades by that hour
- Selected hours highlighted with ring indicator
- Combine multiple hours for custom time windows
- Clear button to remove all hour filters

### 5. **Export Functionality**
- Export hourly analysis to CSV
- Includes all metrics for each hour
- Perfect for external analysis or record-keeping

### 6. **Smart Integration**
- Works with all existing filters (pairs, sessions, months, days, RR ratio)
- Hour filter applies after session filter for maximum flexibility
- Updates trade count and totals in real-time

## How to Use

### Basic Usage
1. Go to Backtest page (`/backtest`)
2. Scroll to "Hourly Performance Analysis" section
3. View the 🎯 **Optimal Trading Hours** card at the top
4. See all 24 hours performance in the grid below

### Focus on Best Hours
1. Click the **"Filter These"** button in the optimal hours card
2. All best performing hours are automatically selected
3. Trades table and stats update to show only those hours

### Custom Hour Selection
1. Click any hour card to select/deselect it
2. Combine multiple hours as needed
3. Use "Clear Hours" button to reset

### Export Analysis
1. Click "Export CSV" button
2. Opens CSV with complete hourly breakdown
3. Use for tracking or sharing with team

## Example Use Case

**Scenario:** You want to avoid trading during low-performance hours

**Before:** Trading all day (24 hours) with mixed results
- Win rate: 45%
- Net R: +2.5

**After:** Using hourly analysis shows best hours are 08:00-11:00 and 14:00-17:00
- Click "Filter These" on optimal hours
- Win rate improves to: 58%
- Net R improves to: +5.8
- **Result:** Same or better returns with less time spent!

## Technical Details

### New Component
- `components/backtest/hourly-analysis.jsx` - Main analysis component

### Updates
- `app/backtest/page.js` - Integrated hourly analysis with hour filtering

### State Management
- `hourSel` - Array of selected hours (0-23)
- `toggleHour(hour, forceAdd)` - Toggle or force add/remove hours
- `sessionFiltered` - Intermediate state for cascading filters

### Filter Order
1. Pair filter
2. Time window exclusion
3. DNA filter
4. Month/Day filter
5. Session filter
6. **Hour filter** (new)

## Benefits

✅ **Save Time** - Trade only during profitable hours
✅ **Improve Win Rate** - Focus on high-performance time windows  
✅ **Better Risk Management** - Avoid hours with poor performance
✅ **Data-Driven Decisions** - Clear metrics for every hour
✅ **Flexible** - Combine with sessions, pairs, and other filters
✅ **Visual** - Color-coded cards make patterns obvious

## Notes

- All times are in **IST (UTC+5:30)**
- Minimum 3 closed trades required for "best hours" classification
- Hour filter respects all upstream filters (pair, session, month, etc.)
- Empty hours (no trades) shown as "No data"
- CSV export includes all 24 hours regardless of filters

---

**Status:** ✅ Complete and Ready to Use
**Created:** 2026-07-07
