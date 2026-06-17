import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { flushSync } from 'react-dom'
import {
  RefreshCw, Shield,
  Loader2, ChevronDown, ChevronUp,
  AlertTriangle, Sparkles,
} from 'lucide-react'
import type { Position, RebuyPlan, RebuyScoreData } from '../../types'
import { calculateRealizedProfit, calculateSafetyCushion, getRebuyBasePrice, simulateBatchRebuy } from '../../services/rebuyService'
import { calculateRebuyScore } from '../../services/rebuyScoreService'
import {
  getRebuyPlan, saveRebuyPlan,
} from '../../services/rebuyStorageService'
import { fetchAllMA, getCachedMA, getStockQuote } from '../../services/stockService'
import { formatCurrency, cn } from '../../lib/utils'
import { collectRebuyAIData, analyzeRebuyPlansStream } from '../../services/rebuyAIService'
import { getAiConfig } from '../../services/aiService'
import { RebuyAIDialog } from './RebuyAIDialog'

interface RebuyDashboardProps {
  positions: Position[]
  mode: 'rebuy' | 'add'
}

export function RebuyDashboard({ positions, mode }: RebuyDashboardProps) {
  const isRebuy = mode === 'rebuy'
  const filteredPositions = useMemo(() => positions.filter(p =>
    p.transactions.length > 0 && (isRebuy ? p.quantity === 0 : p.quantity > 0)
  ), [positions, isRebuy])

  const [ma60Data, setMa60Data] = useState<Record<string, { value: number; source: 'api' } | null>>({})
  const [ma120Data, setMa120Data] = useState<Record<string, number | null>>({})
  const [ma250Data, setMa250Data] = useState<Record<string, number | null>>({})
  const [ma500Data, setMa500Data] = useState<Record<string, number | null>>({})
  const [maLoading, setMaLoading] = useState<Record<string, boolean>>({})
  const [localPrices, setLocalPrices] = useState<Record<string, number>>({})
  const [priceLoading, setPriceLoading] = useState(false)
  const [expandedCards, setExpandedCards] = useState<Record<string, boolean>>({})
  const [sharesInput, setSharesInput] = useState<Record<string, string>>({})
  const [scoreData, setScoreData] = useState<Record<string, RebuyScoreData | null>>({})
  const [scoreLoading, setScoreLoading] = useState<Record<string, boolean>>({})

  // AI 分析状态
  const [aiDialogOpen, setAiDialogOpen] = useState(false)
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null)
  const [aiAnalysisTime, setAiAnalysisTime] = useState<string | null>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)

  // 检查某只股票是否有缓存分析
  const hasCachedAnalysis = useCallback((positionId: string) => {
    return !!localStorage.getItem(`rebuy-ai-analysis-${positionId}`)
  }, [])

  // 检查是否有批量缓存分析
  const hasBatchCachedAnalysis = useCallback(() => {
    return !!localStorage.getItem('rebuy-ai-analysis-batch')
  }, [])

  // 从缓存加载分析结果到弹窗
  const loadCachedAnalysis = useCallback((cacheKey: string) => {
    try {
      const cached = localStorage.getItem(cacheKey)
      if (cached) {
        const { text, time } = JSON.parse(cached)
        if (text) {
          setAiAnalysis(text)
          setAiAnalysisTime(time)
          return true
        }
      }
    } catch {
      // 忽略解析错误
    }
    return false
  }, [])

  // 使用 ref 跟踪已初始化的股票 ID，避免无限循环
  const initializedIdsRef = useRef<Set<string>>(new Set())
  
  useEffect(() => {
    filteredPositions.forEach(p => {
      // 如果这个股票已经初始化过，跳过
      if (initializedIdsRef.current.has(p.id)) return
      
      const plan = getRebuyPlan(p.id)
      if (!plan?.enabled) return
      const cached = getCachedMA(p.symbol)
      if (!cached) return
      
      // 标记为已初始化
      initializedIdsRef.current.add(p.id)
      
      setMa60Data(prev => {
        const newValue = cached.ma60 !== null ? { value: cached.ma60, source: 'api' as const } : null
        if (prev[p.id]?.value === newValue?.value) return prev
        return { ...prev, [p.id]: newValue }
      })
      setMa120Data(prev => {
        if (prev[p.id] === cached.ma120) return prev
        return { ...prev, [p.id]: cached.ma120 }
      })
      setMa250Data(prev => {
        if (prev[p.id] === cached.ma250) return prev
        return { ...prev, [p.id]: cached.ma250 }
      })
      setMa500Data(prev => {
        if (prev[p.id] === cached.ma500) return prev
        return { ...prev, [p.id]: cached.ma500 }
      })
    })
  }, [filteredPositions])

  const doFetchAllMA = useCallback(async (position: Position) => {
    const posId = position.id
    setMaLoading(prev => ({ ...prev, [posId]: true }))
    const allMA = await fetchAllMA(position.symbol)
    setMa60Data(prev => ({ ...prev, [posId]: allMA.ma60 !== null ? { value: allMA.ma60, source: 'api' } : null }))
    setMa120Data(prev => ({ ...prev, [posId]: allMA.ma120 }))
    setMa250Data(prev => ({ ...prev, [posId]: allMA.ma250 }))
    setMa500Data(prev => ({ ...prev, [posId]: allMA.ma500 }))
    setMaLoading(prev => ({ ...prev, [posId]: false }))
    const plan = getRebuyPlan(posId)
    if (plan?.enabled) {
      setScoreLoading(prev => ({ ...prev, [posId]: true }))
      const score = await calculateRebuyScore(
        position, plan,
        allMA.ma60, allMA.ma120, allMA.ma250, allMA.ma500, null
      )
      setScoreData(prev => ({ ...prev, [posId]: score }))
      setScoreLoading(prev => ({ ...prev, [posId]: false }))
    }
  }, [])

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
    for (const p of targets) {
      doFetchAllMA(p)
    }
  }, [filteredPositions, doFetchAllMA])

  const toggleEnabled = useCallback((position: Position, enabled: boolean) => {
    const existing = getRebuyPlan(position.id)
    if (enabled) {
      const plan: RebuyPlan = existing || {
        totalBudget: 10000,
        batchesExecuted: 0,
        enabled: true,
      }
      saveRebuyPlan(position.id, { ...plan, enabled: true })
      doFetchAllMA(position)
      setExpandedCards(prev => ({ ...prev, [position.id]: false }))
    } else {
      if (existing) {
        saveRebuyPlan(position.id, { ...existing, enabled: false })
      }
      setScoreData(prev => ({ ...prev, [position.id]: null }))
      setExpandedCards(prev => ({ ...prev, [position.id]: false }))
    }
  }, [doFetchAllMA])

  const handleSharesChange = useCallback((posId: string, value: string) => {
    const cleaned = value.replace(/[^0-9]/g, '')
    setSharesInput(prev => ({ ...prev, [posId]: cleaned }))
  }, [])

  // AI 分析处理函数（批量）
  const handleAIAnalysis = useCallback(async () => {
    const { endpoint, apiKey, isConfigured } = getAiConfig()
    if (!isConfigured) {
      alert('请先在设置中配置 AI 服务')
      return
    }

    setAiDialogOpen(true)
    setAiLoading(true)
    setAiError(null)
    setAiAnalysis(null)
    setAiAnalysisTime(null)

    try {
      // 收集数据
      const rebuyPlans: Record<string, RebuyPlan> = {}
      const maData: Record<string, { ma60: number; ma120: number; ma250: number; ma500: number }> = {}

      for (const p of filteredPositions) {
        const plan = getRebuyPlan(p.id)
        if (plan?.enabled) {
          rebuyPlans[p.id] = plan
          maData[p.id] = {
            ma60: ma60Data[p.id]?.value || 0,
            ma120: ma120Data[p.id] || 0,
            ma250: ma250Data[p.id] || 0,
            ma500: ma500Data[p.id] || 0,
          }
        }
      }

      const data = collectRebuyAIData(filteredPositions, rebuyPlans, scoreData as Record<string, RebuyScoreData>, maData)
      const result = await analyzeRebuyPlansStream(data, endpoint, apiKey, (text) => {
        flushSync(() => {
          setAiAnalysis(text)
        })
      })
      const time = new Date().toLocaleString('zh-CN')
      setAiAnalysis(result)
      setAiAnalysisTime(time)
      // 持久化保存 - 批量分析用 batch key
      localStorage.setItem('rebuy-ai-analysis-batch', JSON.stringify({ text: result, time }))
    } catch (error) {
      console.error('AI 分析失败:', error)
      setAiError(error instanceof Error ? error.message : '分析失败，请稍后重试')
    } finally {
      setAiLoading(false)
    }
  }, [filteredPositions, ma60Data, ma120Data, ma250Data, ma500Data, scoreData])

  // AI 分析处理函数（单只股票）
  const handleSingleStockAIAnalysis = useCallback(async (position: Position) => {
    const { endpoint, apiKey, isConfigured } = getAiConfig()
    if (!isConfigured) {
      alert('请先在设置中配置 AI 服务')
      return
    }

    setAiDialogOpen(true)
    setAiLoading(true)
    setAiError(null)
    setAiAnalysis(null)
    setAiAnalysisTime(null)

    try {
      const rebuyPlans: Record<string, RebuyPlan> = {}
      const maData: Record<string, { ma60: number; ma120: number; ma250: number; ma500: number }> = {}

      const plan = getRebuyPlan(position.id)
      if (plan?.enabled) {
        rebuyPlans[position.id] = plan
        maData[position.id] = {
          ma60: ma60Data[position.id]?.value || 0,
          ma120: ma120Data[position.id] || 0,
          ma250: ma250Data[position.id] || 0,
          ma500: ma500Data[position.id] || 0,
        }
      }

      const data = collectRebuyAIData([position], rebuyPlans, scoreData as Record<string, RebuyScoreData>, maData)
      const result = await analyzeRebuyPlansStream(data, endpoint, apiKey, (text) => {
        flushSync(() => {
          setAiAnalysis(text)
        })
      })
      const time = new Date().toLocaleString('zh-CN')
      setAiAnalysis(result)
      setAiAnalysisTime(time)
      // 持久化保存 - 单只股票用 positionId 区分
      localStorage.setItem(`rebuy-ai-analysis-${position.id}`, JSON.stringify({ text: result, time }))
    } catch (error) {
      console.error('AI 分析失败:', error)
      setAiError(error instanceof Error ? error.message : '分析失败，请稍后重试')
    } finally {
      setAiLoading(false)
    }
  }, [ma60Data, ma120Data, ma250Data, ma500Data, scoreData])

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
              onClick={() => {
                if (hasBatchCachedAnalysis() && !aiLoading) {
                  loadCachedAnalysis('rebuy-ai-analysis-batch')
                  setAiDialogOpen(true)
                } else {
                  handleAIAnalysis()
                }
              }}
              className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border border-primary/50 text-primary bg-primary/5 hover:bg-primary/10 transition-colors"
              disabled={aiLoading}
            >
              <Sparkles className={`h-4 w-4 ${aiLoading ? 'animate-pulse' : ''}`} />
              {hasBatchCachedAnalysis() && !aiLoading ? '查看分析' : 'AI 智能分析'}
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

      <div className="grid gap-3">
        {filteredPositions.map(position => {
          const plan = getRebuyPlan(position.id)
          const enabled = plan?.enabled ?? false
          const realizedProfit = calculateRealizedProfit(position.transactions)
          const totalBuyAmount = position.totalBuyAmount || 0

          return (
            <div key={position.id}>
              {!enabled && (
                <div className="flex items-center justify-between px-4 py-3 rounded-xl border bg-card hover:bg-surface-hover/50 transition-colors border-l-4 border-l-muted">
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
                      onClick={() => doFetchAllMA(position)}
                      disabled={maLoading[position.id]}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg border text-muted-foreground hover:bg-surface-hover transition-colors"
                    >
                      {maLoading[position.id] ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                      更新均线
                    </button>
                    <button
                      onClick={() => toggleEnabled(position, true)}
                      className="px-3 py-1.5 text-xs font-medium rounded-lg border border-primary/50 text-primary bg-primary/5 hover:bg-primary/10 transition-colors"
                    >
                      启用回购
                    </button>
                  </div>
                </div>
              )}

              {enabled && (
                <RebuyCard
                  position={position}
                  effPos={getEffectivePosition(position)}
                  ma60Data={ma60Data}
                  ma120Data={ma120Data}
                  ma250Data={ma250Data}
                  ma500Data={ma500Data}
                  maLoading={maLoading}
                  scoreData={scoreData}
                  scoreLoading={scoreLoading}
                  sharesInput={sharesInput}
                  toggleEnabled={toggleEnabled}
                  doFetchAllMA={doFetchAllMA}
                  handleSharesChange={handleSharesChange}
                  isExpanded={expandedCards[position.id] ?? false}
                  onToggleExpand={() => setExpandedCards(prev => ({ ...prev, [position.id]: !prev[position.id] }))}
                  onSingleAIAnalysis={() => handleSingleStockAIAnalysis(position)}
                  hasAiAnalysis={hasCachedAnalysis(position.id)}
                  onViewAiAnalysis={() => {
                    loadCachedAnalysis(`rebuy-ai-analysis-${position.id}`)
                    setAiDialogOpen(true)
                  }}
                />
              )}
            </div>
          )
        })}
      </div>

      {enabledCount > 0 && (
        <div className="rounded-xl border bg-card p-5">
          <h4 className="font-medium mb-3">评分机制</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm text-muted-foreground">
            <div className="rounded-lg bg-muted/20 p-3 border border-muted/30">
              <p className="font-medium text-foreground mb-2">四维度评分（满分100）</p>
              <ul className="space-y-1 list-none">
                <li className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-gray-400 shrink-0" /><span className="text-foreground">安全垫分</span>（20%权重）：已实现利润 / 原投入</li>
                <li className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-blue-500 shrink-0" /><span className="text-foreground">趋势分</span>（20%权重）：价格相对 MA60/120/250/500/1000</li>
                <li className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" /><span className="text-foreground">价值分</span>（40%权重）：历史回撤分位数</li>
                <li className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-up shrink-0" /><span className="text-foreground">时间分</span>（20%权重）：距上次卖出的天数</li>
              </ul>
            </div>
            <div className="rounded-lg bg-muted/20 p-3 border border-muted/30">
              <p className="font-medium text-foreground mb-2">评级与动态批次</p>
              <ul className="space-y-1 list-none">
                <li className="flex items-center gap-2"><span className="px-1.5 py-0.5 rounded text-xs bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">0-20</span> 禁止回购</li>
                <li className="flex items-center gap-2"><span className="px-1.5 py-0.5 rounded text-xs bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">20-40</span> 继续观察</li>
                <li className="flex items-center gap-2"><span className="px-1.5 py-0.5 rounded text-xs bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">40-60</span> 轻仓回购</li>
                <li className="flex items-center gap-2"><span className="px-1.5 py-0.5 rounded text-xs bg-primary/10 text-primary">60-80</span> 分批回购</li>
                <li className="flex items-center gap-2"><span className="px-1.5 py-0.5 rounded text-xs bg-up/10 text-up">80-100</span> 积极回购</li>
              </ul>
              <p className="mt-2 text-xs">安全垫率越高，资金分配越激进（保守→积极）</p>
            </div>
          </div>
        </div>
      )}

      {/* AI 智能分析弹窗 */}
      <RebuyAIDialog
        open={aiDialogOpen}
        onClose={() => setAiDialogOpen(false)}
        analysis={aiAnalysis}
        loading={aiLoading}
        error={aiError}
        onRetry={handleAIAnalysis}
        analysisTime={aiAnalysisTime}
      />
    </div>
  )
}

