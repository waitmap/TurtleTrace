import type { Position, RebuyPlan, RebuyScoreData, DynamicBatch } from '../types'
import { calculateRealizedProfit, calculateSafetyCushion } from './rebuyService'
import { calculateDrawdownPercentile } from './drawdownService'

// 获取最近卖出时间戳
function getLastSellTimestamp(position: Position): number | null {
  const sells = position.transactions
    .filter(tx => tx.type === 'sell')
    .sort((a, b) => b.timestamp - a.timestamp)
  return sells.length > 0 ? sells[0].timestamp : null
}

// 安全垫分: 利润 / 原投入金额 的覆盖率
// 安全垫厚度 = 已实现利润能覆盖多少比例的原投入
// 例: 利润¥28,000, 原投入¥10,000 → 280%覆盖率 → 满分
// 例: 利润¥120, 原投入¥12,280 → 0.97%覆盖率 → 0分
function calcSafetyPadScore(realizedProfit: number, totalBuyAmount: number): number {
  if (totalBuyAmount <= 0 || realizedProfit <= 0) return 0
  const coverage = (realizedProfit / totalBuyAmount) * 100
  return Math.min(coverage, 100)
}

// 趋势分: 对MA60/MA120/MA250/MA500/MA1000各算一次距离，取最高分
function calcTrendScore(
  currentPrice: number,
  ma60: number | null,
  ma120: number | null,
  ma250: number | null,
  ma500: number | null,
  ma1000: number | null,
): number {
  const scores: number[] = []
  const mas = [ma60, ma120, ma250, ma500, ma1000]

  for (const ma of mas) {
    if (!ma || ma <= 0) continue
    const distPercent = ((currentPrice - ma) / ma) * 100
    let score: number
    if (distPercent < 0) {
      // 低于均线: 50 + abs(dist%) * 3 (封顶100)
      score = 50 + Math.abs(distPercent) * 3
    } else {
      // 高于均线: 50 - dist% * 2 (最低0)
      score = 50 - distPercent * 2
    }
    scores.push(Math.min(100, Math.max(0, score)))
  }

  return scores.length > 0 ? Math.max(...scores) : 50
}

// 价值分: 直接映射回撤分位数（在 calculateRebuyScore 中使用）

// 时间分: 距上次卖出的天数
function calcTimeScore(position: Position): number {
  const lastSellTs = getLastSellTimestamp(position)
  if (!lastSellTs) return 50 // 没有卖出记录，给中间分
  const daysSinceSell = (Date.now() - lastSellTs) / (1000 * 60 * 60 * 24)
  return Math.min((daysSinceSell / 90) * 100, 100)
}

// 根据安全垫率获取动态批次配置
function getDynamicBatchConfig(safetyPadRate: number): { ratios: number[]; triggers: number[]; labels: string[] } {
  if (safetyPadRate < 20) {
    // 低安全垫: 保守
    return {
      ratios: [0.15, 0.30, 0.55],
      triggers: [50, 70, 85],
      labels: ['保守', '适中', '积极'],
    }
  } else if (safetyPadRate <= 50) {
    // 中等安全垫
    return {
      ratios: [0.20, 0.30, 0.50],
      triggers: [45, 65, 85],
      labels: ['保守', '适中', '积极'],
    }
  } else {
    // 高安全垫: 积极
    return {
      ratios: [0.35, 0.35, 0.30],
      triggers: [40, 60, 80],
      labels: ['保守', '适中', '积极'],
    }
  }
}

// 评级
function getRating(total: number): RebuyScoreData['rating'] {
  if (total <= 20) return '禁止回购'
  if (total <= 40) return '继续观察'
  if (total <= 60) return '轻仓回购'
  if (total <= 80) return '分批回购'
  return '积极回购'
}

// 计算回购评分
export async function calculateRebuyScore(
  position: Position,
  plan: RebuyPlan,
  ma60: number | null,
  ma120: number | null,
  ma250: number | null,
  ma500: number | null,
  ma1000: number | null,
): Promise<RebuyScoreData> {
  const realizedProfit = calculateRealizedProfit(position.transactions)
  const safetyCushion = calculateSafetyCushion(position)
  const budget = plan.totalBudget
  const currentPrice = position.currentPrice
  const totalBuyAmount = position.totalBuyAmount || 0

  // 安全垫分（基于总安全垫 = 已实现利润 + 持仓浮动盈利）
  const safetyPadScore = Math.round(calcSafetyPadScore(safetyCushion, totalBuyAmount))

  // 趋势分
  const trendScore = Math.round(calcTrendScore(currentPrice, ma60, ma120, ma250, ma500, ma1000))

  // 价值分（回撤分位数）
  const drawdownInfo = await calculateDrawdownPercentile(position.symbol, currentPrice)
  const valueScore = drawdownInfo ? drawdownInfo.percentile : 50

  // 时间分
  const timeScore = Math.round(calcTimeScore(position))

  // 加权总分: safety*0.20 + trend*0.20 + value*0.40 + time*0.20
  const total = Math.round(
    safetyPadScore * 0.20 +
    trendScore * 0.20 +
    valueScore * 0.40 +
    timeScore * 0.20
  )

  const rating = getRating(total)

  // 动态批次（基于原投入金额计算安全垫率）
  const safetyPadRate = totalBuyAmount > 0 ? (realizedProfit / totalBuyAmount) * 100 : 0
  const config = getDynamicBatchConfig(safetyPadRate)

  const dynamicBatch: DynamicBatch[] = config.ratios.map((ratio, i) => {
    const amount = budget * ratio
    const realCost = amount - realizedProfit
    return {
      batch: i + 1,
      label: config.labels[i],
      fundRatio: ratio,
      triggerScore: config.triggers[i],
      amount: Math.round(amount * 100) / 100,
      realCost: Math.round(realCost * 100) / 100,
      canExecute: total >= config.triggers[i] && budget > 0,
    }
  })

  return {
    total,
    safetyPadScore,
    trendScore,
    valueScore,
    timeScore,
    rating,
    dynamicBatch,
  }
}
