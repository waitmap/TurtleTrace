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

// 获取最近一次卖出价格
export function getLastSellPrice(transactions: Transaction[]): number | null {
  const sells = transactions
    .filter(tx => tx.type === 'sell')
    .sort((a, b) => b.timestamp - a.timestamp)

  return sells.length > 0 ? sells[0].price : null
}

// 计算回购建议
export function calculateRebuyAdvice(
  position: Position,
  plan: RebuyPlan,
  ma60: number,
): RebuyAdvice {
  const { totalBudget, batchesExecuted } = plan
  const currentPrice = position.currentPrice
  const realizedProfit = calculateRealizedProfit(position.transactions)
  const lastSellPrice = getLastSellPrice(position.transactions)

  const distanceToMa60 = ma60 > 0 ? ((currentPrice - ma60) / ma60) * 100 : 0
  const dropPercent = lastSellPrice
    ? ((currentPrice - lastSellPrice) / lastSellPrice) * 100
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
    if (!lastSellPrice) {
      summary = '暂无卖出记录，设置安全垫后等待价格回调'
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
    safetyCushion: realizedProfit,
    batchAmount,
    batchShares,
    suggestPrice,
    totalBudgetLeft,
    summary,
    ma60Price: ma60,
  }
}