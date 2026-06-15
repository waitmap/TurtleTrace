import type { DrawdownInfo } from '../types'
import { getLongTermKLine } from './stockService'

// 获取长期K线数据（带缓存）
async function getCloses(symbol: string, days: number = 2500): Promise<number[] | null> {
  const cacheKey = `dd_${symbol}`
  const cached = sessionStorage.getItem(cacheKey)
  if (cached) {
    try {
      const { data, expires } = JSON.parse(cached)
      if (Date.now() < expires) return data
    } catch {}
  }

  const closes = await getLongTermKLine(symbol, days)
  if (closes) {
    sessionStorage.setItem(cacheKey, JSON.stringify({
      data: closes,
      expires: Date.now() + 24 * 60 * 60 * 1000,
    }))
  }
  return closes
}

// 计算回撤分位数
export async function calculateDrawdownPercentile(
  symbol: string,
  currentPrice: number,
  days: number = 2500,
): Promise<DrawdownInfo | null> {
  const closes = await getCloses(symbol, days)
  if (!closes || closes.length === 0) return null

  // 计算每日回撤
  const drawdowns: number[] = []
  let peak = closes[0]
  for (const close of closes) {
    if (close > peak) peak = close
    const dd = ((close - peak) / peak) * 100
    drawdowns.push(dd)
  }

  // 当前回撤
  const historicalPeak = Math.max(...closes)
  const currentDrawdown = ((currentPrice - historicalPeak) / historicalPeak) * 100

  // 计算分位数：有多少比例的历史回撤比当前更差（更负）
  const worseCount = drawdowns.filter(dd => dd <= currentDrawdown).length
  const percentile = Math.round((worseCount / drawdowns.length) * 100)

  return {
    percentile: Math.min(100, Math.max(0, percentile)),
    currentDrawdown: Math.round(currentDrawdown * 100) / 100,
    historicalPeak: Math.round(historicalPeak * 100) / 100,
    dataPoints: closes.length,
  }
}
