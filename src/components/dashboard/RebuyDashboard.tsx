import { useState, useEffect, useCallback } from 'react'
import {
  RefreshCw, Shield, TrendingDown,
  RotateCcw, Loader2, ChevronDown, ChevronUp,
  Check, X, AlertTriangle, Target, Wallet
} from 'lucide-react'
import type { Position, RebuyPlan, RebuyAdvice } from '../../types'
import { calculateRebuyAdvice, calculateRealizedProfit, getLastSellPrice } from '../../services/rebuyService'
import {
  getRebuyPlan, saveRebuyPlan,
  incrementBatchesExecuted, resetBatchesExecuted
} from '../../services/rebuyStorageService'
import { fetchMa60 } from '../../services/stockService'
import { formatCurrency, formatPercent, cn } from '../../lib/utils'

interface RebuyDashboardProps {
  positions: Position[]
}

export function RebuyDashboard({ positions }: RebuyDashboardProps) {
  const activePositions = positions.filter(p => p.quantity > 0)
  const [ma60Data, setMa60Data] = useState<Record<string, { value: number; source: 'api' | 'manual' } | null>>({})
  const [ma60Loading, setMa60Loading] = useState<Record<string, boolean>>({})
  const [expandedConfig, setExpandedConfig] = useState<Record<string, boolean>>({})
  const [editBudget, setEditBudget] = useState<Record<string, string>>({})
  const [editMa60, setEditMa60] = useState<Record<string, string>>({})

  // 获取MA60（自动获取 + 手动覆盖）
  const getEffectiveMa60 = useCallback((posId: string): number | null => {
    const plan = getRebuyPlan(posId)
    if (plan?.manualMa60 && plan.manualMa60 > 0) return plan.manualMa60
    const fetched = ma60Data[posId]
    return fetched?.value ?? null
  }, [ma60Data])

  // 获取回购建议
  const getAdvice = useCallback((position: Position): RebuyAdvice | null => {
    const plan = getRebuyPlan(position.id)
    if (!plan || !plan.enabled) return null
    const ma60 = getEffectiveMa60(position.id)
    if (ma60 === null) return null
    return calculateRebuyAdvice(position, plan, ma60)
  }, [getEffectiveMa60])

  // 获取单个MA60
  const doFetchMa60 = useCallback(async (position: Position) => {
    const posId = position.id
    setMa60Loading(prev => ({ ...prev, [posId]: true }))
    const ma60 = await fetchMa60(position.symbol)
    setMa60Data(prev => ({ ...prev, [posId]: ma60 !== null ? { value: ma60, source: 'api' } : null }))
    setMa60Loading(prev => ({ ...prev, [posId]: false }))
  }, [])

  // 批量获取MA60
  const doFetchAllMa60 = useCallback(async () => {
    const targets = activePositions.filter(p => {
      const plan = getRebuyPlan(p.id)
      return plan?.enabled
    })
    await Promise.all(targets.map(p => doFetchMa60(p)))
  }, [activePositions, doFetchMa60])

  // 初始化：为已启用计划的持仓获取MA60
  useEffect(() => {
    const targets = activePositions.filter(p => {
      const plan = getRebuyPlan(p.id)
      return plan?.enabled && !ma60Data[p.id] && !ma60Loading[p.id]
    })
    targets.forEach(p => doFetchMa60(p))
    // 只运行一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
      // 自动获取MA60
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
    // 更新显示
    setMa60Data(prev => ({
      ...prev,
      [position.id]: ma60 !== null ? { value: ma60, source: 'manual' } : prev[position.id] || null,
    }))
  }, [])

  // 空状态
  if (activePositions.length === 0) {
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
            onClick={doFetchAllMa60}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border hover:bg-surface-hover transition-colors"
            disabled={Object.values(ma60Loading).some(Boolean)}
          >
            <RefreshCw className={`h-4 w-4 ${Object.values(ma60Loading).some(Boolean) ? 'animate-spin' : ''}`} />
            刷新MA60
          </button>
        </div>
      </div>

      {/* 股票卡片列表 */}
      <div className="grid gap-4">
        {activePositions.map(position => {
          const plan = getRebuyPlan(position.id)
          const enabled = plan?.enabled ?? false
          const effectiveMa60 = getEffectiveMa60(position.id)
          const advice = enabled ? getAdvice(position) : null
          const isLoading = ma60Loading[position.id]
          const realizedProfit = calculateRealizedProfit(position.transactions)
          const lastSellPrice = getLastSellPrice(position.transactions)
          const isConfigExpanded = expandedConfig[position.id] ?? false
          const budgetEditing = editBudget[position.id] ?? ''
          const ma60Editing = editMa60[position.id] ?? ''

          return (
            <div
              key={position.id}
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
                    enabled ? (advice?.status === '观望' ? 'bg-yellow-400' : 'bg-green-400') : 'bg-gray-300'
                  )} />
                  <div>
                    <h3 className="font-semibold">{position.name}</h3>
                    <span className="text-xs text-muted-foreground font-mono">{position.symbol}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {/* 启用/禁用 */}
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
                {/* 第一行：关键指标 */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <MetricCard
                    label="现价"
                    value={formatCurrency(position.currentPrice)}
                    className={position.changePercent >= 0 ? 'text-red-500' : 'text-green-500'}
                  />
                  <MetricCard
                    label="MA60"
                    value={isLoading ? '获取中...' : effectiveMa60 ? formatCurrency(effectiveMa60) : '未获取'}
                    sub={effectiveMa60 !== null ? (ma60Data[position.id]?.source === 'manual' ? '手动' : '自动') : ''}
                    className={effectiveMa60 !== null && position.currentPrice < effectiveMa60 ? 'text-purple-500' : ''}
                  />
                  <MetricCard
                    label="距MA60"
                    value={effectiveMa60 !== null ? formatPercent(((position.currentPrice - effectiveMa60) / effectiveMa60) * 100) : 'N/A'}
                    className={effectiveMa60 !== null && position.currentPrice < effectiveMa60 ? 'text-purple-500' : ''}
                  />
                  <MetricCard
                    label="最近卖出价"
                    value={lastSellPrice ? formatCurrency(lastSellPrice) : '暂无'}
                    sub={lastSellPrice ? `跌幅 ${formatPercent(((position.currentPrice - lastSellPrice) / lastSellPrice) * 100)}` : ''}
                    className={lastSellPrice && position.currentPrice < lastSellPrice ? 'text-green-500' : ''}
                  />
                </div>

                {/* 第二行：安全垫和状态 */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <MetricCard
                    label="安全垫（已实现利润）"
                    value={formatCurrency(realizedProfit)}
                    className={realizedProfit >= 0 ? 'text-up' : 'text-down'}
                  />
                  <MetricCard
                    label="回购预算"
                    value={plan ? formatCurrency(plan.totalBudget) : '未设置'}
                  />
                  <MetricCard
                    label="已执行批次"
                    value={plan ? `${plan.batchesExecuted}/3` : '-'}
                  />
                  <MetricCard
                    label="剩余预算"
                    value={advice ? formatCurrency(advice.totalBudgetLeft) : '-'}
                  />
                </div>

                {/* 状态和操作 */}
                {enabled && advice && (
                  <div className={cn(
                    'rounded-lg p-4 border',
                    advice.status === '观望' ? 'bg-muted/50 border-muted' :
                    advice.status === '第一批回购' ? 'bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800' :
                    advice.status === '第二批回购' ? 'bg-orange-50 dark:bg-orange-950 border-orange-200 dark:border-orange-800' :
                    advice.status === '第三批回购' ? 'bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800' :
                    'bg-purple-50 dark:bg-purple-950 border-purple-200 dark:border-purple-800'
                  )}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Target className={cn('h-5 w-5', advice.statusColor)} />
                        <div>
                          <span className={cn('font-semibold text-lg', advice.statusColor)}>
                            {advice.status}
                          </span>
                          <p className="text-sm text-muted-foreground mt-0.5">{advice.summary}</p>
                        </div>
                      </div>
                      {advice.status !== '观望' && (
                        <button
                          onClick={() => {
                            const updated = incrementBatchesExecuted(position.id)
                            if (updated) {
                              // Force re-render by toggling a state
                              setExpandedConfig(prev => ({ ...prev }))
                            }
                          }}
                          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                        >
                          <Check className="h-4 w-4" />
                          已执行回购
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {enabled && !advice && !isLoading && (
                  <div className="rounded-lg p-4 border border-yellow-200 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-950">
                    <div className="flex items-center gap-2 text-yellow-700 dark:text-yellow-400">
                      <AlertTriangle className="h-4 w-4" />
                      <span className="text-sm font-medium">MA60 数据未获取，请点击"更新MA60"或输入手动值</span>
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

                      {/* 重置批次 */}
                      <div className="flex items-center justify-between pt-2 border-t">
                        <span className="text-sm text-muted-foreground">已执行 {plan?.batchesExecuted ?? 0}/3 批</span>
                        {(plan?.batchesExecuted ?? 0) > 0 && (
                          <button
                            onClick={() => resetBatchesExecuted(position.id)}
                            className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded border text-muted-foreground hover:text-foreground hover:bg-surface-hover transition-colors"
                          >
                            <RotateCcw className="h-3 w-3" />
                            重置批次
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* 使用说明 */}
      <div className="rounded-xl border bg-card p-4">
        <h4 className="font-medium mb-2">使用说明</h4>
        <ul className="text-sm text-muted-foreground space-y-1 list-disc pl-4">
          <li>先在有盈利的持仓上「启用」回购计划，系统自动从交易记录中计算安全垫（已实现利润）</li>
          <li>设置回购预算，系统将按 30%/40%/30% 分三批执行</li>
          <li>当股价从最近卖出价跌 5%/10%/15% 时，对应触发第一/二/三批回购</li>
          <li>若股价直接跌破 MA60（跳空），系统自动建议跳级满仓（一次买入 70% 预算）</li>
          <li>MA60 自动从东方财富获取，也可手动输入覆盖</li>
          <li>执行回购后点击「已执行回购」记录批次进度</li>
        </ul>
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
