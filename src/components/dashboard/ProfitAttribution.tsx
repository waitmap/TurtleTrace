import { Card } from '../ui/card'
import { Target, TrendingUp, TrendingDown } from 'lucide-react'
import type { PositionProfit, ClearedProfit } from '../../types'
import { formatCurrency, cn } from '../../lib/utils'

interface ProfitAttributionProps {
  positions: PositionProfit[]
  clearedProfit?: ClearedProfit | null
}

interface AttributionItem {
  name: string
  symbol: string
  profit: number
  profitPercent: number
  type: 'holding' | 'cleared'
}

const PIE_COLORS = [
  '#ef4444', '#3b82f6', '#f59e0b', '#8b5cf6', '#10b981',
  '#ec4899', '#06b6d4', '#f97316', '#6366f1', '#14b8a6',
]

function DonutChart({
  items,
  total,
  centerLabel,
  centerValue,
}: {
  items: AttributionItem[]
  total: number
  centerLabel: string
  centerValue: string
}) {
  if (items.length === 0) return null

  let cumPct = 0
  const stops = items.map((item, i) => {
    const pct = total > 0 ? (Math.abs(item.profit) / total) * 100 : 0
    const start = cumPct
    cumPct += pct
    return `${PIE_COLORS[i % PIE_COLORS.length]} ${start}% ${cumPct}%`
  })
  const gradient = `conic-gradient(${stops.join(', ')})`

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative">
        <div className="w-32 h-32 rounded-full" style={{ background: gradient }} />
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-16 h-16 rounded-full bg-card flex flex-col items-center justify-center">
            <span className="text-[10px] text-muted-foreground">{centerLabel}</span>
            <span className="text-xs font-bold font-mono">{centerValue}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function LegendList({
  items,
  total,
  formatPnL,
  formatPercent,
}: {
  items: AttributionItem[]
  total: number
  formatPnL: (amount: number) => string
  formatPercent: (p: number) => string
}) {
  return (
    <div className="w-full">
      {/* 表头 */}
      <div className="grid grid-cols-[18px_1fr_80px_130px_80px] gap-1 text-[11px] text-foreground font-medium mb-1.5">
        <div />
        <span>股票</span>
        <span className="text-right">占比</span>
        <span className="text-right">盈亏金额</span>
        <span className="text-right">收益率</span>
      </div>
      <div className="space-y-1.5">
      {items.map((item, i) => {
        const ratio = total > 0 ? (Math.abs(item.profit) / total) * 100 : 0
        return (
          <div key={item.symbol} className="grid grid-cols-[18px_1fr_80px_130px_80px] gap-1 text-xs items-center">
            <div className="flex justify-center">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
            </div>
            <span className="font-medium truncate">{item.name}</span>
            <span className="font-mono tabular-nums text-muted-foreground text-right">{ratio.toFixed(1)}%</span>
            <span className={cn("font-mono tabular-nums text-right", item.profit >= 0 ? 'text-up' : 'text-down')}>{formatPnL(item.profit)}</span>
            <span className={cn("font-mono tabular-nums text-right", item.profitPercent >= 0 ? 'text-up' : 'text-down')}>{formatPercent(item.profitPercent)}</span>
          </div>
        )
      })}
      </div>
    </div>
  )
}

export function ProfitAttribution({ positions, clearedProfit }: ProfitAttributionProps) {
  const activePositions = positions.filter(p => p.quantity > 0)

  const allItems: AttributionItem[] = [
    ...activePositions.map(p => ({
      name: p.name,
      symbol: p.symbol,
      profit: p.profit,
      profitPercent: p.profitPercent,
      type: 'holding' as const,
    })),
    ...(clearedProfit?.positions?.map(p => ({
      name: p.name,
      symbol: p.symbol,
      profit: p.profit,
      profitPercent: p.profitPercent,
      type: 'cleared' as const,
    })) || []),
  ]

  if (allItems.length === 0) return null

  const winners = [...allItems].filter(i => i.profit > 0).sort((a, b) => b.profit - a.profit)
  const losers = [...allItems].filter(i => i.profit < 0).sort((a, b) => a.profit - b.profit)
  const totalProfit = allItems.reduce((sum, i) => sum + i.profit, 0)

  const totalPositive = winners.reduce((sum, i) => sum + i.profit, 0)
  const totalNegative = losers.reduce((sum, i) => sum + Math.abs(i.profit), 0)

  const topWinners = winners.slice(0, 6)
  const topLosers = losers.slice(0, 6)
  const topWinnersProfit = topWinners.reduce((sum, i) => sum + i.profit, 0)
  const concentration = totalProfit > 0 ? (topWinnersProfit / totalProfit) * 100 : 0

  const formatPnL = (amount: number) => {
    const abs = formatCurrency(Math.abs(amount))
    return amount >= 0 ? `+${abs}` : `-${abs}`
  }

  const formatPercent = (p: number) => {
    const abs = Math.abs(p).toFixed(2)
    return p >= 0 ? `+${abs}%` : `-${abs}%`
  }

  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 mb-5">
        <Target className="h-4 w-4 text-primary" />
        <h3 className="font-semibold text-sm">盈亏归因</h3>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 盈利贡献 */}
        <div>
          <div className="flex items-center gap-1.5 mb-3">
            <TrendingUp className="h-4 w-4 text-up" />
            <span className="text-sm font-medium text-up">盈利贡献</span>
          </div>
          {topWinners.length > 0 ? (
            <div className="flex flex-col items-center gap-4">
              <DonutChart
                items={topWinners}
                total={totalPositive}
                centerLabel="盈利合计"
                centerValue={formatCurrency(totalPositive)}
              />
              <LegendList
                items={topWinners}
                total={totalPositive}
                formatPnL={formatPnL}
                formatPercent={formatPercent}
              />
            </div>
          ) : (
            <div className="text-sm text-muted-foreground py-8 text-center">暂无盈利股票</div>
          )}
        </div>

        {/* 亏损拖累 */}
        <div>
          <div className="flex items-center gap-1.5 mb-3">
            <TrendingDown className="h-4 w-4 text-down" />
            <span className="text-sm font-medium text-down">亏损拖累</span>
          </div>
          {topLosers.length > 0 ? (
            <div className="flex flex-col items-center gap-4">
              <DonutChart
                items={topLosers}
                total={totalNegative}
                centerLabel="亏损合计"
                centerValue={formatCurrency(totalNegative)}
              />
              <LegendList
                items={topLosers}
                total={totalNegative}
                formatPnL={formatPnL}
                formatPercent={formatPercent}
              />
            </div>
          ) : (
            <div className="text-sm text-muted-foreground py-8 text-center">暂无亏损股票</div>
          )}
        </div>
      </div>

      {/* 盈利集中度 */}
      {totalProfit > 0 && topWinners.length > 0 && (
        <div className={cn("mt-4 pt-4 border-t text-xs text-muted-foreground flex items-center gap-2")}>
          <span>盈利集中度：前 {topWinners.length} 只贡献总盈利的</span>
          <span className="font-semibold font-mono text-foreground">{concentration.toFixed(1)}%</span>
        </div>
      )}
    </Card>
  )
}
