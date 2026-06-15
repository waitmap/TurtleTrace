import { TrendingUp, TrendingDown, Target, Flame, Snowflake } from 'lucide-react'
import type { ProfitSummary, Position, PositionProfit } from '../../../types'
import { formatCurrency, cn } from '../../../lib/utils'
import React, { useMemo } from 'react'

interface MobileDashboardProps {
  summary: ProfitSummary
  positions: Position[]
}

function calculateTodayPnL(positions: Position[]): { amount: number; percent: number } {
  let todayAmount = 0
  let yesterdayValue = 0
  for (const p of positions) {
    if (p.quantity <= 0) continue
    const prevClose = p.prevClose || 0
    if (prevClose <= 0) continue
    todayAmount += (p.currentPrice - prevClose) * p.quantity
    yesterdayValue += prevClose * p.quantity
  }
  const todayPercent = yesterdayValue > 0 ? (todayAmount / yesterdayValue) * 100 : 0
  return { amount: todayAmount, percent: todayPercent }
}

function SummaryCard({ label, value, percent, isPositive, format }: {
  label: string
  value: number
  percent?: number
  isPositive?: boolean
  format?: (v: number) => string
}) {
  const sign = value > 0 ? '+' : value < 0 ? '-' : ''
  const f = format || formatCurrency
  return (
    <div className={cn(
      "rounded-2xl p-5 border",
      isPositive !== undefined
        ? isPositive ? "bg-up/5 border-up/20" : "bg-down/5 border-down/20"
        : "bg-card border-border"
    )}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm text-muted-foreground">{label}</span>
        {isPositive !== undefined && (
          <div className={cn("p-1.5 rounded-lg", isPositive ? "bg-up/20 text-up" : "bg-down/20 text-down")}>
            {isPositive ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
          </div>
        )}
      </div>
      <div className={cn(
        "text-2xl font-bold font-mono tabular-nums",
        isPositive !== undefined ? (isPositive ? 'text-up' : 'text-down') : 'text-foreground'
      )}>
        {sign}{f(Math.abs(value))}
      </div>
      {percent !== undefined && (
        <div className={cn(
          "text-sm font-medium mt-1",
          percent >= 0 ? 'text-up' : 'text-down'
        )}>
          {percent >= 0 ? '+' : '-'}{Math.abs(percent).toFixed(2)}%
        </div>
      )}
    </div>
  )
}

function PerformerCard({ label, icon, iconColor, position, showPercent }: {
  label: string
  icon: React.ReactNode
  iconColor: string
  position: PositionProfit | null
  showPercent?: boolean
}) {
  if (!position) return null
  return (
    <div className="bg-surface/50 border rounded-xl p-4">
      <div className="flex items-center gap-2 mb-2">
        <span style={{ color: iconColor }}>{icon}</span>
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
      </div>
      <div className="font-semibold text-sm">{position.name}</div>
      <div className="text-xs text-muted-foreground font-mono mb-2">{position.symbol}</div>
      <div className="flex items-baseline gap-2">
        {showPercent ? (
          <>
            <span className={cn("text-lg font-bold font-mono", position.profitPercent >= 0 ? 'text-up' : 'text-down')}>
              {position.profitPercent >= 0 ? '+' : '-'}{Math.abs(position.profitPercent).toFixed(2)}%
            </span>
            <span className={cn("text-xs", position.profit >= 0 ? 'text-up' : 'text-down')}>
              {position.profit >= 0 ? '+' : '-'}{formatCurrency(Math.abs(position.profit))}
            </span>
          </>
        ) : (
          <>
            <span className={cn("text-lg font-bold font-mono", position.profit >= 0 ? 'text-up' : 'text-down')}>
              {position.profit >= 0 ? '+' : '-'}{formatCurrency(Math.abs(position.profit))}
            </span>
            <span className={cn("text-xs", position.profitPercent >= 0 ? 'text-up' : 'text-down')}>
              {position.profitPercent >= 0 ? '+' : '-'}{Math.abs(position.profitPercent).toFixed(2)}%
            </span>
          </>
        )}
      </div>
    </div>
  )
}

export function MobileDashboard({ summary, positions }: MobileDashboardProps) {
  const { totalCost, totalValue, totalProfit, positions: positionProfits, clearedProfit } = summary

  const todayPnL = useMemo(() => calculateTodayPnL(positions), [positions])

  const activePositions = useMemo(
    () => positionProfits.filter(p => p.quantity > 0),
    [positionProfits]
  )

  const bestPerformer = useMemo(() => {
    if (activePositions.length === 0) return null
    return [...activePositions].sort((a, b) => b.profitPercent - a.profitPercent)[0]
  }, [activePositions])

  const worstPerformer = useMemo(() => {
    if (activePositions.length === 0) return null
    return [...activePositions].sort((a, b) => a.profitPercent - b.profitPercent)[0]
  }, [activePositions])

  const todayBest = useMemo(() => {
    const active = positions.filter(p => p.quantity > 0 && p.prevClose && p.prevClose > 0)
    if (active.length === 0) return null
    const calcToday = (p: Position) => ((p.currentPrice - p.prevClose!) / p.prevClose!) * 100
    return [...active].sort((a, b) => calcToday(b) - calcToday(a))[0]
  }, [positions])

  const todayWorst = useMemo(() => {
    const active = positions.filter(p => p.quantity > 0 && p.prevClose && p.prevClose > 0)
    if (active.length === 0) return null
    const calcToday = (p: Position) => ((p.currentPrice - p.prevClose!) / p.prevClose!) * 100
    return [...active].sort((a, b) => calcToday(a) - calcToday(b))[0]
  }, [positions])

  const activeCount = activePositions.length

  const totalProfitAll = totalProfit + (clearedProfit?.totalProfit || 0)

  const totalAllPositive = totalProfitAll >= 0

  return (
    <div className="space-y-4">
      <SummaryCard
        label="总盈亏"
        value={totalProfitAll}
        percent={undefined}
        isPositive={totalAllPositive}
      />

      <SummaryCard
        label="今日盈亏"
        value={todayPnL.amount}
        percent={todayPnL.percent}
        isPositive={todayPnL.amount >= 0}
      />

      <div className="grid grid-cols-2 gap-3">
        <div className="bg-card border rounded-2xl p-4">
          <div className="text-xs text-muted-foreground mb-1">持仓盈亏</div>
          <div className={cn("text-xl font-bold font-mono", totalProfit >= 0 ? 'text-up' : 'text-down')}>
            {totalProfit >= 0 ? '+' : '-'}{formatCurrency(Math.abs(totalProfit))}
          </div>
          <div className="flex justify-between text-xs text-muted-foreground mt-2">
            <span>{activeCount} 只</span>
            <span>成本 {formatCurrency(totalCost)}</span>
            <span>市值 {formatCurrency(totalValue)}</span>
          </div>
        </div>

        <div className="bg-card border rounded-2xl p-4">
          <div className="text-xs text-muted-foreground mb-1">清仓盈亏</div>
          <div className={cn("text-xl font-bold font-mono", clearedProfit ? (clearedProfit.totalProfit >= 0 ? 'text-up' : 'text-down') : 'text-foreground')}>
            {clearedProfit ? `${clearedProfit.totalProfit >= 0 ? '+' : '-'}${formatCurrency(Math.abs(clearedProfit.totalProfit))}` : '-'}
          </div>
          <div className="flex justify-between text-xs text-muted-foreground mt-2">
            <span>{clearedProfit?.count || 0} 只</span>
            <span>买入 {formatCurrency(clearedProfit?.totalBuyAmount || 0)}</span>
            <span>卖出 {formatCurrency(clearedProfit?.totalSellAmount || 0)}</span>
          </div>
        </div>
      </div>

      <div className="bg-card border rounded-2xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <Target className="h-4 w-4 text-primary" />
          <h3 className="font-semibold text-sm">今日涨跌王</h3>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {(() => {
            const calcToday = (p: Position) => ((p.currentPrice - (p.prevClose || 0)) / (p.prevClose || 1)) * 100
            return <>
          <PerformerCard
            label="涨最多"
            icon={<Flame className="h-4 w-4" />}
            iconColor="var(--up-primary, #ef4444)"
            position={todayBest ? {
              symbol: todayBest.symbol,
              name: todayBest.name || todayBest.symbol,
              cost: 0, value: 0, quantity: todayBest.quantity,
              currentPrice: todayBest.currentPrice,
              profit: (todayBest.currentPrice - (todayBest.prevClose || 0)) * todayBest.quantity,
              profitPercent: calcToday(todayBest),
            } : null}
            showPercent={true}
          />
          <PerformerCard
            label="跌最多"
            icon={<Snowflake className="h-4 w-4" />}
            iconColor="var(--down-primary, #10b981)"
            position={todayWorst ? {
              symbol: todayWorst.symbol,
              name: todayWorst.name || todayWorst.symbol,
              cost: 0, value: 0, quantity: todayWorst.quantity,
              currentPrice: todayWorst.currentPrice,
              profit: (todayWorst.currentPrice - (todayWorst.prevClose || 0)) * todayWorst.quantity,
              profitPercent: calcToday(todayWorst),
            } : null}
            showPercent={true}
          />
            </>
          })()}
        </div>
      </div>

      <div className="bg-card border rounded-2xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <Target className="h-4 w-4 text-primary" />
          <h3 className="font-semibold text-sm">累计盈亏王</h3>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <PerformerCard
            label="赚最多"
            icon={<TrendingUp className="h-4 w-4" />}
            iconColor="var(--up-primary, #ef4444)"
            position={bestPerformer}
          />
          <PerformerCard
            label="亏最多"
            icon={<TrendingDown className="h-4 w-4" />}
            iconColor="var(--down-primary, #10b981)"
            position={worstPerformer}
          />
        </div>
      </div>
    </div>
  )
}
