import { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  LineChart,
  Line,
} from "recharts";

export function RRComparison({ trades }) {
  const rrRatios = [1.5, 2, 2.5, 3, 4, 5];
  
  const calculateRRStats = (rr) => {
    let wins = 0, losses = 0, open = 0, closed = 0, netR = 0;
    
    for (const t of trades) {
      if (t.outcome === "open") {
        open++;
        continue;
      }
      
      closed++;
      
      // Recalculate based on new RR
      // Note: This is a simplified calculation that assumes the same win/loss outcome
      // In reality, a higher RR means TP is further, so some wins might become losses
      // For accurate results, we'd need to re-run the backtest with actual price data
      if (t.outcome === "win") {
        wins++;
        netR += rr;
      } else if (t.outcome === "loss") {
        losses++;
        netR -= 1;
      }
    }
    
    return {
      rr,
      rrLabel: `1:${rr}`,
      trades: trades.length,
      wins,
      losses,
      open,
      closed,
      netR: Math.round(netR * 100) / 100,
      winRate: closed ? Math.round((wins / closed) * 1000) / 10 : 0,
      avgRPerTrade: closed ? Math.round((netR / closed) * 100) / 100 : 0,
      profitFactor: losses > 0 ? Math.round((wins * rr / losses) * 100) / 100 : wins > 0 ? 999 : 0,
    };
  };
  
  const results = useMemo(() => rrRatios.map(calculateRRStats), [trades]);
  
  const bestByNetR = useMemo(
    () => [...results].sort((a, b) => b.netR - a.netR)[0],
    [results]
  );
  
  const bestByAvgR = useMemo(
    () => [...results].sort((a, b) => b.avgRPerTrade - a.avgRPerTrade)[0],
    [results]
  );

  const chartData = results.map(stat => ({
    name: stat.rrLabel,
    "Net R": stat.netR,
    "Win Rate": stat.winRate,
    "Avg R/Trade": stat.avgRPerTrade,
    "Profit Factor": stat.profitFactor,
  }));

  return (
    <div className="flex flex-col gap-6">
      {/* Cards Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {results.map((stat) => {
          const isBestNetR = stat.rr === bestByNetR.rr;
          const isBestAvgR = stat.rr === bestByAvgR.rr;
          
          return (
            <Card 
              key={stat.rr}
              className={cn(
                "relative transition-all hover:shadow-md",
                isBestNetR && "border-bull border-2 shadow-lg"
              )}
            >
              <CardContent className="p-4">
                {isBestNetR && (
                  <div className="absolute -top-2 right-3 rounded-full bg-bull px-2 py-0.5 text-[10px] font-semibold text-white">
                    🏆 Best Overall
                  </div>
                )}
                {!isBestNetR && isBestAvgR && (
                  <div className="absolute -top-2 right-3 rounded-full bg-blue-500 px-2 py-0.5 text-[10px] font-semibold text-white">
                    ⭐ Best Avg R
                  </div>
                )}
                
                <div className="flex items-center justify-between">
                  <span className="text-xl font-bold">1:{stat.rr}</span>
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {stat.closed} closed
                  </span>
                </div>
                
                <div className="mt-3 flex items-end gap-3">
                  <span className={cn("text-3xl font-bold", stat.winRate >= 50 ? "text-bull" : "text-bear")}>
                    {stat.winRate}%
                  </span>
                  <span className="mb-1 text-xs text-muted-foreground">win rate</span>
                </div>
                
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <div className="text-center">
                    <div className="text-lg font-bold text-bull">{stat.wins}</div>
                    <div className="text-[10px] text-muted-foreground">Wins</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-bold text-bear">{stat.losses}</div>
                    <div className="text-[10px] text-muted-foreground">Losses</div>
                  </div>
                  <div className="text-center">
                    <div className={cn("text-lg font-bold", stat.netR >= 0 ? "text-bull" : "text-bear")}>
                      {stat.netR > 0 ? `+${stat.netR}` : stat.netR}
                    </div>
                    <div className="text-[10px] text-muted-foreground">Net R</div>
                  </div>
                </div>
                
                <div className="mt-3 pt-3 border-t border-border">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] text-muted-foreground">Avg R/Trade</span>
                    <span className={cn("text-sm font-bold", stat.avgRPerTrade >= 0 ? "text-bull" : "text-bear")}>
                      {stat.avgRPerTrade > 0 ? `+${stat.avgRPerTrade}` : stat.avgRPerTrade}R
                    </span>
                  </div>
                  <div className="flex justify-between items-center mt-1">
                    <span className="text-[10px] text-muted-foreground">Profit Factor</span>
                    <span className={cn("text-sm font-bold", stat.profitFactor >= 1.5 ? "text-bull" : stat.profitFactor >= 1 ? "text-yellow-600" : "text-bear")}>
                      {stat.profitFactor}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Net R Comparison */}
        <Card>
          <CardContent className="p-4">
            <h3 className="mb-4 text-sm font-semibold">Net R by Risk-Reward Ratio</h3>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis 
                  dataKey="name" 
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={12}
                />
                <YAxis 
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={12}
                />
                <Tooltip 
                  contentStyle={{
                    backgroundColor: "hsl(var(--popover))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                  }}
                />
                <Bar 
                  dataKey="Net R" 
                  fill="hsl(var(--bull))" 
                  radius={[8, 8, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Win Rate Comparison */}
        <Card>
          <CardContent className="p-4">
            <h3 className="mb-4 text-sm font-semibold">Win Rate by Risk-Reward Ratio</h3>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis 
                  dataKey="name" 
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={12}
                />
                <YAxis 
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={12}
                  domain={[0, 100]}
                />
                <Tooltip 
                  contentStyle={{
                    backgroundColor: "hsl(var(--popover))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                  }}
                />
                <Line 
                  type="monotone" 
                  dataKey="Win Rate" 
                  stroke="hsl(var(--primary))" 
                  strokeWidth={2}
                  dot={{ fill: "hsl(var(--primary))", r: 5 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Average R per Trade */}
        <Card>
          <CardContent className="p-4">
            <h3 className="mb-4 text-sm font-semibold">Average R per Trade</h3>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis 
                  dataKey="name" 
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={12}
                />
                <YAxis 
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={12}
                />
                <Tooltip 
                  contentStyle={{
                    backgroundColor: "hsl(var(--popover))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                  }}
                />
                <Bar 
                  dataKey="Avg R/Trade" 
                  fill="hsl(var(--primary))" 
                  radius={[8, 8, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Profit Factor */}
        <Card>
          <CardContent className="p-4">
            <h3 className="mb-4 text-sm font-semibold">Profit Factor by RR Ratio</h3>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis 
                  dataKey="name" 
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={12}
                />
                <YAxis 
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={12}
                />
                <Tooltip 
                  contentStyle={{
                    backgroundColor: "hsl(var(--popover))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                  }}
                />
                <Line 
                  type="monotone" 
                  dataKey="Profit Factor" 
                  stroke="hsl(var(--bull))" 
                  strokeWidth={2}
                  dot={{ fill: "hsl(var(--bull))", r: 5 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Analysis Summary */}
      <Card>
        <CardContent className="p-4">
          <h3 className="mb-3 text-sm font-semibold">Analysis Summary</h3>
          <div className="space-y-2 text-sm">
            <p>
              <span className="font-semibold text-bull">Best Overall Performance:</span>{" "}
              <span className="font-mono">1:{bestByNetR.rr}</span> with {bestByNetR.netR > 0 ? "+" : ""}{bestByNetR.netR}R net return
            </p>
            <p>
              <span className="font-semibold text-blue-600">Best Average Return:</span>{" "}
              <span className="font-mono">1:{bestByAvgR.rr}</span> with {bestByAvgR.avgRPerTrade > 0 ? "+" : ""}{bestByAvgR.avgRPerTrade}R per trade
            </p>
            <p className="text-xs text-muted-foreground mt-3">
              💡 <strong>Note:</strong> This comparison uses the existing trade outcomes and recalculates rewards. 
              In practice, a higher RR ratio means the take-profit is further away, which could reduce the win rate. 
              For most accurate results, re-run the backtest with your chosen RR ratio to see actual performance.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
