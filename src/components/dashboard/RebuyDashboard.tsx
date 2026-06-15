import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  RefreshCw, Shield, TrendingDown,
  RotateCcw, Loader2, ChevronDown, ChevronUp,
  Check, X, AlertTriangle, Wallet, Lightbulb, AlertCircle
} from 'lucide-react'
import type { Position, RebuyPlan } from '../../types'
import { calculateRealizedProfit, getRebuyBasePrice, simulateBatchRebuy } from '../../services/rebuyService'
import type { BatchSimulation } from '../../services/rebuyService'
import {
  getRebuyPlan, saveRebuyPlan,
} from '../../services/rebuyStorageService'
import { fetchMa60, getStockQuote } from '../../services/stockService'
import { formatCurrency, formatPercent, cn } from '../../lib/utils'

interface RebuyDashboardProps {
  positions: Position[]
}

export function RebuyDashboard({ positions }: RebuyDashboardProps) {
  const allPositions = positions.filter(p => p.transactions.length > 0)

  const [ma60Data, setMa60Data] = useState<Record<string, { value: number; source: 'api' | 'manual' } | null>>({})
  const [ma60Loading, setMa60Loading] = useState<Record<string, boolean>>({})
  const [localPrices, setLocalPrices] = useState<Record<string, number>>({})
  const [priceLoading, setPriceLoading] = useState(false)
  const [expandedConfig, setExpandedConfig] = useState<Record<string, boolean>>({})
  const [editBudget, setEditBudget] = useState<Record<string, string>>({})
  const [editMa60, setEditMa60] = useState<Record<string, string>>({})
  const [sharesInput, setSharesInput] = useState<Record<string, string>>({})
  const [useCurrentPrice, setUseCurrentPrice] = useState<Record<string, boolean>>({})

  // 获取有效MA60（手动覆盖优先）
  const getEffectiveMa60 = useCallback((posId: string): number | null => {
    const plan = getRebuyPlan(posId)
    if (plan?.manualMa60 && plan.manualMa60 > 0) return plan.manualMa60
    const fetched = ma60Data[posId]
    return fetched?.value ?? null
  }, [ma60Data])

  // 获取单只MA60
  const doFetchMa60 = useCallback(async (position: Position) => {
    const posId = position.id
    setMa60Loading(prev => ({ ...prev, [posId]: true }))
    const ma60 = await fetchMa60(position.symbol)
    setMa60Data(prev => ({ ...prev, [posId]: ma60 !== null ? { value: ma60, source: 'api' } : null }))
    setMa60Loading(prev => ({ ...prev, [posId]: false }))
  }, [])

  // 批量刷新所有已启用计划的MA60
  const doFetchAllMa60 = useCallback(async () => {
    const targets = allPositions.filter(p => {
      const plan = getRebuyPlan(p.id)
      return plan?.enabled
    })
    await Promise.all(targets.map(p => doFetchMa60(p)))
  }, [allPositions, doFetchMa60])

  // 初始化时获取实时价格和MA60
  useEffect(() => {
    const fetchInitialData = async () => {
      setPriceLoading(true)
      const priceUpdates: Record<string, number> = {}
      await Promise.all(allPositions.map(async (pos) => {
        const quote = await getStockQuote(pos.symbol)
        if (quote) {
          priceUpdates[pos.id] = quote.price
        }
      }))
      setLocalPrices(priceUpdates)
      setPriceLoading(false)

      const targets = allPositions.filter(p => {
        const plan = getRebuyPlan(p.id)
        return plan?.enabled && !ma60Data[p.id] && !ma60Loading[p.id]
      })
      targets.forEach(p => doFetchMa60(p))
    }

    fetchInitialData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 获取有效价格
  const getEffectivePrice = useCallback((position: Position): number => {
    return localPrices[position.id] ?? position.currentPrice
  }, [localPrices])

  // 获取带实时价格的 position 副本
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
    await Promise.all(allPositions.map(async (pos) => {
      const quote = await getStockQuote(pos.symbol)
      if (quote) {
        priceUpdates[pos.id] = quote.price
      }
    }))
    setLocalPrices(priceUpdates)
    setPriceLoading(false)
  }, [allPositions])

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
      doFetchMa60(position)
    } else {
      if (existing) {
        saveRebuyPlan(position.id, { ...existing, enabled: false })
      }
    }
  }, [doFetchMa60])

  // 保存预算
  const saveBudget = useCallback((position: Position, budget: number) => {
    const existing = getRebuyPlan(position.id) || {
      totalBudget: budget,
      batchesExecuted: 0,
      enabled: true,
    }
    saveRebuyPlan(position.id, { ...existing, totalBudget: budget })
    setEditBudget(prev => ({ ...prev, [position.id]: '' }))
  }, [])

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
  }, [])

  // 处理股数输入
  const handleSharesChange = useCallback((posId: string, value: string) => {
    // 只允许数字
    const cleaned = value.replace(/[^0-9]/g, '')
    setSharesInput(prev => ({ ...prev, [posId]: cleaned }))
  }, [])

  // 空状态
  if (allPositions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <Shield className="h-16 w-16 mb-4 opacity-20" />
        <p className="text-lg font-medium mb-2">暂无持仓</p>
        <p className="text-sm">请先在「持仓管理」中添加股票</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* 页面头 */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">回购计划</h2>
          <p className="text-sm text-muted-foreground mt-1">
            防踏空金字塔回购决策面板 — 基于安全垫 + MA60 支撑
          </p>
        </div>
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
            onClick={doFetchAllMa60}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border hover:bg-surface-hover transition-colors"
            disabled={Object.values(ma60Loading).some(Boolean)}
          >
            <RefreshCw className={`h-4 w-4 ${Object.values(ma60Loading).some(Boolean) ? 'animate-spin' : ''}`} />
            刷新MA60
          </button>
        </div>
      </div>

      {/* 统一股票卡片列表 */}
      <div className="grid gap-4">
        {allPositions.map(position => (
          <RebuyCard
            key={position.id}
            position={position}
            effPos={getEffectivePosition(position)}
            ma60Data={ma60Data}
            ma60Loading={ma60Loading}
            expandedConfig={expandedConfig}
            editBudget={editBudget}
            editMa60={editMa60}
            sharesInput={sharesInput}
            useCurrentPrice={useCurrentPrice}
            getEffectiveMa60={getEffectiveMa60}
            toggleEnabled={toggleEnabled}
            saveBudget={saveBudget}
            saveManualMa60={saveManualMa60}
            doFetchMa60={doFetchMa60}
            handleSharesChange={handleSharesChange}
            setSharesInput={setSharesInput}
            setUseCurrentPrice={setUseCurrentPrice}
            setExpandedConfig={setExpandedConfig}
            setEditBudget={setEditBudget}
            setEditMa60={setEditMa60}
          />
        ))}
      </div>

      {/* 使用说明 */}
      <div className="rounded-xl border bg-card p-4">
        <h4 className="font-medium mb-2">使用说明</h4>
        <ul className="text-sm text-muted-foreground space-y-1 list-disc pl-4">
          <li>在有盈利或已清仓的持仓上「启用」回购计划，系统自动从交易记录中计算安全垫（已实现利润）</li>
          <li>输入你想买回的股数（步长100股），下方表格实时显示三批买入的详细数据</li>
          <li>已清仓股票以最近卖出价为基准，有持仓股票以成本价为基准</li>
          <li>勾选「用当前价模拟」可预览「现在就买」的效果</li>
          <li>MA60 自动从东方财富获取（页面加载时获取一次），也可手动输入覆盖</li>
        </ul>
      </div>
    </div>
  )
}

