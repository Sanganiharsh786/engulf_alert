# Quick Start - RR Ratio Feature

## 🚀 What's New?
You can now test different Risk-Reward ratios to find what works best for your strategy!

## ⚡ Quick Guide

### 1️⃣ Select a Single RR Ratio
```
Backtest Page → Filters Section → Risk-Reward Ratio
→ Click any ratio (1:2, 1:3, 1:4, etc.)
→ Backtest automatically re-runs
```

**Use this when:**
- You want to test a specific RR ratio
- You need accurate results based on real price data

### 2️⃣ Compare All RR Ratios
```
Backtest Page → Risk-Reward Ratio section
→ Click "Compare All RR" button
→ View comprehensive comparison
```

**Use this when:**
- Finding the optimal RR for your strategy
- Quick overview of performance across ratios
- Deciding which ratio to test more thoroughly

## 📊 What You'll See

### Comparison Cards
Each RR ratio shows:
- ✅ **Win Rate** - Percentage of winning trades
- 📈 **Net R** - Total profit/loss
- 💰 **Avg R/Trade** - Expected return per trade
- 🎯 **Profit Factor** - Risk-adjusted performance

### Visual Charts
- **Net R Chart** - Which RR is most profitable?
- **Win Rate Chart** - How does win rate change?
- **Avg R/Trade** - Most consistent returns?
- **Profit Factor** - Best risk management?

### Best Performance Badges
- 🏆 **Best Overall** - Highest total profit (Net R)
- ⭐ **Best Average** - Best return per trade

## 💡 Quick Tips

### Finding Your Optimal RR
1. Click "Compare All RR"
2. Look for the 🏆 badge (best Net R)
3. Check if win rate is >40%
4. Select that ratio for detailed testing

### Understanding Results
- **Higher RR** = Bigger wins, but may have lower win rate
- **Lower RR** = Higher win rate, but smaller wins
- **Sweet Spot** = Balance between win rate and reward size

### Example Strategy
```
Win Rate: 45% | RR: 1:3 | Net R: +15.5
→ This means: Win 45% of trades, earn 3R when winning, lose 1R when losing
→ Result: Profitable strategy! (+15.5R total)
```

## 🎯 Best Practices

1. **Start with Comparison**
   - Use "Compare All RR" to get overview
   - Identify 2-3 promising ratios

2. **Test Individually**
   - Select each promising ratio
   - Re-run backtest for accuracy
   - Note the actual win rate changes

3. **Consider Your Style**
   - **Aggressive**: Higher RR (1:4, 1:5) - fewer wins, bigger rewards
   - **Conservative**: Lower RR (1:1.5, 1:2) - more wins, smaller rewards
   - **Balanced**: Medium RR (1:2.5, 1:3) - good compromise

4. **Check Sample Size**
   - Need 50+ trades for reliable stats
   - More trades = more reliable results

## 📱 Where to Find It

```
Dashboard → Backtest Page → Filters Section
```

Look for:
```
┌─────────────────────────────────────┐
│ RISK-REWARD RATIO                   │
├─────────────────────────────────────┤
│ [Default] [1:1.5] [1:2] [1:2.5]    │
│ [1:3] [1:4] [1:5]                   │
│                                      │
│ [Compare All RR] button              │
└─────────────────────────────────────┘
```

## ⚠️ Important Note

The comparison gives you **quick estimates** by recalculating rewards on existing outcomes. 

For **100% accurate** results:
1. Select a specific RR ratio
2. Let the backtest re-run completely
3. This recalculates everything with real price data

Think of comparison as a "preview" to find candidates, then test them properly!

## 🎓 Example Workflow

```
Step 1: Run backtest with default settings
   ↓
Step 2: Click "Compare All RR"
   ↓
Step 3: See that 1:3 has best Net R (+20.5)
   ↓
Step 4: Select "1:3" ratio
   ↓
Step 5: Review actual backtest results
   ↓
Step 6: If good, update your config to use 1:3!
```

## 🤔 FAQ

**Q: Which RR should I choose?**
A: Use comparison to find which has the best Net R with acceptable win rate (>40% for RR >2).

**Q: Why does win rate stay the same in comparison?**
A: It's a simplified calculation. Select a ratio for real results.

**Q: Can I use custom RR like 1:2.75?**
A: Currently supports preset ratios. Custom input is a planned feature!

**Q: What's a good profit factor?**
A: Above 1.5 is good, above 2.0 is excellent!

**Q: Does this work with all filters?**
A: Yes! RR works with pair filters, time exclusions, DNA filter, etc.

## 📚 More Info

- Full documentation: `RR_RATIO_FEATURE.md`
- Technical details: `CHANGELOG_RR_FEATURE.md`

## 🚦 Ready to Start?

1. Go to Backtest page
2. Click "Compare All RR"
3. Find your optimal ratio
4. Test it properly
5. Update your strategy!

Happy trading! 📈
