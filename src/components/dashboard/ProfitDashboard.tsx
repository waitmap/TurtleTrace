import { Card } from '../ui/card'
import { Button } from '../ui/button'
import { TrendingUp, TrendingDown, PieChart, EyeOff, Wallet, Share2, Layers, CalendarDays, Flame, Snowflake, Target } from 'lucide-react'
import type { ProfitSummary, PositionProfit, Position } from '../../types'
import { formatCurrency, cn } from '../../lib/utils'
import { ShareDialog } from './ShareDialog'
import { ClearedProfitShareDialog } from './ClearedProfitShareDialog'
import { ProfitAttribution } from './ProfitAttribution'
import { useState, useMemo } from 'react'

interface ProfitDashboardProps {
  summary: ProfitSummary
  showClearedProfitCard: boolean
  onToggleClearedProfitCard: () => void
  positions: Position[]
}

// 计算今日盈亏（基于昨收价）
function calculateTodayPnL(positions: Position[]): { amount: number; percent: number } {
  let todayAmount = 0
  let yesterdayValue = 0
  for (const p of positions) {
    if (p.quantity <= 0) continue
    const prevClose = p.prevClose || 0
    if (prevClose <= 0) continue
    const todayChange = (p.currentPrice - prevClose) * p.quantity
    todayAmount += todayChange
    yesterdayValue += prevClose * p.quantity
  }
  const todayPercent = yesterdayValue > 0 ? (todayAmount / yesterdayValue) * 100 : 0
  return { amount: todayAmount, percent: todayPercent }
}

// 计算单只股票今日涨跌幅
function calcTodayChangePercent(p: Position): number {
  const prevClose = p.prevClose || 0
  if (prevClose <= 0) return 0
  return ((p.currentPrice - prevClose) / prevClose) * 100
}

