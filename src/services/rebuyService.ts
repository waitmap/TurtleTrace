import type { Position, RebuyPlan, RebuyAdvice, Transaction } from '../types'

// 计算已实现利润（平均成本法FIFO）
export function calculateRealizedProfit(transactions: Transaction[]): number {
  let totalBought = 0
  let totalCost = 0
  let realizedProfit = 0

  const sorted = [...transactions].sort((a, b) => a.timestamp - b.timestamp)

  for (const tx of sorted) {
    if (tx.type === 'buy') {
      totalBought += tx.quantity
      totalCost += tx.amount
    } else if (tx.type === 'sell' && totalBought > 0) {
      const avgCost = totalCost / totalBought
      const sellCostBasis = avgCost * tx.quantity
      realizedProfit += tx.amount - sellCostBasis
      totalBought -= tx.quantity
      totalCost -= sellCostBasis
    }
  }

  return realizedProfit
}

// 计算总安全垫（已实现利润 + 持仓浮动盈利）
export function calculateSafetyCushion(position: Position): number {
  const realized = calculateRealizedProfit(position.transactions)
  if (position.quantity <= 0) return realized
  const unrealized = (position.currentPrice - position.costPrice) * position.quantity
  return realized + unrealized
}

// 获取最近一次卖出价格
export function getLastSellPrice(transactions: Transaction[]): number | null {
  const sells = transactions
    .filter(tx => tx.type === 'sell')
    .sort((a, b) => b.timestamp - a.timestamp)

  return sells.length > 0 ? sells[0].price : null
}

// 获取回购基准价格
export function getRebuyBasePrice(position: Position): number | null {
  if (position.quantity === 0) {
    // 已清仓：用最近卖出价
    return getLastSellPrice(position.transactions)
  } else {
    // 有持仓：用成本价
    return position.costPrice > 0 ? position.costPrice : null
  }
}

// 批次模拟数据结构
export interface BatchSimulation {
  label: string
  buyPrice: number
  investAmount: number
  realCost: number
  realCostPerShare: number
  tolerableDrop: number
  breakEvenRise: number
  profitDown5: number
  profitDown10: number
  profitDown15: number
  profitBackToCurrent: number
  profitUp1: number
  profitUp5: number
  profitUp10: number
}

// 批次模拟计算（按现价买入，看各价格水平的盈亏）
export function simulateBatchRebuy(
  position: Position,
  shares: number,
): BatchSimulation[] {
  const currentPrice = position.currentPrice
  if (!currentPrice || currentPrice <= 0 || shares <= 0) return []

  const safetyCushion = calculateSafetyCushion(position)
  const buyPrice = currentPrice
  const investAmount = shares * buyPrice
  const realCost = investAmount - safetyCushion
  const realCostPerShare = shares > 0 ? realCost / shares : 0
  const tolerableDrop = buyPrice > 0 ? Math.max(0, ((buyPrice - realCostPerShare) / buyPrice) * 100) : 0
  const breakEvenRise = buyPrice > 0 ? Math.max(0, ((realCostPerShare - buyPrice) / buyPrice) * 100) : 0

  const profitAt = (price: number) => shares > 0 ? shares * (price - realCostPerShare) : 0

  return [{
    label: '按现价买',
    buyPrice: Math.round(buyPrice * 100) / 100,
    investAmount: Math.round(investAmount * 100) / 100,
    realCost: Math.round(realCost * 100) / 100,
    realCostPerShare: Math.round(realCostPerShare * 100) / 100,
    tolerableDrop: Math.round(tolerableDrop * 10) / 10,
    breakEvenRise: Math.round(breakEvenRise * 10) / 10,
    profitDown5: Math.round(profitAt(currentPrice * 0.95) * 100) / 100,
    profitDown10: Math.round(profitAt(currentPrice * 0.90) * 100) / 100,
    profitDown15: Math.round(profitAt(currentPrice * 0.85) * 100) / 100,
    profitBackToCurrent: Math.round(profitAt(currentPrice) * 100) / 100,
    profitUp1: Math.round(profitAt(buyPrice * 1.01) * 100) / 100,
    profitUp5: Math.round(profitAt(buyPrice * 1.05) * 100) / 100,
    profitUp10: Math.round(profitAt(buyPrice * 1.10) * 100) / 100,
  }]
}