interface RebuyCardProps {
  position: Position
  effPos: Position
  ma60Data: Record<string, { value: number; source: 'api' } | null>
  ma120Data: Record<string, number | null>
  ma250Data: Record<string, number | null>
  ma500Data: Record<string, number | null>
  maLoading: Record<string, boolean>
  scoreData: Record<string, RebuyScoreData | null>
  scoreLoading: Record<string, boolean>
  sharesInput: Record<string, string>
  toggleEnabled: (position: Position, enabled: boolean) => void
  doFetchAllMA: (position: Position) => Promise<void>
  handleSharesChange: (posId: string, value: string) => void
  isExpanded: boolean
  onToggleExpand: () => void
  onSingleAIAnalysis: () => void
  hasAiAnalysis: boolean
  onViewAiAnalysis: () => void
}

function RebuyCard({
  position,
  effPos,
  ma60Data,
  ma120Data,
  ma250Data,
  ma500Data,
  maLoading,
  scoreData,
  scoreLoading,
  sharesInput,
  toggleEnabled,
  doFetchAllMA,
  handleSharesChange,
  isExpanded,
  onToggleExpand,
  onSingleAIAnalysis,
  hasAiAnalysis,
  onViewAiAnalysis,
}: RebuyCardProps) {
  const effectiveMa60 = ma60Data[position.id]?.value ?? null
  const isLoading = maLoading[position.id]
  const cushion = calculateSafetyCushion(position)
  const basePrice = getRebuyBasePrice(position)
  const isCleared = position.quantity === 0
  const clearedShares = position.quantity > 0
    ? position.quantity
    : position.transactions.filter(t => t.type === 'sell').reduce((sum, t) => sum + t.quantity, 0)
  const unitDiff = basePrice ? effPos.currentPrice - basePrice : 0
  const totalDiff = unitDiff * clearedShares
  const score = scoreData[position.id]
  const isScoreLoading = scoreLoading[position.id]

  const sharesStr = sharesInput[position.id] ?? ''
  const shares = parseInt(sharesStr) || 0
  const validShares = shares >= 100 ? Math.floor(shares / 100) * 100 : 0

  const simulations = useMemo(() => {
    if (validShares <= 0) return []
    return simulateBatchRebuy(effPos, validShares)
  }, [effPos, validShares])

  const getScoreColor = (s: number) => {
    if (s <= 20) return 'text-gray-400'
    if (s <= 40) return 'text-amber-500'
    if (s <= 60) return 'text-blue-500'
    if (s <= 80) return 'text-primary'
    return 'text-up'
  }

  const getScoreBg = (s: number) => {
    if (s <= 20) return 'bg-gray-400'
    if (s <= 40) return 'bg-amber-500'
    if (s <= 60) return 'bg-blue-500'
    if (s <= 80) return 'bg-primary'
    return 'bg-up'
  }

  const getRatingBadge = (rating: string) => {
    const map: Record<string, string> = {
      '禁止回购': 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
      '继续观察': 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
      '轻仓回购': 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
      '分批回购': 'bg-primary/10 text-primary dark:bg-primary/20 dark:text-primary',
      '积极回购': 'bg-up/10 text-up dark:bg-up/20 dark:text-up',
    }
    return map[rating] || ''
  }

  return (
    <div className="rounded-xl border border-up/30 border-l-4 border-l-up bg-card transition-all duration-200 shadow-sm">
      {/* 可点击头部 - 点击切换展开/收起 */}
      {!isExpanded ? (
        <div className="cursor-pointer select-none rounded-t-xl" onClick={onToggleExpand}>
          {/* 第1行：股票名 + 关键数据 */}
          <div className="p-4 pb-1.5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 shrink-0">
              <div className="w-2 h-2 rounded-full bg-green-400" />
              <h3 className="font-semibold text-base">{position.name}</h3>
              {isCleared && (
                <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">已清仓</span>
              )}
            </div>
            <div className="flex items-center gap-3 text-sm min-w-0">
              <span className="whitespace-nowrap">
                现价 <span className={cn('font-mono font-semibold text-sm', effPos.changePercent >= 0 ? 'text-red-500' : 'text-green-500')}>{formatCurrency(effPos.currentPrice)}</span>
              </span>
              <span className="text-muted-foreground shrink-0">|</span>
              <span className="whitespace-nowrap">
                涨幅 <span className={cn('font-mono font-semibold text-sm', basePrice && effPos.currentPrice >= basePrice ? 'text-red-500' : 'text-green-500')}>{basePrice ? `${(((effPos.currentPrice - basePrice) / basePrice) * 100).toFixed(1)}%` : '—'}</span>
                {basePrice && (
                  <span className={cn('font-mono text-xs', effPos.currentPrice >= basePrice ? 'text-red-500' : 'text-green-500')}>
                    （单价差{formatCurrency(unitDiff)}，总价差{formatCurrency(totalDiff)}）
                  </span>
                )}
              </span>
              <span className="text-muted-foreground shrink-0">|</span>
              <span className="whitespace-nowrap">
                安全垫 <span className={cn('font-mono font-semibold text-sm', cushion >= 0 ? 'text-up' : 'text-down')}>
                  {position.totalBuyAmount ? `${((cushion / position.totalBuyAmount) * 100).toFixed(1)}%` : '—'}
                </span>
              </span>
              <span className="text-muted-foreground shrink-0">|</span>
              <span className="whitespace-nowrap">
                {isCleared ? '卖出' : '成本'} <span className="font-mono font-semibold text-sm">{basePrice ? formatCurrency(basePrice) : '—'}</span>
              </span>
              <span className="text-muted-foreground shrink-0">|</span>
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                总安全垫{formatCurrency(cushion)} / 原投入{formatCurrency(position.totalBuyAmount || 0)}
              </span>
            </div>
          </div>
          {/* 第2行：代码 + MA均线 + 按钮 */}
          <div className="px-4 pb-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 text-xs text-muted-foreground min-w-0">
              <span className="font-mono text-xs">{position.symbol}</span>
              <span className="text-muted-foreground">|</span>
              <span>MA60: <span className="font-mono font-medium">{isLoading ? '获取中...' : effectiveMa60 ? formatCurrency(effectiveMa60) : '—'}</span></span>
              <span>MA120: <span className="font-mono font-medium">{ma120Data[position.id] ? formatCurrency(ma120Data[position.id]!) : '—'}</span></span>
              <span>MA250: <span className="font-mono font-medium">{ma250Data[position.id] ? formatCurrency(ma250Data[position.id]!) : '—'}</span></span>
              <span>MA500: <span className="font-mono font-medium">{ma500Data[position.id] ? formatCurrency(ma500Data[position.id]!) : '—'}</span></span>
            </div>
            <div className="flex items-center gap-2 shrink-0" onClick={e => e.stopPropagation()}>
              <button
                onClick={hasAiAnalysis ? onViewAiAnalysis : onSingleAIAnalysis}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg border border-primary/50 text-primary bg-primary/5 hover:bg-primary/10 transition-colors"
              >
                <Sparkles className="h-3 w-3" />
                {hasAiAnalysis ? '查看分析' : 'AI 分析'}
              </button>
              <button
                onClick={() => doFetchAllMA(position)}
                disabled={isLoading}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg border text-muted-foreground hover:bg-surface-hover transition-colors"
              >
                {isLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                更新均线
              </button>
              <button
                onClick={() => toggleEnabled(position, false)}
                className="px-3 py-1.5 text-xs font-medium rounded-lg border bg-primary text-primary-foreground border-primary hover:opacity-90 transition-colors"
              >
                已启用
              </button>
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </div>
          </div>
        </div>
      ) : (
        <div
          className="p-4 flex items-center justify-between cursor-pointer select-none hover:bg-surface-hover/30 transition-colors rounded-t-xl"
          onClick={onToggleExpand}
        >
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
          <div className="flex items-center gap-2">
            <button
              onClick={e => { e.stopPropagation(); hasAiAnalysis ? onViewAiAnalysis() : onSingleAIAnalysis() }}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg border border-primary/50 text-primary bg-primary/5 hover:bg-primary/10 transition-colors"
            >
              <Sparkles className="h-3 w-3" />
              {hasAiAnalysis ? '查看分析' : 'AI 分析'}
            </button>
            <button
              onClick={e => { e.stopPropagation(); doFetchAllMA(position) }}
              disabled={isLoading}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg border text-muted-foreground hover:bg-surface-hover transition-colors"
            >
              {isLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              更新均线
            </button>
            <button
              onClick={e => { e.stopPropagation(); toggleEnabled(position, false) }}
              className="px-3 py-1.5 text-xs font-medium rounded-lg border bg-primary text-primary-foreground border-primary hover:opacity-90 transition-colors"
            >
              已启用
            </button>
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          </div>
        </div>
      )}


      {/* 展开状态 */ }
      {isExpanded && (
        <div className="p-4 space-y-4">
          {/* 上部：股数输入 */}
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
            <span className="text-sm text-muted-foreground whitespace-nowrap">股（步长100，最多10,000）</span>
            {sharesStr && validShares <= 0 && <span className="text-xs text-orange-500">最少100股</span>}
          </div>

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
            <MetricCard label="MA60" value={isLoading ? '获取中...' : effectiveMa60 ? formatCurrency(effectiveMa60) : '未获取'} sub={effectiveMa60 !== null ? '自动' : ''} className={effectiveMa60 !== null && effPos.currentPrice < effectiveMa60 ? 'text-purple-500' : ''} />
            <MetricCard label={cushion >= 0 ? '安全垫厚度' : '累计亏损率'} value={position.totalBuyAmount ? `${((cushion / position.totalBuyAmount) * 100).toFixed(1)}%` : '—'} sub={`总安全垫${formatCurrency(cushion)} / 原投入${formatCurrency(position.totalBuyAmount || 0)}${!isCleared && cushion > calculateRealizedProfit(position.transactions) ? `（含浮动${formatCurrency(cushion - calculateRealizedProfit(position.transactions))}）` : ''}`} className={cushion >= 0 ? 'text-up' : 'text-down'} />
            <MetricCard label={isCleared ? '最近卖出价' : '持仓成本价'} value={basePrice ? formatCurrency(basePrice) : '暂无'} sub={basePrice ? `${(((effPos.currentPrice - basePrice) / basePrice) * 100).toFixed(1)}%` : ''} />
          </div>

          {/* 均线详情 */}
          <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
            <span>MA60: <span className="font-mono font-medium">{effectiveMa60 ? formatCurrency(effectiveMa60) : '—'}</span></span>
            <span>MA120: <span className="font-mono font-medium">{ma120Data[position.id] ? formatCurrency(ma120Data[position.id]!) : '—'}</span></span>
            <span>MA250: <span className="font-mono font-medium">{ma250Data[position.id] ? formatCurrency(ma250Data[position.id]!) : '—'}</span></span>
            <span>MA500: <span className="font-mono font-medium">{ma500Data[position.id] ? formatCurrency(ma500Data[position.id]!) : '—'}</span></span>
            {score && (
              <>
                <span>回撤分位: <span className="font-mono font-medium">{score.valueScore}%</span></span>
                <span>历史最高: <span className="font-mono font-medium">—</span></span>
              </>
            )}
          </div>

          {/* 动态批次可视化 */}
          {score && score.dynamicBatch && score.dynamicBatch.length > 0 && (() => {
            const plan = getRebuyPlan(position.id)
            const budget = plan?.totalBudget || 0
            const batchLabels = ['保守', '适中', '积极']
            const batchColors = [
              { bg: 'bg-primary/10', border: 'border-primary/40', text: 'text-primary', bar: 'bg-primary/50' },
              { bg: 'bg-amber-500/10', border: 'border-amber-500/40', text: 'text-amber-600 dark:text-amber-400', bar: 'bg-amber-500/50' },
              { bg: 'bg-up/10', border: 'border-up/40', text: 'text-up', bar: 'bg-up/50' },
            ]
            return (
              <div className="rounded-lg border">
                <div className="bg-muted/50 px-3 py-2 border-b flex items-center justify-between">
                  <span className="text-sm font-medium">资金分配方案</span>
                  <span className="text-xs text-muted-foreground">总预算 {formatCurrency(budget)} | 安全垫率 {position.totalBuyAmount ? ((cushion / position.totalBuyAmount) * 100).toFixed(1) : '0'}%</span>
                </div>
                <div className="p-3 flex gap-3">
                  {score.dynamicBatch.map((batch, i) => {
                    const canExec = batch.canExecute
                    const colors = batchColors[i] || batchColors[0]
                    return (
                      <div
                        key={batch.batch}
                        className={cn(
                          'flex-1 rounded-lg border p-3 transition-all',
                          canExec ? `${colors.bg} ${colors.border}` : 'bg-muted/20 border-dashed border-muted-foreground/30 opacity-60'
                        )}
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <span className={cn('text-xs font-medium', canExec ? colors.text : 'text-muted-foreground')}>
                            {batchLabels[i]} {Math.round(batch.fundRatio * 100)}%
                          </span>
                          <span className="text-xs text-muted-foreground">≥{batch.triggerScore}分</span>
                        </div>
                        <div className="text-sm font-mono font-semibold mb-1">
                          {formatCurrency(batch.amount)}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          实付 {formatCurrency(batch.realCost)}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })()}

          {/* 累计亏损警告 */}
          {cushion < 0 && (
            <div className="rounded-lg p-3 border border-down/30 bg-down/5">
              <div className="flex items-center gap-2 text-down">
                <AlertTriangle className="h-4 w-4" />
                <span className="text-sm font-medium">总安全垫为负 {formatCurrency(cushion)}，买入后真实成本将高于买入价</span>
              </div>
            </div>
          )}

          {/* MA60 缺失警告 */}
          {!effectiveMa60 && !isLoading && (
            <div className="rounded-lg p-3 border border-amber-500/30 bg-amber-500/5">
              <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
                <AlertTriangle className="h-4 w-4" />
                <span className="text-sm font-medium">MA60 数据未获取，请点击上方"更新均线"按钮</span>
              </div>
            </div>
          )}

          {/* 买入模拟 */}
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
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="rounded-lg bg-muted/20 px-3 py-2 border border-muted/30">
                      <div className="text-xs text-muted-foreground">买入价</div>
                      <div className="text-sm font-mono font-semibold">{formatCurrency(sim.buyPrice)}</div>
                    </div>
                    <div className="rounded-lg bg-muted/20 px-3 py-2 border border-muted/30">
                      <div className="text-xs text-muted-foreground">投入金额</div>
                      <div className="text-sm font-mono font-semibold">{formatCurrency(sim.investAmount)}</div>
                    </div>
                    <div className="rounded-lg bg-muted/20 px-3 py-2 border border-muted/30">
                      <div className="text-xs text-muted-foreground">真实成本单价</div>
                      <div className={cn('text-sm font-mono font-semibold', sim.realCostPerShare < 0 ? 'text-up' : sim.realCostPerShare > sim.buyPrice ? 'text-down' : '')}>
                        {sim.realCostPerShare < 0 ? '负成本（稳赚）' : formatCurrency(sim.realCostPerShare)}
                      </div>
                    </div>
                    <div className={cn('rounded-lg px-3 py-2 border', sim.realCostPerShare >= 0 && sim.tolerableDrop > 0 ? 'bg-up/5 border-up/20' : 'bg-muted/20 border-muted/30')}>
                      <div className="text-xs text-muted-foreground">可承受跌幅</div>
                      <div className={cn('text-sm font-mono font-semibold', sim.realCostPerShare < 0 || sim.tolerableDrop <= 0 ? 'text-muted-foreground' : 'text-up')}>
                        {sim.realCostPerShare < 0 ? '—' : sim.tolerableDrop <= 0 ? '无安全边际' : `${sim.tolerableDrop}%`}
                      </div>
                    </div>
                  </div>

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
      )}
    </div>
  )
}

function SubScore({ label, value, suffix }: { label: string; value: number; suffix: string }) {
  const getColor = (v: number) => {
    if (v <= 20) return 'bg-gray-400'
    if (v <= 40) return 'bg-amber-500'
    if (v <= 60) return 'bg-blue-500'
    if (v <= 80) return 'bg-primary'
    return 'bg-up'
  }
  return (
    <div className="rounded-lg bg-muted/20 p-2.5 space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono font-medium">{value}分</span>
      </div>
      <div className="h-1.5 bg-muted/40 rounded-full overflow-hidden">
        <div className={cn('h-full rounded-full transition-all duration-500', getColor(value))} style={{ width: `${value}%` }} />
      </div>
      <div className="text-xs text-muted-foreground truncate">{suffix}</div>
    </div>
  )
}

function MetricCard({ label, value, sub, className }: { label: string; value: string; sub?: string; className?: string }) {
  return (
    <div className="min-w-0 rounded-lg border bg-card p-3">
      <p className="text-xs text-muted-foreground truncate">{label}</p>
      <p className={cn('text-base font-semibold font-mono tabular-nums truncate', className)}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground truncate mt-0.5">{sub}</p>}
    </div>
  )
}