// 持仓分布饼图
function PositionPieChart({ positions }: { positions: PositionProfit[] }) {
  const activePositions = positions.filter(p => p.quantity > 0 && p.value > 0)
  const totalValue = activePositions.reduce((sum, p) => sum + p.value, 0)

  if (activePositions.length === 0) return null

  const colors = [
    '#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6',
    '#ec4899', '#06b6d4', '#f97316', '#14b8a6', '#6366f1',
  ]

  let cumulativePercent = 0
  const gradientStops = activePositions.map((p, i) => {
    const percent = (p.value / totalValue) * 100
    const start = cumulativePercent
    cumulativePercent += percent
    return `${colors[i % colors.length]} ${start}% ${cumulativePercent}%`
  })

  const gradient = `conic-gradient(${gradientStops.join(', ')})`

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative">
        <div className="w-36 h-36 rounded-full" style={{ background: gradient }} />
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-20 h-20 rounded-full bg-card flex flex-col items-center justify-center">
            <span className="text-xs text-muted-foreground">总市值</span>
            <span className="text-sm font-bold font-mono">{formatCurrency(totalValue)}</span>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 w-full">
        {activePositions.map((p, i) => (
          <div key={p.symbol} className="flex items-center gap-2 text-xs">
            <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: colors[i % colors.length] }} />
            <span className="truncate flex-1">{p.name}</span>
            <span className="text-muted-foreground font-mono">{((p.value / totalValue) * 100).toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function ProfitDashboard({
  summary,
  showClearedProfitCard,
  onToggleClearedProfitCard,
  positions,
}: ProfitDashboardProps) {
  const { totalCost, totalValue, totalProfit, totalProfitPercent, positions: positionProfits, clearedProfit } = summary
  const [shareDialogOpen, setShareDialogOpen] = useState(false)
  const [clearedProfitDialogOpen, setClearedProfitDialogOpen] = useState(false)

  // 今日盈亏
  const todayPnL = useMemo(() => calculateTodayPnL(positions), [positions])

  // 持仓盈亏、清仓盈亏、总盈亏
  const holdingProfit = totalProfit
  const holdingProfitPercent = totalProfitPercent
  const clearedP = clearedProfit?.totalProfit || 0
  const clearedPPercent = clearedProfit?.totalProfitPercent || 0
  const totalAllProfit = holdingProfit + clearedP
  const totalAllCost = totalCost + (clearedProfit?.totalBuyAmount || 0)
  const totalAllPercent = totalAllCost > 0 ? (totalAllProfit / totalAllCost) * 100 : 0

  // 持仓统计
  const activeCount = positionProfits.filter(p => p.quantity > 0).length
  const clearedCount = positions.filter(p => p.quantity <= 0).length

  // 今日涨跌王（用 prevClose 计算真实今日涨跌幅）
  const todayBest = useMemo(() => {
    const active = positions.filter(p => p.quantity > 0 && p.prevClose && p.prevClose > 0)
    if (active.length === 0) return null
    return [...active].sort((a, b) => calcTodayChangePercent(b) - calcTodayChangePercent(a))[0]
  }, [positions])

  const todayWorst = useMemo(() => {
    const active = positions.filter(p => p.quantity > 0 && p.prevClose && p.prevClose > 0)
    if (active.length === 0) return null
    return [...active].sort((a, b) => calcTodayChangePercent(a) - calcTodayChangePercent(b))[0]
  }, [positions])

  // 累计盈亏最佳/最差
  const activePositions = useMemo(() => positionProfits.filter(p => p.quantity > 0), [positionProfits])
  const bestPerformer = useMemo(() => {
    if (activePositions.length === 0) return null
    return [...activePositions].sort((a, b) => b.profit - a.profit)[0]
  }, [activePositions])
  const worstPerformer = useMemo(() => {
    if (activePositions.length === 0) return null
    return [...activePositions].sort((a, b) => a.profit - b.profit)[0]
  }, [activePositions])

  // 盈亏金额格式化（带正负号）
  const formatPnL = (amount: number) => {
    const formatted = formatCurrency(Math.abs(amount))
    return amount >= 0 ? `+${formatted}` : `-${formatted}`
  }

  // 盈亏百分比格式化（带正负号）
  const formatPnLPercent = (percent: number) => {
    const formatted = `${Math.abs(percent).toFixed(2)}%`
    return percent >= 0 ? `+${formatted}` : `-${formatted}`
  }

  return (
    <div className="space-y-6">
      {/* 顶部操作栏 */}
      <Card className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-primary/10 rounded-lg">
              <Layers className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h2 className="text-xl font-bold">我的账户</h2>
              <p className="text-sm text-muted-foreground">实时查看持仓盈亏情况</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {clearedProfit && (
              <Button variant="outline" size="sm" onClick={onToggleClearedProfitCard} className="gap-2">
                {showClearedProfitCard ? <><EyeOff className="h-4 w-4" />隐藏清仓收益</> : <><Wallet className="h-4 w-4" />显示清仓收益</>}
              </Button>
            )}
            <Button variant="default" size="sm" onClick={() => setShareDialogOpen(true)} className="gap-2">
              <Share2 className="h-4 w-4" />分享收益
            </Button>
          </div>
        </div>
      </Card>

      <ShareDialog summary={summary} isOpen={shareDialogOpen} onClose={() => setShareDialogOpen(false)} />

      {/* 核心指标卡片 */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {/* 总盈亏 = 持仓 + 清仓 */}
        <Card className={cn("p-5 border-l-4 col-span-2 lg:col-span-1", totalAllProfit >= 0 ? "border-l-up bg-up/5" : "border-l-down bg-down/5")}>
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-muted-foreground">总盈亏</span>
            <div className={cn("p-1.5 rounded-lg", totalAllProfit >= 0 ? "bg-up/20 text-up" : "bg-down/20 text-down")}>
              {totalAllProfit >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
            </div>
          </div>
          <div className={cn("text-2xl font-bold font-mono tabular-nums", totalAllProfit >= 0 ? 'text-up' : 'text-down')}>
            {formatPnL(totalAllProfit)}
          </div>
          <div className={cn("text-sm font-medium mt-1", totalAllPercent >= 0 ? 'text-up' : 'text-down')}>
            {formatPnLPercent(totalAllPercent)}
          </div>
        </Card>

        {/* 持仓盈亏 */}
        <Card className={cn("p-5 border-l-4 col-span-2 lg:col-span-1", holdingProfit >= 0 ? "border-l-up bg-up/5" : "border-l-down bg-down/5")}>
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-muted-foreground">持仓盈亏</span>
            <div className={cn("p-1.5 rounded-lg", holdingProfit >= 0 ? "bg-up/20 text-up" : "bg-down/20 text-down")}>
              {holdingProfit >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
            </div>
          </div>
          <div className={cn("text-2xl font-bold font-mono tabular-nums", holdingProfit >= 0 ? 'text-up' : 'text-down')}>
            {formatPnL(holdingProfit)}
          </div>
          <div className={cn("text-sm font-medium mt-1", holdingProfitPercent >= 0 ? 'text-up' : 'text-down')}>
            {formatPnLPercent(holdingProfitPercent)}
          </div>
        </Card>

        {/* 清仓盈亏 */}
        <Card className={cn("p-5 border-l-4 col-span-2 lg:col-span-1", clearedP >= 0 ? "border-l-up bg-up/5" : "border-l-down bg-down/5")}>
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-muted-foreground">清仓盈亏</span>
            <div className={cn("p-1.5 rounded-lg", clearedP >= 0 ? "bg-up/20 text-up" : "bg-down/20 text-down")}>
              {clearedP >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
            </div>
          </div>
          <div className={cn("text-2xl font-bold font-mono tabular-nums", clearedP >= 0 ? 'text-up' : 'text-down')}>
            {formatPnL(clearedP)}
          </div>
          <div className={cn("text-sm font-medium mt-1", clearedPPercent >= 0 ? 'text-up' : 'text-down')}>
            {formatPnLPercent(clearedPPercent)}
          </div>
        </Card>

        {/* 今日盈亏 */}
        <Card className={cn("p-5 border-l-4 col-span-2 lg:col-span-1", todayPnL.amount >= 0 ? "border-l-up bg-up/5" : "border-l-down bg-down/5")}>
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-muted-foreground">今日盈亏</span>
            <div className={cn("p-1.5 rounded-lg", todayPnL.amount >= 0 ? "bg-up/20 text-up" : "bg-down/20 text-down")}>
              <CalendarDays className="h-4 w-4" />
            </div>
          </div>
          <div className={cn("text-2xl font-bold font-mono tabular-nums", todayPnL.amount >= 0 ? 'text-up' : 'text-down')}>
            {formatPnL(todayPnL.amount)}
          </div>
          <div className={cn("text-sm font-medium mt-1", todayPnL.percent >= 0 ? 'text-up' : 'text-down')}>
            {formatPnLPercent(todayPnL.percent)}
          </div>
        </Card>

        {/* 持仓数量 */}
        <Card className="p-5 border-l-4 border-l-muted col-span-2 lg:col-span-1">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-muted-foreground">持仓</span>
            <Layers className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="text-2xl font-bold font-mono tabular-nums">{activeCount} <span className="text-sm font-normal text-muted-foreground">只</span></div>
          {clearedCount > 0 && (
            <div className="text-xs text-muted-foreground mt-1">已清仓 {clearedCount} 只</div>
          )}
        </Card>
      </div>

      {/* 持仓详情卡片 */}
      <Card className="p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-primary" />
            <h3 className="font-semibold text-sm">持仓详情</h3>
          </div>
          <div className="flex items-center gap-6 text-sm">
            <div>
              <span className="text-muted-foreground">总买入 </span>
              <span className="font-mono font-medium">{formatCurrency(totalCost)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">现市值 </span>
              <span className="font-mono font-medium">{formatCurrency(totalValue)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">持仓 </span>
              <span className="font-mono font-medium">{activeCount} 只</span>
            </div>
          </div>
        </div>
        {/* 每只股票对比柱状图 */}
        {activePositions.length > 0 && (
          <div className="space-y-3">
            {activePositions.map((p) => {
              const valuePercent = p.cost > 0 ? (p.value / p.cost) * 100 : 0
              const isProfit = p.value >= p.cost
              return (
                <div key={p.symbol} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{p.name}</span>
                      <span className="text-muted-foreground font-mono">{p.symbol}</span>
                    </div>
                    <div className="flex items-center gap-3 font-mono">
                      <span className="text-muted-foreground">成本 {formatCurrency(p.cost)}</span>
                      <span className={isProfit ? 'text-up' : 'text-down'}>市值 {formatCurrency(p.value)}</span>
                      <span className={cn("font-semibold", isProfit ? 'text-up' : 'text-down')}>
                        {formatPnL(p.profit)} ({formatPnLPercent(p.profitPercent)})
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 h-5">
                    <div className="relative flex-1 h-full bg-muted/30 rounded overflow-hidden">
                      {/* 成本条（固定100%） */}
                      <div
                        className="absolute left-0 top-0 h-full bg-blue-400/30 rounded"
                        style={{ width: '100%' }}
                      />
                      {/* 市值条（相对成本的百分比） */}
                      <div
                        className={cn("absolute left-0 top-0 h-full rounded", isProfit ? 'bg-up/40' : 'bg-down/40')}
                        style={{ width: `${Math.min(valuePercent, 100)}%` }}
                      />
                      {/* 百分比标签 */}
                      <div className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-mono text-muted-foreground">
                        {valuePercent.toFixed(0)}%
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
            {/* 图例 */}
            <div className="flex items-center gap-4 text-xs text-muted-foreground pt-1">
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded bg-blue-400/30" />
                <span>成本（100%）</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded bg-up/40" />
                <span>市值 &gt; 成本（盈利）</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded bg-down/40" />
                <span>市值 &lt; 成本（亏损）</span>
              </div>
            </div>
          </div>
        )}
        {activePositions.length === 0 && (
          <div className="text-center py-8 text-muted-foreground text-sm">暂无持仓</div>
        )}
      </Card>

      {/* 第二行：持仓分布 + 今日表现 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* 持仓分布 */}
        <Card className="p-5 lg:col-span-1">
          <div className="flex items-center gap-2 mb-4">
            <PieChart className="h-4 w-4 text-primary" />
            <h3 className="font-semibold text-sm">持仓分布</h3>
          </div>
          {activePositions.length > 0 ? (
            <PositionPieChart positions={positionProfits} />
          ) : (
            <div className="text-center py-8 text-muted-foreground text-sm">暂无持仓</div>
          )}
        </Card>

        {/* 今日表现 + 累计盈亏 */}
        <Card className="p-5 lg:col-span-2">
          <div className="flex items-center gap-2 mb-4">
            <Target className="h-4 w-4 text-primary" />
            <h3 className="font-semibold text-sm">持仓表现</h3>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {/* 今日涨最多 */}
            <div className="bg-up/5 border border-up/20 rounded-xl p-3">
              <div className="flex items-center gap-1.5 mb-1.5">
                <Flame className="h-3.5 w-3.5 text-up" />
                <span className="text-xs font-medium text-up">今日涨最多</span>
              </div>
              {todayBest ? (
                <>
                  <div className="font-semibold text-sm truncate">{todayBest.name}</div>
                  <div className="text-lg font-bold text-up font-mono mt-1">
                    {formatPnLPercent(calcTodayChangePercent(todayBest))}
                  </div>
                  <div className="text-xs text-muted-foreground font-mono">
                    {formatPnL((todayBest.currentPrice - (todayBest.prevClose || 0)) * todayBest.quantity)}
                  </div>
                </>
              ) : (
                <div className="text-sm text-muted-foreground">暂无数据</div>
              )}
            </div>
            {/* 今日跌最多 */}
            <div className="bg-down/5 border border-down/20 rounded-xl p-3">
              <div className="flex items-center gap-1.5 mb-1.5">
                <Snowflake className="h-3.5 w-3.5 text-down" />
                <span className="text-xs font-medium text-down">今日跌最多</span>
              </div>
              {todayWorst ? (
                <>
                  <div className="font-semibold text-sm truncate">{todayWorst.name}</div>
                  <div className="text-lg font-bold text-down font-mono mt-1">
                    {formatPnLPercent(calcTodayChangePercent(todayWorst))}
                  </div>
                  <div className="text-xs text-muted-foreground font-mono">
                    {formatPnL((todayWorst.currentPrice - (todayWorst.prevClose || 0)) * todayWorst.quantity)}
                  </div>
                </>
              ) : (
                <div className="text-sm text-muted-foreground">暂无数据</div>
              )}
            </div>
            {/* 累计盈利最多 */}
            <div className="bg-surface/50 border rounded-xl p-3">
              <div className="flex items-center gap-1.5 mb-1.5">
                <TrendingUp className="h-3.5 w-3.5 text-up" />
                <span className="text-xs font-medium text-muted-foreground">累计盈利最多</span>
              </div>
              {bestPerformer ? (
                <>
                  <div className="font-semibold text-sm truncate">{bestPerformer.name}</div>
                  <div className="text-lg font-bold text-up font-mono mt-1">
                    {formatPnL(bestPerformer.profit)}
                  </div>
                  <div className="text-xs text-muted-foreground font-mono">
                    {formatPnLPercent(bestPerformer.profitPercent)}
                  </div>
                </>
              ) : (
                <div className="text-sm text-muted-foreground">暂无数据</div>
              )}
            </div>
            {/* 累计亏损最多 */}
            <div className="bg-surface/50 border rounded-xl p-3">
              <div className="flex items-center gap-1.5 mb-1.5">
                <TrendingDown className="h-3.5 w-3.5 text-down" />
                <span className="text-xs font-medium text-muted-foreground">累计亏损最多</span>
              </div>
              {worstPerformer ? (
                <>
                  <div className="font-semibold text-sm truncate">{worstPerformer.name}</div>
                  <div className={cn("text-lg font-bold font-mono mt-1", worstPerformer.profit >= 0 ? 'text-up' : 'text-down')}>
                    {formatPnL(worstPerformer.profit)}
                  </div>
                  <div className="text-xs text-muted-foreground font-mono">
                    {formatPnLPercent(worstPerformer.profitPercent)}
                  </div>
                </>
              ) : (
                <div className="text-sm text-muted-foreground">暂无数据</div>
              )}
            </div>
          </div>
        </Card>
      </div>

      {/* 清仓股票收益卡片 - 仅显示汇总 */}
      {clearedProfit && showClearedProfitCard && (
        <Card className={cn("overflow-hidden", clearedProfit.totalProfit >= 0 ? "border-up/30 bg-up/5" : "border-down/30 bg-down/5")}>
          <div className="border-b bg-surface/50 p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={cn("p-2 rounded-lg", clearedProfit.totalProfit >= 0 ? "bg-up/20 text-up" : "bg-down/20 text-down")}>
                  <Wallet className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-lg font-bold">已清仓股票收益</h3>
                  <p className="text-sm text-muted-foreground mt-0.5">已清仓 {clearedProfit.count} 只股票的总收益情况</p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <div className={cn("text-3xl font-bold font-mono tabular-nums", clearedProfit.totalProfit >= 0 ? 'text-up' : 'text-down')}>
                    {formatPnL(clearedProfit.totalProfit)}
                  </div>
                  <div className={cn("text-sm font-medium mt-1 px-3 py-1 rounded-full inline-flex", clearedProfit.totalProfitPercent >= 0 ? "bg-up/20 text-up" : "bg-down/20 text-down")}>
                    {formatPnLPercent(clearedProfit.totalProfitPercent)}
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={() => setClearedProfitDialogOpen(true)} className="shrink-0">
                  <Share2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
          <div className="p-5">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-surface/50 p-3 rounded-lg border">
                <div className="text-sm text-muted-foreground mb-1">总买入金额</div>
                <div className="text-lg font-semibold font-mono tabular-nums">{formatCurrency(clearedProfit.totalBuyAmount)}</div>
              </div>
              <div className="bg-surface/50 p-3 rounded-lg border">
                <div className="text-sm text-muted-foreground mb-1">总卖出金额</div>
                <div className="text-lg font-semibold font-mono tabular-nums">{formatCurrency(clearedProfit.totalSellAmount)}</div>
              </div>
              <div className="bg-surface/50 p-3 rounded-lg border">
                <div className="text-sm text-muted-foreground mb-1">已清仓数量</div>
                <div className="text-lg font-semibold font-mono tabular-nums">{clearedProfit.count} 只</div>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* 盈亏归因 */}
      <ProfitAttribution positions={positionProfits} clearedProfit={clearedProfit} />

      {/* 对话框 */}
      {clearedProfit && clearedProfitDialogOpen && <ClearedProfitShareDialog clearedProfit={clearedProfit} isOpen={clearedProfitDialogOpen} onClose={() => setClearedProfitDialogOpen(false)} />}
    </div>
  )
}
