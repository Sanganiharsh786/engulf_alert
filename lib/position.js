// Forex-style position sizing (standard lots), FundingPips / MT5 conventions.
//
//   Lots = Risk amount / (SL pips x pip value per lot)
//   pip value per lot = pip size x contract size
//
// contractSize = units in 1.00 lot (gold 100 oz, FX 100000, crypto often 1)
// pipSize      = price move of one pip (gold 0.1, FX 0.0001, crypto e.g. 1)
//
// Sizing rule: lose exactly (accountSize * risk%) when the stop is hit.

function round(n, dp = 2) {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

export function computePosition({
  direction,
  entry,
  stop,
  settings,
  leverage,
  contractSize,
  pipSize,
}) {
  const r = (settings && settings.risk) || {};
  if (!r.enabled) return null;

  const accountSize = Number(r.accountSize);
  const riskPercent = Number(r.riskPercent);
  const rr = Number(r.rewardRatio) || 2;
  const lev = Number(leverage) || 1;
  const cs = Number(contractSize) || 1; // units per 1.00 lot
  const pip = Number(pipSize) || 1; // price per pip

  if (!accountSize || !riskPercent || !entry || !stop) return null;

  const stopDistance = Math.abs(entry - stop); // in price
  if (stopDistance <= 0) return null;

  const dir = direction === "bullish" ? 1 : -1;
  const tp = entry + dir * stopDistance * rr;

  const slPips = stopDistance / pip;
  const pipValuePerLot = pip * cs; // money per pip for a 1.00 lot
  const riskAmount = accountSize * (riskPercent / 100);

  // standard forex lot-size formula
  let lots = riskAmount / (slPips * pipValuePerLot);
  let units = lots * cs; // = riskAmount / stopDistance

  // cap by leverage: notional can't exceed accountSize * leverage
  const maxNotional = accountSize * lev;
  let notional = units * entry;
  let capped = false;
  if (notional > maxNotional) {
    units = maxNotional / entry;
    lots = units / cs;
    notional = units * entry;
    capped = true;
  }

  const margin = notional / lev;
  const actualRisk = units * stopDistance; // = riskAmount unless capped

  return {
    entry: round(entry, 4),
    stop: round(stop, 4),
    tp: round(tp, 4),
    lots: round(lots, 2),
    units: round(units, 6),
    contractSize: cs,
    pipSize: pip,
    pipValuePerLot: round(pipValuePerLot, 4),
    notional: round(notional, 2),
    margin: round(margin, 2),
    leverage: lev,
    rr,
    slPips: round(slPips, 1),
    tpPips: round(slPips * rr, 1),
    riskAmount: round(actualRisk, 2),
    rewardAmount: round(actualRisk * rr, 2),
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
    `Lot size   : ${pos.lots} lots   (${pos.units} units)`,
    `Pip value  : ${pos.pipValuePerLot}/pip per lot   (contract ${pos.contractSize})`,
    `Margin used: ${pos.margin}   @ ${pos.leverage}x leverage   (notional ${pos.notional})`,
    `Risk       : ${pos.riskAmount}   ->  Reward: ${pos.rewardAmount}`,
  ];
  if (pos.capped) {
    lines.push(`NOTE: size capped by leverage (full risk not deployable).`);
  }
  return lines.join("\n");
}
