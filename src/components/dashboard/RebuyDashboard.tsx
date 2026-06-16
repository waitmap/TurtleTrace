import { useState, useCallback, useMemo } from 'react'
import {
  RefreshCw, Shield, TrendingDown,
  RotateCcw, Loader2, ChevronDown, ChevronUp,
  Check, X, AlertTriangle, Wallet,
} from 'lucide-react'
import type { Position, RebuyPlan, RebuyScoreData } from '../../types'
import { calculateRealizedProfit, calculateSafetyCushion, getRebuyBasePrice, simulateBatchRebuy } from '../../services/rebuyService'
import { calculateRebuyScore } from '../../services/rebuyScoreService'
import {
  getRebuyPlan, saveRebuyPlan,
} from '../../services/rebuyStorageService'
import { fetchAllMA, getStockQuote } from '../../services/stockService'
import { formatCurrency, cn } from '../../lib/utils'

interface RebuyDashboardProps {
  positions: Position[]
  mode: 'rebuy' | 'add'
}

export function RebuyDashboard({ positions, mode }: RebuyDashboardProps) {
  const isRebuy = mode === 'rebuy'
  const filteredPositions = positions.filter(p =>
    p.transactions.length > 0 && (isRebuy ? p.quantity === 0 : p.quantity > 0)
  )

  const [ma60Data, setMa60Data] = useState<Record<string, { value: number; source: 'api' | 'manual' } | null>>({})
  const [ma120Data, setMa120Data] = useState<Record<string, number | null>>({})
  const [ma250Data, setMa250Data] = useState<Record<string, number | null>>({})
  const [ma500Data, setMa500Data] = useState<Record<string, number | null>>({})
  const [ma1000Data, setMa1000Data] = useState<Record<string, number | null>>({})
  const [maLoading, setMaLoading] = useState<Record<string, boolean>>({})
  const [localPrices, setLocalPrices] = useState<Record<string, number>>({})
  const [priceLoading, setPriceLoading] = useState(false)
  const [expandedConfig, setExpandedConfig] = useState<Record<string, boolean>>({})
  const [editBudget, setEditBudget] = useState<Record<string, string>>({})
  const [editMa60, setEditMa60] = useState<Record<string, string>>({})
  const [sharesInput, setSharesInput] = useState<Record<string, string>>({})
  const [scoreData, setScoreData] = useState<Record<string, RebuyScoreData | null>>({})
  const [scoreLoading, setScoreLoading] = useState<Record<string, boolean>>({})

  // 获取有效MA60（手动覆盖优先）
  const getEffectiveMa60 = useCallback((posId: string): number | null => {
    const plan = getRebuyPlan(posId)
    if (plan?.manualMa60 && plan.manualMa60 > 0) return plan.manualMa60
    const fetched = ma60Data[posId]
    return fetched?.value ?? null
  }, [ma60Data])

  // 获取单只股票的所有均线（一次请求）
  const doFetchAllMA = useCallback(async (position: Position) => {
    const posId = position.id
    setMaLoading(prev => ({ ...prev, [posId]: true }))
    const allMA = await fetchAllMA(position.symbol)
    setMa60Data(prev => ({ ...prev, [posId]: allMA.ma60 !== null ? { value: allMA.ma60, source: 'api' } : null }))
    setMa120Data(prev => ({ ...prev, [posId]: allMA.ma120 }))
    setMa250Data(prev => ({ ...prev, [posId]: allMA.ma250 }))
    setMa500Data(prev => ({ ...prev, [posId]: allMA.ma500 }))
    setMa1000Data(prev => ({ ...prev, [posId]: allMA.ma1000 }))
    setMaLoading(prev => ({ ...prev, [posId]: false }))
  }, [])

  // 批量刷新所有已启用计划的均线（逐个获取，间隔500ms防限流）
  const doFetchAllMAForAll = useCallback(async () => {
    const targets = filteredPositions.filter(p => {
      const plan = getRebuyPlan(p.id)
      return plan?.enabled
    })
    for (const p of targets) {
      await doFetchAllMA(p)
      await new Promise(resolve => setTimeout(resolve, 500))
    }
  }, [filteredPositions, doFetchAllMA])

  // 计算评分
  const doCalculateScore = useCallback(async (position: Position) => {
    const plan = getRebuyPlan(position.id)
    if (!plan?.enabled) return
    const posId = position.id
    setScoreLoading(prev => ({ ...prev, [posId]: true }))
    const ma60 = getEffectiveMa60(posId)
    const ma120 = ma120Data[posId]
    const ma250 = ma250Data[posId]
    const ma500 = ma500Data[posId]
    const ma1000 = ma1000Data[posId]
    const score = await calculateRebuyScore(position, plan, ma60, ma120, ma250, ma500, ma1000)
    setScoreData(prev => ({ ...prev, [posId]: score }))
    setScoreLoading(prev => ({ ...prev, [posId]: false }))
  }, [getEffectiveMa60, ma120Data, ma250Data, ma500Data, ma1000Data])

  // 获取有效价格
  const getEffectivePrice = useCallback((position: Position): number => {
    return localPrices[position.id] ?? position.currentPrice
  }, [localPrices])

  const getEffectivePosition = useCallback((position: Position): Position => {
    const effectivePrice = getEffectivePrice(position)
    if (effectivePrice !== position.currentPrice) {
      return {
        ...position,
        currentPrice: effectivePrice,
        changePercent: position.costPrice > 0
          ? ((effectivePrice - position.costPrice) / position.costPrice) * 100
          : 0,
      }
    }
    return position
  }, [getEffectivePrice])

  // 刷新所有价格
  const handleRefreshPrices = useCallback(async () => {
    setPriceLoading(true)
    const priceUpdates: Record<string, number> = {}
    const targets = filteredPositions.filter(p => getRebuyPlan(p.id)?.enabled)
    for (const pos of targets) {
      const quote = await getStockQuote(pos.symbol)
      if (quote) {
        priceUpdates[pos.id] = quote.price
      }
      await new Promise(resolve => setTimeout(resolve, 300))
    }
    setLocalPrices(prev => ({ ...prev, ...priceUpdates }))
    setPriceLoading(false)
    // 重新计算评分
    for (const p of targets) {
      doCalculateScore(p)
    }
  }, [filteredPositions, doCalculateScore])

  // 切换启用状态
  const toggleEnabled = useCallback((position: Position, enabled: boolean) => {
    const existing = getRebuyPlan(position.id)
    const defaultBudget = existing?.totalBudget || 10000
    if (enabled) {
      const plan: RebuyPlan = existing || {
        totalBudget: defaultBudget,
        batchesExecuted: 0,
        enabled: true,
      }
      saveRebuyPlan(position.id, { ...plan, enabled: true })
      // 启用时自动获取均线
      doFetchAllMA(position)
    } else {
      if (existing) {
        saveRebuyPlan(position.id, { ...existing, enabled: false })
      }
      setScoreData(prev => ({ ...prev, [position.id]: null }))
    }
  }, [doFetchAllMA])

  // 保存预算
  const saveBudget = useCallback((position: Position, budget: number) => {
    const existing = getRebuyPlan(position.id) || {
      totalBudget: budget,
      batchesExecuted: 0,
      enabled: true,
    }
    saveRebuyPlan(position.id, { ...existing, totalBudget: budget })
    setEditBudget(prev => ({ ...prev, [position.id]: '' }))
    doCalculateScore(position)
  }, [doCalculateScore])

  // 保存手动MA60
  const saveManualMa60 = useCallback((position: Position, ma60: number | null) => {
    const existing = getRebuyPlan(position.id)
    if (!existing) return
    saveRebuyPlan(position.id, { ...existing, manualMa60: ma60 ?? undefined })
    setEditMa60(prev => ({ ...prev, [position.id]: '' }))
    setMa60Data(prev => ({
      ...prev,
      [position.id]: ma60 !== null ? { value: ma60, source: 'manual' } : prev[position.id] || null,
    }))
    doCalculateScore(position)
  }, [doCalculateScore])

  const handleSharesChange = useCallback((posId: string, value: string) => {
    const cleaned = value.replace(/[^0-9]/g, '')
    setSharesInput(prev => ({ ...prev, [posId]: cleaned }))
  }, [])

  if (filteredPositions.length === 0) {
    const emptyMsg = isRebuy
      ? '暂无已清仓股票，卖出股票后可在此制定回购计划'
      : '暂无持仓股票，请在「持仓管理」中添加股票'
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <Shield className="h-16 w-16 mb-4 opacity-20" />
        <p className="text-lg font-medium mb-2">{isRebuy ? '暂无清仓记录' : '暂无持仓'}</p>
        <p className="text-sm">{emptyMsg}</p>
      </div>
    )
  }

  const enabledCount = filteredPositions.filter(p => getRebuyPlan(p.id)?.enabled).length
  const title = isRebuy ? '回购计划' : '补仓计划'
  const subtitle = isRebuy
    ? `安全垫驱动型智能回购 — 已启用 ${enabledCount}/${filteredPositions.length} 只`
    : `持仓补仓决策 — 已启用 ${enabledCount}/${filteredPositions.length} 只`

  return (
    <div className="space-y-6">
      {/* 页面头 */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">{title}</h2>
          <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
        </div>
        {enabledCount > 0 && (
          <div className="flex items-center gap-2">
            <button
              onClick={handleRefreshPrices}
              className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border hover:bg-surface-hover transition-colors"
              disabled={priceLoading}
            >
              <RefreshCw className={`h-4 w-4 ${priceLoading ? 'animate-spin' : ''}`} />
              刷新价格
            </button>
            <button
              onClick={doFetchAllMAForAll}
              className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border hover:bg-surface-hover transition-colors"
              disabled={Object.values(maLoading).some(Boolean)}
            >
              <RefreshCw className={`h-4 w-4 ${Object.values(maLoading).some(Boolean) ? 'animate-spin' : ''}`} />
              刷新均线
            </button>
          </div>
        )}
      </div>

      {/* 股票列表 */}
      <div className="grid gap-3">
        {filteredPositions.map(position => {
          const plan = getRebuyPlan(position.id)
          const enabled = plan?.enabled ?? false
          const realizedProfit = calculateRealizedProfit(position.transactions)
          const totalBuyAmount = position.totalBuyAmount || 0

          return (
            <div key={position.id}>
              {/* 默认列表行 */}
              {!enabled && (
                <div className="flex items-center justify-between px-4 py-3 rounded-xl border bg-card hover:bg-surface-hover/50 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-2 rounded-full bg-gray-300" />
                    <div>
                      <span className="font-medium">{position.name}</span>
                      <span className="text-xs text-muted-foreground ml-2 font-mono">{position.symbol}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-sm text-muted-foreground">
                      利润 <span className={cn('font-mono font-medium', realizedProfit >= 0 ? 'text-up' : 'text-down')}>{formatCurrency(realizedProfit)}</span>
                      {' / '}
                      原投入 <span className="font-mono font-medium">{formatCurrency(totalBuyAmount)}</span>
                    </span>
                    <button
                      onClick={() => toggleEnabled(position, true)}
                      className="px-3 py-1.5 text-xs font-medium rounded-lg border text-muted-foreground hover:bg-surface-hover hover:text-foreground transition-colors"
                    >
                      启用回购
                    </button>
                  </div>
                </div>
              )}

              {/* 启用后的完整卡片 */}
              {enabled && (
                <RebuyCard
                  position={position}
                  effPos={getEffectivePosition(position)}
                  ma60Data={ma60Data}
                  ma120Data={ma120Data}
                  ma250Data={ma250Data}
                  ma500Data={ma500Data}
                  ma1000Data={ma1000Data}
                  maLoading={maLoading}
                  scoreData={scoreData}
                  scoreLoading={scoreLoading}
                  expandedConfig={expandedConfig}
                  editBudget={editBudget}
                  editMa60={editMa60}
                  sharesInput={sharesInput}
                  getEffectiveMa60={getEffectiveMa60}
                  toggleEnabled={toggleEnabled}
                  saveBudget={saveBudget}
                  saveManualMa60={saveManualMa60}
                  doFetchAllMA={doFetchAllMA}
                  doCalculateScore={doCalculateScore}
                  handleSharesChange={handleSharesChange}
                  setExpandedConfig={setExpandedConfig}
                  setEditBudget={setEditBudget}
                  setEditMa60={setEditMa60}
                />
              )}
            </div>
          )
        })}
      </div>

      {/* 评分说明 */}
      {enabledCount > 0 && (
        <div className="rounded-xl border bg-card p-4">
          <h4 className="font-medium mb-2">评分机制</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm text-muted-foreground">
            <div>
              <p className="font-medium text-foreground mb-1">四维度评分（满分100）</p>
              <ul className="space-y-0.5 list-disc pl-4">
                <li><span className="text-foreground">安全垫分</span>（20%权重）：已实现利润 / 原投入</li>
                <li><span className="text-foreground">趋势分</span>（20%权重）：价格相对 MA60/MA120/MA250/MA500/MA1000 的位置</li>
                <li><span className="text-foreground">价值分</span>（40%权重）：历史回撤分位数（越高越值）</li>
                <li><span className="text-foreground">时间分</span>（20%权重）：距上次卖出的天数</li>
              </ul>
            </div>
            <div>
              <p className="font-medium text-foreground mb-1">评级与动态批次</p>
              <ul className="space-y-0.5 list-disc pl-4">
                <li>0-20分：禁止回购</li>
                <li>20-40分：继续观察</li>
                <li>40-60分：轻仓回购</li>
                <li>60-80分：分批回购</li>
                <li>80-100分：积极回购</li>
              </ul>
              <p className="mt-2">安全垫率越高，资金分配越激进（保守→积极）</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// 单张回购卡片
interface RebuyCardProps {
  position: Position
  effPos: Position
  ma60Data: Record<string, { value: number; source: 'api' | 'manual' } | null>
  ma120Data: Record<string, number | null>
  ma250Data: Record<string, number | null>
  ma500Data: Record<string, number | null>
  ma1000Data: Record<string, number | null>
  maLoading: Record<string, boolean>
  scoreData: Record<string, RebuyScoreData | null>
  scoreLoading: Record<string, boolean>
  expandedConfig: Record<string, boolean>
  editBudget: Record<string, string>
  editMa60: Record<string, string>
  sharesInput: Record<string, string>
  getEffectiveMa60: (posId: string) => number | null
  toggleEnabled: (position: Position, enabled: boolean) => void
  saveBudget: (position: Position, budget: number) => void
  saveManualMa60: (position: Position, ma60: number | null) => void
  doFetchAllMA: (position: Position) => void
  doCalculateScore: (position: Position) => void
  handleSharesChange: (posId: string, value: string) => void
  setExpandedConfig: React.Dispatch<React.SetStateAction<Record<string, boolean>>>
  setEditBudget: React.Dispatch<React.SetStateAction<Record<string, string>>>
  setEditMa60: React.Dispatch<React.SetStateAction<Record<string, string>>>
}

function RebuyCard({
  position,
  effPos,
  ma60Data,
  ma120Data,
  ma250Data,
  ma500Data,
  ma1000Data,
  maLoading,
  scoreData,
  scoreLoading,
  expandedConfig,
  editBudget,
  editMa60,
  sharesInput,
  getEffectiveMa60,
  toggleEnabled,
  saveBudget,
  saveManualMa60,
  doFetchAllMA,
  handleSharesChange,
  setExpandedConfig,
  setEditBudget,
  setEditMa60,
}: RebuyCardProps) {
  const plan = getRebuyPlan(position.id)
  const effectiveMa60 = getEffectiveMa60(position.id)
  const isLoading = maLoading[position.id]
  const realizedProfit = calculateRealizedProfit(position.transactions)
  const cushion = calculateSafetyCushion(position)
  const basePrice = getRebuyBasePrice(position)
  const isCleared = position.quantity === 0
  const isConfigExpanded = expandedConfig[position.id] ?? false
  const budgetEditing = editBudget[position.id] ?? ''
  const ma60Editing = editMa60[position.id] ?? ''
  const score = scoreData[position.id]
  const isScoreLoading = scoreLoading[position.id]

  const sharesStr = sharesInput[position.id] ?? ''
  const shares = parseInt(sharesStr) || 0
  const validShares = shares >= 100 ? Math.floor(shares / 100) * 100 : 0

  const simulations = useMemo(() => {
    if (validShares <= 0) return []
    return simulateBatchRebuy(effPos, validShares)
  }, [effPos, validShares])

  // 评分颜色
  const getScoreColor = (s: number) => {
    if (s <= 20) return 'text-gray-400'
    if (s <= 40) return 'text-yellow-500'
    if (s <= 60) return 'text-blue-500'
    if (s <= 80) return 'text-orange-500'
    return 'text-red-500'
  }

  const getScoreBg = (s: number) => {
    if (s <= 20) return 'bg-gray-400'
    if (s <= 40) return 'bg-yellow-500'
    if (s <= 60) return 'bg-blue-500'
    if (s <= 80) return 'bg-orange-500'
    return 'bg-red-500'
  }

  const getRatingBadge = (rating: string) => {
    const map: Record<string, string> = {
      '禁止回购': 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
      '继续观察': 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
      '轻仓回购': 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
      '分批回购': 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
      '积极回购': 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    }
    return map[rating] || ''
  }

  return (
    <div className={cn('rounded-xl border bg-card transition-all duration-200 shadow-sm')}>
      {/* 卡片头部 */}
      <div className="p-4 flex items-center justify-between border-b">
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-green-400" />
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold">{position.name}</h3>
              {isCleared && (
                <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">已清仓</span>
              )}
            </div>
            <span className="text-xs text-muted-foreground font-mono">{position.symbol}</span>
          </div>
        </div>
        <button
          onClick={() => toggleEnabled(position, false)}
          className="px-3 py-1.5 text-xs font-medium rounded-lg border bg-primary text-primary-foreground border-primary hover:opacity-90 transition-colors"
        >
          已启用
        </button>
      </div>

      {/* 主体内容 */}
      <div className="p-4 space-y-4">
        {/* 评分进度条 + 评级 */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">综合评分</span>
            {score && (
              <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', getRatingBadge(score.rating))}>
                {score.rating}
              </span>
            )}
          </div>
          <div className="relative h-6 bg-muted/30 rounded-full overflow-hidden">
            <div
              className={cn('h-full rounded-full transition-all duration-500', getScoreBg(score?.total || 0))}
              style={{ width: `${score?.total || 0}%` }}
            />
            <div className="absolute inset-0 flex items-center justify-center">
              <span className={cn('text-sm font-bold font-mono', score?.total ? getScoreColor(score.total) : 'text-muted-foreground')}>
                {isScoreLoading ? '计算中...' : score ? `${score.total}分` : '—'}
              </span>
            </div>
          </div>
        </div>

        {/* 四维度子评分 */}
        {score && (
          <div className="grid grid-cols-2 gap-3">
            <SubScore label={cushion >= 0 ? '安全垫' : '累计亏损'} value={score.safetyPadScore} suffix={`总安全垫${formatCurrency(cushion)}`} />
            <SubScore label="趋势" value={score.trendScore} suffix={`MA60 ${effectiveMa60 ? formatCurrency(effectiveMa60) : '—'}`} />
            <SubScore label="价值" value={score.valueScore} suffix="回撤分位" />
            <SubScore label="时间" value={score.timeScore} suffix="距卖出天数" />
          </div>
        )}

        {/* 关键指标 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricCard label="现价" value={formatCurrency(effPos.currentPrice)} className={effPos.changePercent >= 0 ? 'text-red-500' : 'text-green-500'} />
          <MetricCard label="MA60" value={isLoading ? '获取中...' : effectiveMa60 ? formatCurrency(effectiveMa60) : '未获取'} sub={effectiveMa60 !== null ? (ma60Data[position.id]?.source === 'manual' ? '手动' : '自动') : ''} className={effectiveMa60 !== null && effPos.currentPrice < effectiveMa60 ? 'text-purple-500' : ''} />
          <MetricCard label={cushion >= 0 ? '安全垫厚度' : '累计亏损率'} value={position.totalBuyAmount ? `${((cushion / position.totalBuyAmount) * 100).toFixed(1)}%` : '—'} sub={`总安全垫${formatCurrency(cushion)} / 原投入${formatCurrency(position.totalBuyAmount || 0)}${!isCleared && cushion > realizedProfit ? `（含浮动${formatCurrency(cushion - realizedProfit)}）` : ''}`} className={cushion >= 0 ? 'text-up' : 'text-down'} />
          <MetricCard label={isCleared ? '最近卖出价' : '持仓成本价'} value={basePrice ? formatCurrency(basePrice) : '暂无'} sub={basePrice ? `距基准 ${(((effPos.currentPrice - basePrice) / basePrice) * 100).toFixed(1)}%` : ''} className={basePrice && effPos.currentPrice < basePrice ? 'text-green-500' : ''} />
        </div>

        {/* 均线 + 回撤信息 */}
        <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
          <span>MA60: <span className="font-mono font-medium">{effectiveMa60 ? formatCurrency(effectiveMa60) : '—'}</span></span>
          <span>MA120: <span className="font-mono font-medium">{ma120Data[position.id] ? formatCurrency(ma120Data[position.id]!) : '—'}</span></span>
          <span>MA250: <span className="font-mono font-medium">{ma250Data[position.id] ? formatCurrency(ma250Data[position.id]!) : '—'}</span></span>
          <span>MA500: <span className="font-mono font-medium">{ma500Data[position.id] ? formatCurrency(ma500Data[position.id]!) : '—'}</span></span>
          <span>MA1000: <span className="font-mono font-medium">{ma1000Data[position.id] ? formatCurrency(ma1000Data[position.id]!) : '—'}</span></span>
          {score && (
            <>
              <span>回撤分位: <span className="font-mono font-medium">{score.valueScore}%</span></span>
              <span>历史最高: <span className="font-mono font-medium">—</span></span>
            </>
          )}
        </div>

        {/* 累计亏损警告 */}
        {cushion < 0 && (
          <div className="rounded-lg p-3 border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950">
            <div className="flex items-center gap-2 text-red-700 dark:text-red-400">
              <AlertTriangle className="h-4 w-4" />
              <span className="text-sm font-medium">总安全垫为负 {formatCurrency(cushion)}，买入后真实成本将高于买入价</span>
            </div>
          </div>
        )}

        {/* MA60 缺失警告 */}
        {!effectiveMa60 && !isLoading && (
          <div className="rounded-lg p-3 border border-yellow-200 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-950">
            <div className="flex items-center gap-2 text-yellow-700 dark:text-yellow-400">
              <AlertTriangle className="h-4 w-4" />
              <span className="text-sm font-medium">MA60 数据未获取，请点击"刷新均线"或在配置中输入手动值</span>
            </div>
          </div>
        )}

        {/* 股数输入 + 批次模拟 */}
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium whitespace-nowrap">我想买回</span>
            <input
              type="text"
              inputMode="numeric"
              value={sharesStr}
              onChange={e => handleSharesChange(position.id, e.target.value)}
              placeholder="输入股数"
              className="w-32 px-3 py-2 text-sm rounded-lg border bg-background text-center font-mono tabular-nums"
            />
            <span className="text-sm text-muted-foreground whitespace-nowrap">股（最多10,000股，步长100）</span>
            {sharesStr && validShares <= 0 && <span className="text-xs text-orange-500">最少100股</span>}
          </div>

          {/* 买入模拟 — 卡片分栏 */}
          {validShares > 0 && simulations.length > 0 && (() => {
            const sim = simulations[0]
            const downScenarios = [
              { label: '跌5%', price: sim.buyPrice * 0.95, profit: sim.profitDown5 },
              { label: '跌10%', price: sim.buyPrice * 0.90, profit: sim.profitDown10 },
              { label: '跌15%', price: sim.buyPrice * 0.85, profit: sim.profitDown15 },
            ]
            const upScenarios = [
              { label: '涨回现价', price: sim.buyPrice, profit: sim.profitBackToCurrent },
              { label: '涨1%', price: sim.buyPrice * 1.01, profit: sim.profitUp1 },
              { label: '涨5%', price: sim.buyPrice * 1.05, profit: sim.profitUp5 },
              { label: '涨10%', price: sim.buyPrice * 1.10, profit: sim.profitUp10 },
            ]

            return (
              <div className="rounded-lg border">
                <div className="bg-muted/50 px-3 py-2 border-b">
                  <span className="text-sm font-medium">买入模拟（{validShares} 股）</span>
                </div>
                <div className="p-3 space-y-3">
                  {/* 基础信息 */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="rounded-md bg-muted/20 px-3 py-2">
                      <div className="text-xs text-muted-foreground">买入价</div>
                      <div className="text-sm font-mono font-semibold">{formatCurrency(sim.buyPrice)}</div>
                    </div>
                    <div className="rounded-md bg-muted/20 px-3 py-2">
                      <div className="text-xs text-muted-foreground">投入金额</div>
                      <div className="text-sm font-mono font-semibold">{formatCurrency(sim.investAmount)}</div>
                    </div>
                    <div className="rounded-md bg-muted/20 px-3 py-2">
                      <div className="text-xs text-muted-foreground">真实成本单价</div>
                      <div className={cn('text-sm font-mono font-semibold', sim.realCostPerShare < 0 ? 'text-up' : sim.realCostPerShare > sim.buyPrice ? 'text-down' : '')}>
                        {sim.realCostPerShare < 0 ? '负成本（稳赚）' : formatCurrency(sim.realCostPerShare)}
                      </div>
                    </div>
                    <div className="rounded-md bg-muted/20 px-3 py-2">
                      <div className="text-xs text-muted-foreground">可承受跌幅</div>
                      <div className={cn('text-sm font-mono font-semibold', sim.realCostPerShare < 0 || sim.tolerableDrop <= 0 ? 'text-muted-foreground' : 'text-green-500')}>
                        {sim.realCostPerShare < 0 ? '—' : sim.tolerableDrop <= 0 ? '无安全边际' : `${sim.tolerableDrop}%`}
                      </div>
                    </div>
                  </div>

                  {/* 下跌 & 反弹 并列 */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <div className="text-xs font-medium text-muted-foreground mb-1.5">⛔ 下跌时安全垫的作用</div>
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b text-xs text-muted-foreground">
                            <th className="text-left py-1.5 font-medium">情景</th>
                            <th className="text-right py-1.5 font-medium">价格</th>
                            <th className="text-right py-1.5 font-medium">盈亏</th>
                          </tr>
                        </thead>
                        <tbody>
                          {downScenarios.map((ds, i) => (
                            <tr key={i} className="border-b last:border-b-0">
                              <td className="py-2 font-mono">{ds.label}</td>
                              <td className="text-right py-2 font-mono tabular-nums text-muted-foreground">{formatCurrency(ds.price)}</td>
                              <td className={cn('text-right py-2 font-mono tabular-nums font-medium', ds.profit >= 0 ? 'text-up' : 'text-down')}>
                                {ds.profit >= 0 ? '+' : ''}{formatCurrency(ds.profit)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div>
                      <div className="text-xs font-medium text-muted-foreground mb-1.5">📈 反弹时收益预测</div>
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b text-xs text-muted-foreground">
                            <th className="text-left py-1.5 font-medium">情景</th>
                            <th className="text-right py-1.5 font-medium">价格</th>
                            <th className="text-right py-1.5 font-medium">盈亏</th>
                          </tr>
                        </thead>
                        <tbody>
                          {upScenarios.map((us, i) => (
                            <tr key={i} className="border-b last:border-b-0">
                              <td className="py-2 font-mono">{us.label}</td>
                              <td className="text-right py-2 font-mono tabular-nums text-muted-foreground">{formatCurrency(us.price)}</td>
                              <td className={cn('text-right py-2 font-mono tabular-nums font-medium', us.profit >= 0 ? 'text-up' : 'text-down')}>
                                {us.profit >= 0 ? '+' : ''}{formatCurrency(us.profit)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            )
          })()}
        </div>

        {/* 配置面板 */}
        <div>
          <button onClick={() => setExpandedConfig(prev => ({ ...prev, [position.id]: !prev[position.id] }))} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
            {isConfigExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            配置
          </button>
          {isConfigExpanded && (
            <div className="mt-3 p-4 rounded-lg border bg-muted/30 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">回购预算</span>
                <div className="flex items-center gap-2">
                  {budgetEditing ? (
                    <>
                      <input type="number" value={budgetEditing} onChange={e => setEditBudget(prev => ({ ...prev, [position.id]: e.target.value }))} className="w-28 px-2 py-1 text-sm rounded border bg-background text-right font-mono" placeholder={plan?.totalBudget?.toString()} autoFocus />
                      <button onClick={() => { const val = parseFloat(budgetEditing); if (!isNaN(val) && val > 0) saveBudget(position, val) }} className="p-1 rounded hover:bg-surface-hover text-green-500"><Check className="h-4 w-4" /></button>
                      <button onClick={() => setEditBudget(prev => ({ ...prev, [position.id]: '' }))} className="p-1 rounded hover:bg-surface-hover text-muted-foreground"><X className="h-4 w-4" /></button>
                    </>
                  ) : (
                    <>
                      <span className="text-sm font-mono">{plan ? formatCurrency(plan.totalBudget) : '未设置'}</span>
                      <button onClick={() => setEditBudget(prev => ({ ...prev, [position.id]: (plan?.totalBudget || 10000).toString() }))} className="p-1 rounded hover:bg-surface-hover text-muted-foreground"><Wallet className="h-4 w-4" /></button>
                    </>
                  )}
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">MA60（手动覆盖）</span>
                <div className="flex items-center gap-2">
                  {ma60Editing ? (
                    <>
                      <input type="number" step="0.01" value={ma60Editing} onChange={e => setEditMa60(prev => ({ ...prev, [position.id]: e.target.value }))} className="w-28 px-2 py-1 text-sm rounded border bg-background text-right font-mono" placeholder={plan?.manualMa60?.toString()} autoFocus />
                      <button onClick={() => { const val = parseFloat(ma60Editing); if (!isNaN(val) && val > 0) saveManualMa60(position, val) }} className="p-1 rounded hover:bg-surface-hover text-green-500"><Check className="h-4 w-4" /></button>
                      <button onClick={() => setEditMa60(prev => ({ ...prev, [position.id]: '' }))} className="p-1 rounded hover:bg-surface-hover text-muted-foreground"><X className="h-4 w-4" /></button>
                    </>
                  ) : (
                    <>
                      <span className="text-sm font-mono">{plan?.manualMa60 ? formatCurrency(plan.manualMa60) : '未设置'}</span>
                      <button onClick={() => setEditMa60(prev => ({ ...prev, [position.id]: (plan?.manualMa60 || effectiveMa60 || '').toString() }))} className="p-1 rounded hover:bg-surface-hover text-muted-foreground"><TrendingDown className="h-4 w-4" /></button>
                      {plan?.manualMa60 && (
                        <button onClick={() => saveManualMa60(position, null)} className="p-1 rounded hover:bg-surface-hover text-muted-foreground" title="清除手动值"><RotateCcw className="h-4 w-4" /></button>
                      )}
                    </>
                  )}
                </div>
              </div>
              {!plan?.manualMa60 && (
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">MA60（自动获取）</span>
                  <button onClick={() => doFetchAllMA(position)} disabled={maLoading[position.id]} className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded border hover:bg-surface-hover transition-colors">
                    {maLoading[position.id] ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                    更新均线
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// 子评分组件
function SubScore({ label, value, suffix }: { label: string; value: number; suffix: string }) {
  const getColor = (v: number) => {
    if (v <= 20) return 'bg-gray-400'
    if (v <= 40) return 'bg-yellow-500'
    if (v <= 60) return 'bg-blue-500'
    if (v <= 80) return 'bg-orange-500'
    return 'bg-red-500'
  }
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono font-medium">{value}分</span>
      </div>
      <div className="h-2 bg-muted/30 rounded-full overflow-hidden">
        <div className={cn('h-full rounded-full transition-all duration-500', getColor(value))} style={{ width: `${value}%` }} />
      </div>
      <div className="text-xs text-muted-foreground truncate">{suffix}</div>
    </div>
  )
}

// 指标卡片子组件
function MetricCard({ label, value, sub, className }: { label: string; value: string; sub?: string; className?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground truncate">{label}</p>
      <p className={cn('text-base font-semibold font-mono tabular-nums truncate', className)}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground truncate mt-0.5">{sub}</p>}
    </div>
  )
}