// 计算回购建议
export function calculateRebuyAdvice(
  position: Position,
  plan: RebuyPlan,
  ma60: number,
): RebuyAdvice {
  const { totalBudget, batchesExecuted } = plan
  const currentPrice = position.currentPrice
  const totalCushion = calculateSafetyCushion(position)
  const basePrice = getRebuyBasePrice(position)

  const distanceToMa60 = ma60 > 0 ? ((currentPrice - ma60) / ma60) * 100 : 0
  const dropPercent = basePrice
    ? ((currentPrice - basePrice) / basePrice) * 100
    : 0

  const batchRatios = [0.3, 0.4, 0.3]
  const usedBudget = batchesExecuted > 0
    ? totalBudget * batchRatios.slice(0, batchesExecuted).reduce((a, b) => a + b, 0)
    : 0
  const totalBudgetLeft = totalBudget - usedBudget

  let status: RebuyAdvice['status']
  let batchAmount = 0
  let batchShares = 0
  let suggestPrice = currentPrice
  let statusColor: string

  // 防跳空：价格直接跌破MA60（尚未执行任何批次）
  if (currentPrice <= ma60 && batchesExecuted === 0 && totalBudget > 0) {
    status = '跳级满仓'
    batchAmount = totalBudget * 0.7
    batchShares = Math.floor(batchAmount / currentPrice / 100) * 100
    statusColor = 'text-purple-500'
  } else if (batchesExecuted === 0 && dropPercent <= -5 && totalBudget > 0) {
    status = '第一批回购'
    batchAmount = totalBudget * batchRatios[0]
    batchShares = Math.floor(batchAmount / currentPrice / 100) * 100
    statusColor = 'text-blue-500'
  } else if (batchesExecuted === 1 && dropPercent <= -10 && totalBudget > 0) {
    status = '第二批回购'
    batchAmount = totalBudget * batchRatios[1]
    batchShares = Math.floor(batchAmount / currentPrice / 100) * 100
    statusColor = 'text-orange-500'
  } else if (batchesExecuted === 2 && dropPercent <= -15 && totalBudget > 0) {
    status = '第三批回购'
    batchAmount = totalBudget * batchRatios[2]
    batchShares = Math.floor(batchAmount / currentPrice / 100) * 100
    statusColor = 'text-red-500'
  } else {
    status = '观望'
    statusColor = 'text-muted-foreground'
  }

  // 构建摘要
  let summary: string
  if (status === '观望') {
    if (!basePrice) {
      summary = position.quantity === 0 ? '暂无卖出记录，无法计算安全垫' : '暂无成本价，无法计算回购基准'
    } else {
      const needDrop = batchesExecuted === 0 ? -5 : batchesExecuted === 1 ? -10 : -15
      const remainingDrop = Math.abs(needDrop - dropPercent)
      const batchNames = ['第一', '第二', '第三']
      const nextBatch = batchNames[batchesExecuted] || '后'
      summary = `还需再跌 ${remainingDrop.toFixed(1)}% 触发${nextBatch}批回购`
    }
  } else {
    summary = `建议买入 ${batchShares} 股，预计使用 ¥${batchAmount.toFixed(2)}`
    if (currentPrice <= ma60) {
      summary += '（价格已跌破MA60支撑位，注意风险）'
    }
  }

  return {
    status,
    statusColor,
    dropPercent,
    distanceToMa60,
    safetyCushion: totalCushion,
    batchAmount,
    batchShares,
    suggestPrice,
    totalBudgetLeft,
    summary,
    ma60Price: ma60,
  }
}