// 单张回购卡片
interface RebuyCardProps {
  position: Position
  effPos: Position
  ma60Data: Record<string, { value: number; source: 'api' | 'manual' } | null>
  ma60Loading: Record<string, boolean>
  expandedConfig: Record<string, boolean>
  editBudget: Record<string, string>
  editMa60: Record<string, string>
  sharesInput: Record<string, string>
  useCurrentPrice: Record<string, boolean>
  getEffectiveMa60: (posId: string) => number | null
  toggleEnabled: (position: Position, enabled: boolean) => void
  saveBudget: (position: Position, budget: number) => void
  saveManualMa60: (position: Position, ma60: number | null) => void
  doFetchMa60: (position: Position) => void
  handleSharesChange: (posId: string, value: string) => void
  setSharesInput: React.Dispatch<React.SetStateAction<Record<string, string>>>
  setUseCurrentPrice: React.Dispatch<React.SetStateAction<Record<string, boolean>>>
  setExpandedConfig: React.Dispatch<React.SetStateAction<Record<string, boolean>>>
  setEditBudget: React.Dispatch<React.SetStateAction<Record<string, string>>>
  setEditMa60: React.Dispatch<React.SetStateAction<Record<string, string>>>
}

function RebuyCard({
  position,
  effPos,
  ma60Data,
  ma60Loading,
  expandedConfig,
  editBudget,
  editMa60,
  sharesInput,
  useCurrentPrice,
  getEffectiveMa60,
  toggleEnabled,
  saveBudget,
  saveManualMa60,
  doFetchMa60,
  handleSharesChange,
  setUseCurrentPrice,
  setExpandedConfig,
  setEditBudget,
  setEditMa60,
}: RebuyCardProps) {
  const plan = getRebuyPlan(position.id)
  const enabled = plan?.enabled ?? false
  const effectiveMa60 = getEffectiveMa60(position.id)
  const isLoading = ma60Loading[position.id]
  const realizedProfit = calculateRealizedProfit(position.transactions)
  const basePrice = getRebuyBasePrice(position)
  const isCleared = position.quantity === 0
  const isConfigExpanded = expandedConfig[position.id] ?? false
  const budgetEditing = editBudget[position.id] ?? ''
  const ma60Editing = editMa60[position.id] ?? ''
  const currentUsePrice = useCurrentPrice[position.id] ?? false

  // 解析股数
  const sharesStr = sharesInput[position.id] ?? ''
  const shares = parseInt(sharesStr) || 0
  const validShares = shares >= 100 ? Math.floor(shares / 100) * 100 : 0

  // 计算批次模拟
  const simulations = useMemo(() => {
    if (validShares <= 0) return []
    return simulateBatchRebuy(effPos, validShares, currentUsePrice)
  }, [effPos, validShares, currentUsePrice])

  // 判断哪些批次已触发
  const getTriggeredStatus = useCallback((batch: BatchSimulation): boolean => {
    const currentPrice = effPos.currentPrice
    const buyPrice = batch.buyPrice
    return currentPrice <= buyPrice
  }, [effPos.currentPrice])

  return (
    <div
      className={cn(
        'rounded-xl border bg-card transition-all duration-200',
        enabled ? 'shadow-sm' : 'opacity-60'
      )}
    >
      {/* 卡片头部 */}
      <div className="p-4 flex items-center justify-between border-b">
        <div className="flex items-center gap-3">
          <div className={cn(
            'w-2 h-2 rounded-full',
            enabled ? 'bg-green-400' : 'bg-gray-300'
          )} />
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
            onClick={() => toggleEnabled(position, !enabled)}
            className={cn(
              'px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors',
              enabled
                ? 'bg-primary text-primary-foreground border-primary'
                : 'text-muted-foreground hover:bg-surface-hover'
            )}
          >
            {enabled ? '已启用' : '未启用'}
          </button>
        </div>
      </div>

      {/* 主体内容 */}
      <div className="p-4 space-y-4">
        {/* 关键指标 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricCard
            label="现价"
            value={formatCurrency(effPos.currentPrice)}
            className={effPos.changePercent >= 0 ? 'text-red-500' : 'text-green-500'}
          />
          <MetricCard
            label="MA60"
            value={isLoading ? '获取中...' : effectiveMa60 ? formatCurrency(effectiveMa60) : '未获取'}
            sub={effectiveMa60 !== null ? (ma60Data[position.id]?.source === 'manual' ? '手动' : '自动') : ''}
            className={effectiveMa60 !== null && effPos.currentPrice < effectiveMa60 ? 'text-purple-500' : ''}
          />
          <MetricCard
            label="安全垫（已实现利润）"
            value={formatCurrency(realizedProfit)}
            className={realizedProfit >= 0 ? 'text-up' : 'text-down'}
          />
          <MetricCard
            label={isCleared ? '最近卖出价' : '持仓成本价'}
            value={basePrice ? formatCurrency(basePrice) : '暂无'}
            sub={basePrice ? `距基准 ${formatPercent(((effPos.currentPrice - basePrice) / basePrice) * 100)}` : ''}
            className={basePrice && effPos.currentPrice < basePrice ? 'text-green-500' : ''}
          />
        </div>

        {/* 未启用提示 */}
        {!enabled && (
          <div className="text-center py-4 text-muted-foreground text-sm">
            点击「未启用」开启回购计划
          </div>
        )}

        {/* 启用后的回购模拟区域 */}
        {enabled && (
          <>
            {/* MA60 缺失警告 */}
            {!effectiveMa60 && !isLoading && (
              <div className="rounded-lg p-4 border border-yellow-200 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-950">
                <div className="flex items-center gap-2 text-yellow-700 dark:text-yellow-400">
                  <AlertTriangle className="h-4 w-4" />
                  <span className="text-sm font-medium">MA60 数据未获取，请点击"刷新MA60"或在配置中输入手动值</span>
                </div>
              </div>
            )}

            {/* 基准价缺失警告 */}
            {!basePrice && (
              <div className="rounded-lg p-4 border border-yellow-200 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-950">
                <div className="flex items-center gap-2 text-yellow-700 dark:text-yellow-400">
                  <AlertTriangle className="h-4 w-4" />
                  <span className="text-sm font-medium">
                    {isCleared ? '暂无卖出记录，无法计算安全垫' : '暂无成本价，无法计算回购基准'}
                  </span>
                </div>
              </div>
            )}

            {/* 股数输入 */}
            {basePrice && (
              <div className="space-y-3">
                {/* 第3行：股数输入 */}
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
                  <span className="text-sm text-muted-foreground whitespace-nowrap">
                    股（最多10,000股，步长100）
                  </span>
                  {sharesStr && validShares <= 0 && (
                    <span className="text-xs text-orange-500">最少100股</span>
                  )}
                </div>

                {/* 第4行：批次模拟表格 */}
                {validShares > 0 && simulations.length > 0 && (
                  <div className="rounded-lg border overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-muted/50 border-b">
                          <th className="text-left py-2.5 px-3 font-medium text-muted-foreground">批次</th>
                          <th className="text-right py-2.5 px-3 font-medium text-muted-foreground">买入价</th>
                          <th className="text-right py-2.5 px-3 font-medium text-muted-foreground">投入金额</th>
                          <th className="text-right py-2.5 px-3 font-medium text-muted-foreground">扣安全垫后真实成本</th>
                          <th className="text-right py-2.5 px-3 font-medium text-muted-foreground">涨回基准价赚</th>
                        </tr>
                      </thead>
                      <tbody>
                        {simulations.map((sim, idx) => {
                          const triggered = getTriggeredStatus(sim)
                          const icons = ['🥇', '🥈', '🥉']
                          const batchNames = ['第一批(跌5%)', '第二批(跌10%)', '第三批(跌15%)']
                          return (
                            <tr
                              key={sim.batch}
                              className={cn(
                                'border-b last:border-b-0',
                                triggered ? 'bg-green-50 dark:bg-green-950/30' : '',
                                idx % 2 === 0 ? 'bg-surface/30' : ''
                              )}
                            >
                              <td className="py-2.5 px-3">
                                <span className="mr-1">{icons[idx]}</span>
                                <span>{batchNames[idx]}</span>
                                {triggered && (
                                  <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300">
                                    已触发
                                  </span>
                                )}
                              </td>
                              <td className="text-right py-2.5 px-3 font-mono tabular-nums">
                                {formatCurrency(sim.buyPrice)}
                              </td>
                              <td className="text-right py-2.5 px-3 font-mono tabular-nums">
                                {formatCurrency(sim.investAmount)}
                              </td>
                              <td className="text-right py-2.5 px-3 font-mono tabular-nums text-up">
                                {formatCurrency(sim.realCost)}
                              </td>
                              <td className="text-right py-2.5 px-3 font-mono tabular-nums text-red-500">
                                +{formatCurrency(sim.profitIfBackToBase)}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* 第5行：当前价模拟 */}
                {validShares > 0 && simulations.length > 0 && (
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={currentUsePrice}
                        onChange={e => setUseCurrentPrice(prev => ({ ...prev, [position.id]: e.target.checked }))}
                        className="rounded border-gray-300"
                      />
                      <span className="text-sm">
                        用当前价 <span className="font-mono font-medium">{formatCurrency(effPos.currentPrice)}</span> 模拟
                      </span>
                    </label>

                    {currentUsePrice && (
                      <div className="rounded-lg border overflow-hidden">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="bg-muted/50 border-b">
                              <th className="text-left py-2.5 px-3 font-medium text-muted-foreground">买入价</th>
                              <th className="text-right py-2.5 px-3 font-medium text-muted-foreground">投入金额</th>
                              <th className="text-right py-2.5 px-3 font-medium text-muted-foreground">真实成本</th>
                              <th className="text-right py-2.5 px-3 font-medium text-muted-foreground">涨回基准价赚</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr className="bg-surface/30">
                              <td className="py-2.5 px-3 font-mono tabular-nums">
                                {formatCurrency(simulations[0].buyPrice)}
                              </td>
                              <td className="text-right py-2.5 px-3 font-mono tabular-nums">
                                {formatCurrency(simulations[0].investAmount)}
                              </td>
                              <td className="text-right py-2.5 px-3 font-mono tabular-nums text-up">
                                {formatCurrency(simulations[0].realCost)}
                              </td>
                              <td className="text-right py-2.5 px-3 font-mono tabular-nums text-red-500">
                                +{formatCurrency(simulations[0].profitIfBackToBase)}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}

                {/* 第6行：策略说明 */}
                <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
                  <div className="flex items-start gap-2">
                    <Lightbulb className="h-4 w-4 mt-0.5 text-yellow-500 shrink-0" />
                    <div>
                      <p className="text-sm font-medium">为什么分三批买？</p>
                      <p className="text-sm text-muted-foreground mt-1">
                        股价跌5%买一批，跌10%买第二批，跌15%买第三批。
                        这样不会因为刚跌一点就全仓套牢，也不会因为等更低而错过。
                      </p>
                    </div>
                  </div>

                  {realizedProfit > 0 && (
                    <div className="flex items-start gap-2">
                      <span className="text-sm mt-0.5 shrink-0">📊</span>
                      <p className="text-sm text-muted-foreground">
                        你的安全垫 <span className="font-medium text-up">{formatCurrency(realizedProfit)}</span> 意味着：
                        无论在哪一批买入，你都比别人少赚这么多（相当于买入成本打了折）。
                        这是你已经到手的利润，回购时相当于「用利润做缓冲」。
                      </p>
                    </div>
                  )}

                  <div className="flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 mt-0.5 text-orange-500 shrink-0" />
                    <div>
                      <p className="text-sm font-medium">风险提示</p>
                      <ul className="text-sm text-muted-foreground mt-1 space-y-0.5 list-disc pl-4">
                        <li>第一批最容易等到但赚最少，第三批最难等到但赚最多</li>
                        <li>如果现价已低于某批价位，说明已经触发，可以考虑执行</li>
                        <li>股价可能继续下跌，建议按批次分批买入，不要一次性全仓</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 配置面板 */}
            <div>
              <button
                onClick={() => setExpandedConfig(prev => ({ ...prev, [position.id]: !prev[position.id] }))}
                className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                {isConfigExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                配置
              </button>

              {isConfigExpanded && (
                <div className="mt-3 p-4 rounded-lg border bg-muted/30 space-y-3">
                  {/* 预算设置 */}
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">回购预算</span>
                    <div className="flex items-center gap-2">
                      {budgetEditing ? (
                        <>
                          <input
                            type="number"
                            value={budgetEditing}
                            onChange={e => setEditBudget(prev => ({ ...prev, [position.id]: e.target.value }))}
                            className="w-28 px-2 py-1 text-sm rounded border bg-background text-right font-mono"
                            placeholder={plan?.totalBudget?.toString()}
                            autoFocus
                          />
                          <button
                            onClick={() => {
                              const val = parseFloat(budgetEditing)
                              if (!isNaN(val) && val > 0) saveBudget(position, val)
                            }}
                            className="p-1 rounded hover:bg-surface-hover text-green-500"
                          >
                            <Check className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => setEditBudget(prev => ({ ...prev, [position.id]: '' }))}
                            className="p-1 rounded hover:bg-surface-hover text-muted-foreground"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </>
                      ) : (
                        <>
                          <span className="text-sm font-mono">{plan ? formatCurrency(plan.totalBudget) : '未设置'}</span>
                          <button
                            onClick={() => setEditBudget(prev => ({ ...prev, [position.id]: (plan?.totalBudget || 10000).toString() }))}
                            className="p-1 rounded hover:bg-surface-hover text-muted-foreground"
                          >
                            <Wallet className="h-4 w-4" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* MA60手动覆盖 */}
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">MA60（手动覆盖）</span>
                    <div className="flex items-center gap-2">
                      {ma60Editing ? (
                        <>
                          <input
                            type="number"
                            step="0.01"
                            value={ma60Editing}
                            onChange={e => setEditMa60(prev => ({ ...prev, [position.id]: e.target.value }))}
                            className="w-28 px-2 py-1 text-sm rounded border bg-background text-right font-mono"
                            placeholder={plan?.manualMa60?.toString()}
                            autoFocus
                          />
                          <button
                            onClick={() => {
                              const val = parseFloat(ma60Editing)
                              if (!isNaN(val) && val > 0) saveManualMa60(position, val)
                            }}
                            className="p-1 rounded hover:bg-surface-hover text-green-500"
                          >
                            <Check className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => setEditMa60(prev => ({ ...prev, [position.id]: '' }))}
                            className="p-1 rounded hover:bg-surface-hover text-muted-foreground"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </>
                      ) : (
                        <>
                          <span className="text-sm font-mono">
                            {plan?.manualMa60 ? formatCurrency(plan.manualMa60) : '未设置'}
                          </span>
                          <button
                            onClick={() => setEditMa60(prev => ({ ...prev, [position.id]: (plan?.manualMa60 || effectiveMa60 || '').toString() }))}
                            className="p-1 rounded hover:bg-surface-hover text-muted-foreground"
                          >
                            <TrendingDown className="h-4 w-4" />
                          </button>
                          {plan?.manualMa60 && (
                            <button
                              onClick={() => saveManualMa60(position, null)}
                              className="p-1 rounded hover:bg-surface-hover text-muted-foreground"
                              title="清除手动值，回到自动获取"
                            >
                              <RotateCcw className="h-4 w-4" />
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  {/* 获取MA60（API） */}
                  {!plan?.manualMa60 && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">MA60（自动获取）</span>
                      <button
                        onClick={() => doFetchMa60(position)}
                        disabled={ma60Loading[position.id]}
                        className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded border hover:bg-surface-hover transition-colors"
                      >
                        {ma60Loading[position.id] ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <RefreshCw className="h-3 w-3" />
                        )}
                        更新
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// 指标卡片子组件
function MetricCard({
  label,
  value,
  sub,
  className,
}: {
  label: string
  value: string
  sub?: string
  className?: string
}) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground truncate">{label}</p>
      <p className={cn('text-base font-semibold font-mono tabular-nums truncate', className)}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground truncate mt-0.5">{sub}</p>}
    </div>
  )
}
