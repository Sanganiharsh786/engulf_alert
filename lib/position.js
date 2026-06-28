// Position sizing from account risk (forex-style logic, works for crypto USDT
// pairs too). Given the account size, leverage and risk %, plus the entry and
// stop, it returns the lot/position size, SL/TP prices, pip distances and the
// money at risk/target.
//
// Sizing rule: lose exactly (accountSize * risk%) if the stop is hit.
//   qty = riskAmount / stopDistance
// The notional is then capped by what the leverage allows
//   (maxNotional = accountSize * leverage).

function round(n, dp = 2) {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

export function computePosition({ direction, entry, stop, settings, leverage }) {
  const r = (settings && settings.risk) || {};
  if (!r.enabled) return null;

  const accountSize = Number(r.accountSize);
  // leverage is set per pair; fall back to a global value, then 1x
  const lev = Number(leverage) || Number(r.leverage) || 1;
  const riskPercent = Number(r.riskPercent);
  const rr = Number(r.rewardRatio) || 2;
  const pipSize = Number(r.pipSize) || 1;

  if (!accountSize || !riskPercent || !entry || !stop) return null;

  const stopDistance = Math.abs(entry - stop);
  if (stopDistance <= 0) return null;

  const dir = direction === "bullish" ? 1 : -1;
  const tp = entry + dir * stopDistance * rr;

  const riskAmount = accountSize * (riskPercent / 100);
  let qty = riskAmount / stopDistance; // base units (e.g. BTC)

  // cap by leverage: notional can't exceed accountSize * leverage
  const maxNotional = accountSize * lev;
  let notional = qty * entry;
  let capped = false;
  if (notional > maxNotional) {
    qty = maxNotional / entry;
    notional = qty * entry;
    capped = true;
  }

  const margin = notional / lev;
  const actualRisk = qty * stopDistance; // = riskAmount unless capped
  const actualReward = actualRisk * rr;

  return {
    entry: round(entry, 4),
    stop: round(stop, 4),
    tp: round(tp, 4),
    qty: round(qty, 6),
    notional: round(notional, 2),
    margin: round(margin, 2),
    leverage: lev,
    rr,
    slPips: round(stopDistance / pipSize, 1),
    tpPips: round((stopDistance * rr) / pipSize, 1),
    riskAmount: round(actualRisk, 2),
    rewardAmount: round(actualReward, 2),
    riskPercent,
    capped,
  };
}

// human-readable block for the alert email
export function positionText(pos) {
  if (!pos) return "";
  const lines = [
    ``,
    `TRADE PLAN (risk ${pos.riskPercent}% of account)`,
    `--------------------------------------`,
    `Entry      : ${pos.entry}`,
    `Stop loss  : ${pos.stop}   (${pos.slPips} pips)`,
    `Take profit: ${pos.tp}   (${pos.tpPips} pips, ${pos.rr}R)`,
    `Lot size   : ${pos.qty} units   (notional ${pos.notional})`,
    `Margin used: ${pos.margin}   @ ${pos.leverage}x leverage`,
    `Risk       : ${pos.riskAmount}   ->  Reward: ${pos.rewardAmount}`,
  ];
  if (pos.capped) {
    lines.push(`NOTE: size capped by leverage (full risk not deployable).`);
  }
  return lines.join("\n");
}
