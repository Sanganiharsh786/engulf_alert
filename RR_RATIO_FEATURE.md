# Dynamic Risk-Reward Ratio Backtest Feature

## Overview
This feature allows you to dynamically test different Risk-Reward (RR) ratios in your backtests to find the optimal RR ratio for your trading strategy.

## Features

### 1. **Single RR Ratio Selection**
- Select from predefined RR ratios: 1:1.5, 1:2, 1:2.5, 1:3, 1:4, 1:5
- Or use the default RR ratio from your configuration
- Re-runs the backtest with the selected RR ratio
- All filters and analysis update based on the selected ratio

### 2. **RR Comparison Mode**
- Compare all RR ratios side-by-side
- Visual cards showing performance metrics for each ratio
- Interactive charts displaying:
  - **Net R by RR Ratio**: Total profit/loss in R multiples
  - **Win Rate by RR Ratio**: Percentage of winning trades
  - **Average R per Trade**: Expected return per trade
  - **Profit Factor by RR Ratio**: Ratio of gross profit to gross loss

### 3. **Performance Metrics**
For each RR ratio, you'll see:
- **Win Rate**: Percentage of winning trades
- **Wins/Losses**: Count of winning and losing trades
- **Net R**: Total profit/loss in R multiples
- **Average R per Trade**: Expected return per trade
- **Profit Factor**: Gross profit ÷ Gross loss

### 4. **Best Performance Indicators**
- 🏆 **Best Overall**: Highest Net R
- ⭐ **Best Average Return**: Highest average R per trade

## How to Use

### Step 1: Access the Backtest Page
Navigate to the Backtest page from your dashboard.

### Step 2: Select a Single RR Ratio (Optional)
1. In the filters section, find "Risk-Reward Ratio"
2. Click on any ratio button (1:1.5, 1:2, 1:3, etc.)
3. The backtest will automatically re-run with the selected ratio
4. All statistics and charts will update accordingly

### Step 3: Compare All RR Ratios
1. Click the "Compare All RR" button
2. View the comprehensive comparison showing:
   - Performance cards for each ratio
   - Visual charts comparing metrics
   - Analysis summary with recommendations

### Step 4: Analyze Results
Look for:
- **Highest Net R**: Best overall profitability
- **Highest Average R/Trade**: Most consistent returns
- **Best Profit Factor**: Best risk-adjusted returns
- **Acceptable Win Rate**: Balance between win rate and reward

## Understanding the Results

### Important Notes

1. **Simplified Calculation**: The comparison uses existing trade outcomes and recalculates rewards. This assumes the same win/loss outcome for each trade.

2. **Real-World Consideration**: In practice, a higher RR ratio means:
   - Take-profit is further away
   - May result in lower win rates
   - Some wins might become losses as price doesn't reach TP

3. **Recommendation**: For most accurate results, select a specific RR ratio and re-run the backtest to see actual performance with real price action.

## Example Use Cases

### Finding Optimal RR
1. Enable "Compare All RR"
2. Look for the ratio with the best Net R
3. Check if the win rate is acceptable (typically >40% for RR >1:2)
4. Select that ratio for detailed backtesting

### Testing Strategy Viability
1. Compare how your strategy performs across different RR ratios
2. If higher RR ratios still show positive Net R, your strategy has good potential
3. If only low RR ratios are profitable, consider improving entry quality

### Risk Management
1. Use the Average R/Trade metric to understand expected returns
2. Use Profit Factor to assess risk-adjusted performance
3. Higher Profit Factor (>1.5) indicates better risk management

## Technical Details

### Backend Changes
- **API**: `/api/backtest` now accepts `rrRatio` parameter
- **Library**: `lib/backtest.js` supports dynamic RR ratio calculation
- Take-profit is calculated as: `entry ± (stopDistance × rrRatio)`

### Frontend Changes
- **Filter UI**: Toggle group for RR ratio selection
- **Comparison UI**: Visual cards and charts component
- **State Management**: React state for RR selection and comparison mode

### Files Modified
1. `app/backtest/page.js` - Added RR filter UI and comparison toggle
2. `app/api/backtest/route.js` - Added rrRatio parameter handling
3. `lib/backtest.js` - Updated backtestPair to support dynamic RR
4. `components/backtest/rr-comparison.jsx` - New comparison component

## Future Enhancements

Potential improvements:
1. **Full Re-backtest**: Actually re-run backtest with price data for each RR
2. **Custom RR Input**: Allow users to enter any RR ratio
3. **RR Range Testing**: Test a range of ratios (e.g., 1:1 to 1:10)
4. **Export Comparison**: Download comparison results to Excel
5. **Historical RR Analysis**: Show which RR worked best in different market conditions

## Tips for Best Results

1. **Start with Default**: See how your current strategy performs
2. **Compare First**: Use comparison mode to identify promising ratios
3. **Test Individually**: Re-run backtest with selected ratio for accuracy
4. **Consider Market**: Different markets may favor different RR ratios
5. **Balance Win Rate**: Very high RR (1:5+) may have too low win rate
6. **Minimum Sample**: Ensure sufficient trades (50+) for reliable statistics

## Support

For issues or questions about this feature:
1. Check that your backtest has sufficient historical data
2. Ensure pairs are configured correctly
3. Review the analysis summary for recommendations
4. Consider market conditions when interpreting results
