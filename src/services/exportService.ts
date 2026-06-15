import type { Position, ProfitSummary, ExportData, Transaction, EmotionTag, ReasonTag } from '../types'
import type { DailyReview } from '../types/review'
import type { MarketEvent } from '../types/event'
import { reviewService } from './reviewService'
import { eventService } from './eventService'
import { getEmotionTags, addEmotionTag, getReasonTags, addReasonTag } from './tagService'

// 扩展导出数据类型以包含复盘和事件
export interface ExtendedExportData extends ExportData {
  reviews?: DailyReview[]
  events?: MarketEvent[]
}

// 导出为 CSV
export function exportToCSV(positions: Position[], summary: ProfitSummary): void {
  // 持仓明细 CSV
  const csvRows: string[] = []

  // 表头
  csvRows.push('股票代码,股票名称,持仓数量,成本价,当前价格,市值,盈亏,盈亏比例(%)')

  // 数据行
  positions.forEach(pos => {
    const marketValue = pos.currentPrice * pos.quantity
    const costValue = pos.costPrice * pos.quantity
    const profit = marketValue - costValue
    const profitPercent = ((pos.currentPrice - pos.costPrice) / pos.costPrice) * 100

    csvRows.push(
      [
        pos.symbol,
        pos.name,
        pos.quantity.toString(),
        pos.costPrice.toFixed(2),
        pos.currentPrice.toFixed(2),
        marketValue.toFixed(2),
        profit.toFixed(2),
        profitPercent.toFixed(2),
      ].join(',')
    )
  })

  // 添加汇总行
  csvRows.push('')
  csvRows.push('汇总')
  csvRows.push(
    [
      '总成本',
      '总市值',
      '总盈亏',
      '总收益率(%)',
    ].join(',')
  )
  csvRows.push(
    [
      summary.totalCost.toFixed(2),
      summary.totalValue.toFixed(2),
      summary.totalProfit.toFixed(2),
      summary.totalProfitPercent.toFixed(2),
    ].join(',')
  )

  const csvContent = '\uFEFF' + csvRows.join('\n') // 添加 BOM 以支持中文

  // 下载文件
  downloadFile(csvContent, `持仓数据_${getDateString()}.csv`, 'text/csv;charset=utf-8')
}

// 导出为 JSON（用于持久化）
export function exportToJSON(positions: Position[], summary: ProfitSummary): void {
  const data: ExportData = {
    version: '1.0.0',
    exportTime: Date.now(),
    positions,
    summary,
  }

  const jsonContent = JSON.stringify(data, null, 2)

  downloadFile(jsonContent, `持仓备份_${getDateString()}.json`, 'application/json')
}

// 导出完整数据（包含持仓、复盘和事件）
export async function exportCompleteData(positions: Position[], summary: ProfitSummary): Promise<void> {
  // 获取所有复盘记录
  const reviews = await reviewService.getAllReviews()
  // 获取所有事件
  const events = await eventService.getAllEvents()

  const data: ExtendedExportData = {
    version: '3.0.0',
    exportTime: Date.now(),
    positions,
    summary,
    reviews,
    events,
  }

  const jsonContent = JSON.stringify(data, null, 2)

  downloadFile(jsonContent, `完整数据备份_${getDateString()}.json`, 'application/json')
}

// 导出每日复盘数据（单独）
export async function exportReviewsData(): Promise<void> {
  const reviews = await reviewService.getAllReviews()

  if (reviews.length === 0) {
    alert('暂无复盘数据可导出')
    return
  }

  const data = {
    version: '1.0.0',
    exportTime: Date.now(),
    reviews,
  }

  const jsonContent = JSON.stringify(data, null, 2)

  downloadFile(jsonContent, `每日复盘_${getDateString()}.json`, 'application/json')
}

// 导出每日复盘为 Markdown
export async function exportReviewsToMarkdown(): Promise<void> {
  const reviews = await reviewService.getAllReviews()

  if (reviews.length === 0) {
    alert('暂无复盘数据可导出')
    return
  }

  // 按日期排序
  const sortedReviews = [...reviews].sort((a, b) => b.date.localeCompare(a.date))

  const lines: string[] = []

  // 标题
  lines.push('# 龟迹复盘 - 每日复盘记录\n')
  lines.push(`导出时间: ${new Date().toLocaleString('zh-CN')}\n`)
  lines.push(`共 ${sortedReviews.length} 条复盘记录\n`)
  lines.push('---\n\n')

  // 每条复盘
  for (const review of sortedReviews) {
    const markdown = await reviewService.exportToMarkdown(review.date)
    lines.push(markdown)
    lines.push('\n\n---\n\n')
  }

  const markdownContent = lines.join('')

  downloadFile(markdownContent, `龟迹复盘_每日复盘_${getDateString()}.md`, 'text/markdown;charset=utf-8')
}

// 导出事件数据（单独）
export async function exportEventsData(): Promise<void> {
  const events = await eventService.getAllEvents()

  if (events.length === 0) {
    alert('暂无事件数据可导出')
    return
  }

  const data = {
    version: '1.0.0',
    exportTime: Date.now(),
    events,
  }

  const jsonContent = JSON.stringify(data, null, 2)

  downloadFile(jsonContent, `消息日历_${getDateString()}.json`, 'application/json')
}

// 生成唯一ID
function generateId(): string {
  return `csv-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

// 解析日期字符串为时间戳
function parseDate(dateStr: string): number | null {
  const trimmed = dateStr.trim()
  if (!trimmed) return null
  const match = trimmed.match(/(\d{4})[-/年]?(\d{1,2})[-/月]?(\d{1,2})[日]?/)
  if (!match) return null
  const [, year, month, day] = match
  const date = new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T00:00:00+08:00`)
  return date.getTime()
}

// 按名称查找或创建情绪标签
function resolveEmotion(name: string): EmotionTag | undefined {
  if (!name) return undefined
  const tags = getEmotionTags()
  const existing = tags.find(t => t.name === name.trim())
  if (existing) return existing
  return addEmotionTag(name.trim())
}

// 按名称查找或创建交易原因标签（支持分号分隔多个）
function resolveReasons(reasonStr: string): ReasonTag[] | undefined {
  if (!reasonStr) return undefined
  const names = reasonStr.split(/[;；]/).map(n => n.trim()).filter(Boolean)
  if (names.length === 0) return undefined
  const tags = getReasonTags()
  return names.map(name => {
    const existing = tags.find(t => t.name === name)
    if (existing) return existing
    return addReasonTag(name)
  })
}

// 从 CSV 导入持仓数据
export function importFromCSV(csvContent: string): Position[] | null {
  try {
    const cleanContent = csvContent.replace(/^\uFEFF/, '')
    const lines = cleanContent.trim().split(/\r?\n/)
    if (lines.length < 2) {
      throw new Error('CSV 文件为空或缺少数据行')
    }

    const headers = lines[0].split(',').map(h => h.trim())
    const hasTxType = headers.includes('交易类型')

    // 交易模式：每行一条交易记录，按股票代码合并
    if (hasTxType) {
      return importTransactions(lines, headers)
    }

    // 批次模式：每行一个批次
    const hasBatchQty = headers.includes('批次数量')
    if (hasBatchQty) {
      return importBatches(lines, headers)
    }

    // 位置概要模式（兼容旧格式）
    return importPositions(lines, headers)
  } catch (error) {
    console.error('Failed to import CSV:', error)
    return null
  }
}

// 补全股票代码（去掉 .SH/.SZ 后缀，或补上后缀后统一转成带后缀格式）
function normalizeSymbol(code: string): string {
  const c = code.trim().toUpperCase()
  if (c.includes('.')) return c
  if (c.startsWith('6') || c.startsWith('5') || c.startsWith('9')) return `${c}.SH`
  if (c.startsWith('0') || c.startsWith('3') || c.startsWith('2')) return `${c}.SZ`
  if (c.startsWith('4') || c.startsWith('8')) return `${c}.BJ`
  return c
}

// 模式1：交易明细模式 — 每行一条交易，按股票合并为持仓
function importTransactions(lines: string[], headers: string[]): Position[] {
  const symbolIdx = idx(headers, '股票代码', '标的代码')
  const nameIdx = idx(headers, '股票名称', '标的名称')
  const txTypeIdx = idx(headers, '交易类型')
  const dateIdx = idx(headers, '交易日期')
  const priceIdx = idx(headers, '成交价格', '成交价', '成交价 (元)', '买入价格')
  const qtyIdx = idx(headers, '成交数量', '成交量', '成交量 (股)', '买入数量')
  const emotionIdx = idx(headers, '情绪标签')
  const reasonIdx = idx(headers, '交易原因', '备注')
  const currentPriceIdx = idx(headers, '当前价格')
  const feeIdx = idx(headers, '税费', '税费 (元)', '手续费', '佣金', '交易费用')
  const stampTaxIdx = idx(headers, '印花税', '印花稅')
  const transferFeeIdx = idx(headers, '过户费', '过戶費', '过户费 (元)')
  const clearingFeeIdx = idx(headers, '清算费', '清算費', '结算费')
  const otherFeeIdx = idx(headers, '其它费', '其他费', '杂费')
  const tradeAmountIdx = idx(headers, '成交金额', '成交金额 (元)', '交易额')
  const buyTotalIdx = idx(headers, '单笔投入合计', '单笔投入合计 (元)', '发生金额', '发生金额 (元)', '实际扣款', '扣款金额', '资金流水')
  const sellTotalIdx = idx(headers, '单笔回收合计', '单笔回收合计 (元)', '到账金额', '实际到账', '回收金额')

  if (symbolIdx === -1 || nameIdx === -1 || txTypeIdx === -1 || qtyIdx === -1) {
    throw new Error('交易模式缺少必需列：股票代码、股票名称、交易类型、成交数量')
  }

  // 第一遍：收集所有交易记录
  const txMap = new Map<string, { symbol: string; name: string; txs: Transaction[]; currentPrice: number }>()

  for (let i = 1; i < lines.length; i++) {
    const row = lines[i].trim()
    if (!row) continue
    const cols = row.split(',').map(c => c.trim())

    const symbol = normalizeSymbol(cols[symbolIdx])
    const name = cols[nameIdx]
    if (!symbol || !name) continue

    const rawTxType = cols[txTypeIdx]?.toLowerCase().replace('股票', '')
    const isDividend = rawTxType === '红股派息' || rawTxType === '红利' || rawTxType === '现金分红'
    if (rawTxType !== 'buy' && rawTxType !== 'sell' && rawTxType !== '买入' && rawTxType !== '卖出' && !isDividend) continue

    const timestamp = dateIdx !== -1 ? parseDate(cols[dateIdx]) : Date.now()
    if (!timestamp) continue

    if (!txMap.has(symbol)) {
      txMap.set(symbol, { symbol, name, txs: [], currentPrice: 0 })
    }
    const entry = txMap.get(symbol)!

    // 当前价格取第一条有值的
    if (entry.currentPrice === 0 && currentPriceIdx !== -1 && cols[currentPriceIdx]) {
      entry.currentPrice = parseFloat(cols[currentPriceIdx]) || 0
    }

    if (isDividend) {
      // 现金分红：计入卖出收益
      const dividendAmount = buyTotalIdx !== -1 && cols[buyTotalIdx]
        ? parseFloat(cols[buyTotalIdx])
        : (tradeAmountIdx !== -1 ? (parseFloat(cols[tradeAmountIdx]) || 0) : 0)
      if (dividendAmount <= 0) continue
      entry.txs.push({
        id: `${symbol}-tx-${generateId()}`,
        type: 'sell',
        price: 0,
        quantity: 0,
        amount: dividendAmount,
        timestamp,
        reasons: [{ id: 'dividend', name: '现金分红', color: '' }],
      })
      continue
    }

    const quantity = parseFloat(cols[qtyIdx])
    const price = priceIdx !== -1 && cols[priceIdx] ? parseFloat(cols[priceIdx]) : 0
    if (isNaN(quantity) || isNaN(price) || quantity <= 0 || price <= 0) continue

    const isBuy = rawTxType === 'buy' || rawTxType === '买入'

    // 计算实际金额（含所有税费）
    // 优先级：
    // 1. 单笔投入合计/单笔回收合计（如果不等于成交金额，说明已含税费）
    // 2. 成交金额 + 各项费用明细
    // 3. 纯成交金额
    const rawAmount = price * quantity
    const commission = feeIdx !== -1 && cols[feeIdx] ? parseFloat(cols[feeIdx]) : 0
    const stampTax = stampTaxIdx !== -1 && cols[stampTaxIdx] ? parseFloat(cols[stampTaxIdx]) : 0
    const transferFee = transferFeeIdx !== -1 && cols[transferFeeIdx] ? parseFloat(cols[transferFeeIdx]) : 0
    const clearingFee = clearingFeeIdx !== -1 && cols[clearingFeeIdx] ? parseFloat(cols[clearingFeeIdx]) : 0
    const otherFee = otherFeeIdx !== -1 && cols[otherFeeIdx] ? parseFloat(cols[otherFeeIdx]) : 0
    const totalFees = commission + stampTax + transferFee + clearingFee + otherFee

    let amount: number
    if (isBuy && buyTotalIdx !== -1 && cols[buyTotalIdx]) {
      const buyTotal = parseFloat(cols[buyTotalIdx])
      // 如果单笔投入合计 ≈ 成交金额（差值 < 0.01），说明没含税费，需要手动加
      if (Math.abs(buyTotal - rawAmount) < 0.01 && totalFees > 0) {
        amount = rawAmount + totalFees
      } else {
        amount = Math.abs(buyTotal)
      }
    } else if (!isBuy && sellTotalIdx !== -1 && cols[sellTotalIdx]) {
      const sellTotal = parseFloat(cols[sellTotalIdx])
      // 如果单笔回收合计 ≈ 成交金额（差值 < 0.01），说明没扣税费，需要手动减
      if (Math.abs(sellTotal - rawAmount) < 0.01 && totalFees > 0) {
        amount = rawAmount - totalFees
      } else {
        amount = sellTotal
      }
    } else if (!isNaN(totalFees) && totalFees > 0) {
      // 没有合计列时，手动加/减各项费用
      amount = isBuy ? rawAmount + totalFees : rawAmount - totalFees
    } else {
      amount = rawAmount
    }

    entry.txs.push({
      id: `${symbol}-tx-${generateId()}`,
      type: isBuy ? 'buy' : 'sell',
      price,
      quantity,
      amount,
      timestamp,
      emotion: emotionIdx !== -1 ? resolveEmotion(cols[emotionIdx]) : undefined,
      reasons: reasonIdx !== -1 ? resolveReasons(cols[reasonIdx]) : undefined,
    })
  }

  if (txMap.size === 0) {
    throw new Error('没有找到有效的交易记录')
  }

  // 检测：找出税费列全为0的股票，提示用户CSV可能缺失数据
  const zeroFeeSymbols: string[] = []
  for (const [symbol, entry] of txMap) {
    const buyTxs = entry.txs.filter(tx => tx.type === 'buy')
    if (buyTxs.length > 0 && feeIdx !== -1) {
      // 检查该股票所有买入交易的税费是否都为0
      const allZeroFee = buyTxs.every(tx => {
        // 通过检查原始CSV行来判断（这里简化处理）
        return tx.amount === tx.quantity * tx.price  // amount = rawAmount 说明没加税费
      })
      if (allZeroFee) {
        zeroFeeSymbols.push(symbol)
      }
    }
  }

  if (zeroFeeSymbols.length > 0) {
    console.warn(
      `⚠️ 以下股票的CSV税费列为0，但券商实际可能收取了费用：${zeroFeeSymbols.join(', ')}。\n` +
      `如果持仓成本与券商不符，请手动修改CSV中这些股票的"税费 (元)"列，然后重新导入。`
    )
  }

  // 第二遍：合并同股票的交易为持仓
  const positions: Position[] = []
  for (const [, entry] of txMap) {
    let totalBuy = 0
    let totalSell = 0
    let totalBuyQty = 0
    let totalSellQty = 0

    for (const tx of entry.txs) {
      if (tx.type === 'buy') {
        totalBuy += tx.amount
        totalBuyQty += tx.quantity
      } else {
        totalSell += tx.amount
        totalSellQty += tx.quantity
      }
    }

    const remainingQty = totalBuyQty - totalSellQty
    const costPrice = remainingQty > 0 ? (totalBuy - totalSell) / remainingQty : 0
    const avgSellPrice = totalSellQty > 0 ? totalSell / totalSellQty : 0

    positions.push({
      id: `${entry.symbol}-${generateId()}`,
      symbol: entry.symbol,
      name: entry.name,
      costPrice,
      quantity: Math.max(0, remainingQty),
      currentPrice: remainingQty > 0 ? (entry.currentPrice || costPrice) : avgSellPrice,
      changePercent: 0,
      transactions: entry.txs,
      totalBuyAmount: totalBuy,
      totalSellAmount: totalSell,
    })
  }

  if (positions.length === 0) {
    throw new Error('没有找到有效的交易记录')
  }

  return positions
}

// 模式2：批次模式 — 每行一个批次
function importBatches(lines: string[], headers: string[]): Position[] {
  const symbolIdx = idx(headers, '股票代码')
  const nameIdx = idx(headers, '股票名称')
  const batchQtyIdx = idx(headers, '批次数量')
  const batchCostIdx = idx(headers, '批次成本价')
  const buyDateIdx = idx(headers, '获得日期', '买入日期')
  const unlockDateIdx = idx(headers, '解禁日期')
  const isLockedIdx = idx(headers, '是否锁定')
  const batchTagIdx = idx(headers, '批次标签')
  const batchNoteIdx = idx(headers, '批次备注')
  const currentPriceIdx = idx(headers, '当前价格')

  if (symbolIdx === -1 || nameIdx === -1 || batchQtyIdx === -1 || batchCostIdx === -1) {
    throw new Error('批次模式缺少必需列：股票代码、股票名称、批次数量、批次成本价')
  }

  const batchMap = new Map<string, { symbol: string; name: string; batches: any[]; currentPrice: number }>()

  for (let i = 1; i < lines.length; i++) {
    const row = lines[i].trim()
    if (!row) continue
    const cols = row.split(',').map(c => c.trim())

    const symbol = cols[symbolIdx]
    const name = cols[nameIdx]
    if (!symbol || !name) continue

    const qty = parseFloat(cols[batchQtyIdx])
    const cost = parseFloat(cols[batchCostIdx])
    if (isNaN(qty) || isNaN(cost) || qty <= 0 || cost <= 0) continue

    if (!batchMap.has(symbol)) {
      batchMap.set(symbol, { symbol, name, batches: [], currentPrice: 0 })
    }
    const entry = batchMap.get(symbol)!

    if (entry.currentPrice === 0 && currentPriceIdx !== -1 && cols[currentPriceIdx]) {
      entry.currentPrice = parseFloat(cols[currentPriceIdx]) || 0
    }

    const buyDate = buyDateIdx !== -1 ? parseDate(cols[buyDateIdx]) : undefined
    const unlockDate = unlockDateIdx !== -1 ? parseDate(cols[unlockDateIdx]) : undefined
    let isLocked = false
    if (isLockedIdx !== -1 && cols[isLockedIdx]) {
      isLocked = cols[isLockedIdx] === '是' || cols[isLockedIdx] === 'true' || cols[isLockedIdx] === '1'
    } else if (unlockDate) {
      isLocked = unlockDate > Date.now()
    }

    entry.batches.push({
      id: `batch-${generateId()}`,
      quantity: qty,
      costPrice: cost,
      buyDate: buyDate || undefined,
      unlockDate: unlockDate || undefined,
      isLocked,
      tag: batchTagIdx !== -1 ? cols[batchTagIdx] || undefined : undefined,
      note: batchNoteIdx !== -1 ? cols[batchNoteIdx] || undefined : undefined,
      transactions: [],
      totalBuyAmount: qty * cost,
      totalSellAmount: 0,
    })
  }

  if (batchMap.size === 0) {
    throw new Error('没有找到有效的批次数据')
  }

  const positions: Position[] = []
  for (const [, entry] of batchMap) {
    let totalQty = 0
    let totalBuy = 0
    for (const b of entry.batches) {
      totalQty += b.quantity
      totalBuy += b.totalBuyAmount
    }

    positions.push({
      id: `${entry.symbol}-${generateId()}`,
      symbol: entry.symbol,
      name: entry.name,
      costPrice: totalBuy / totalQty,
      quantity: totalQty,
      currentPrice: entry.currentPrice || totalBuy / totalQty,
      changePercent: 0,
      transactions: [],
      totalBuyAmount: totalBuy,
      totalSellAmount: 0,
      batches: entry.batches,
    })
  }

  return positions
}

// 模式3：位置概要模式（兼容旧格式）
function importPositions(lines: string[], headers: string[]): Position[] {
  const symbolIdx = idx(headers, '股票代码', '标的代码')
  const nameIdx = idx(headers, '股票名称', '标的名称')
  const quantityIdx = idx(headers, '持仓数量', '成交量', '成交量 (股)', '持有数量')
  const costPriceIdx = idx(headers, '成本价', '成交价', '成交价 (元)', '买入价格')
  const currentPriceIdx = idx(headers, '当前价格')
  const buyDateIdx = idx(headers, '买入日期', '交易日期')
  const sellDateIdx = idx(headers, '卖出日期')
  const sellPriceIdx = idx(headers, '卖出价格')
  const sellQuantityIdx = idx(headers, '卖出数量')
  const emotionIdx = idx(headers, '情绪标签')
  const reasonIdx = idx(headers, '交易原因', '备注')
  const feeIdx = idx(headers, '税费', '税费 (元)')
  const buyTotalIdx = idx(headers, '单笔投入合计', '单笔投入合计 (元)')
  const sellTotalIdx = idx(headers, '单笔回收合计', '单笔回收合计 (元)')

  if (symbolIdx === -1 || nameIdx === -1 || quantityIdx === -1 || costPriceIdx === -1) {
    throw new Error('CSV 缺少必需列：股票代码、股票名称、持仓数量、成本价')
  }

  const positions: Position[] = []

  for (let i = 1; i < lines.length; i++) {
    const row = lines[i].trim()
    if (!row || row.startsWith('汇总')) continue
    const cols = row.split(',').map(c => c.trim())

    const symbol = cols[symbolIdx]
    const name = cols[nameIdx]
    const quantity = parseFloat(cols[quantityIdx])
    const costPrice = parseFloat(cols[costPriceIdx])
    if (!symbol || !name || isNaN(quantity) || isNaN(costPrice)) continue

    const currentPrice = currentPriceIdx !== -1 && cols[currentPriceIdx]
      ? parseFloat(cols[currentPriceIdx]) : costPrice

    const buyTimestamp = buyDateIdx !== -1 ? parseDate(cols[buyDateIdx]) : null
    const sellTimestamp = sellDateIdx !== -1 ? parseDate(cols[sellDateIdx]) : null
    const sellPrice = sellPriceIdx !== -1 && cols[sellPriceIdx] ? parseFloat(cols[sellPriceIdx]) : currentPrice
    const sellQty = sellQuantityIdx !== -1 && cols[sellQuantityIdx] ? parseFloat(cols[sellQuantityIdx]) : 0

    const fee = feeIdx !== -1 && cols[feeIdx] ? parseFloat(cols[feeIdx]) : 0
    const rawBuyAmount = quantity * costPrice
    const buyAmount = buyTotalIdx !== -1 && cols[buyTotalIdx]
      ? parseFloat(cols[buyTotalIdx])
      : (!isNaN(fee) && fee > 0 ? rawBuyAmount + fee : rawBuyAmount)

    const transactions: Transaction[] = []

    if (buyTimestamp) {
      transactions.push({
        id: `${symbol}-tx-${generateId()}`,
        type: 'buy',
        price: costPrice,
        quantity,
        amount: buyAmount,
        timestamp: buyTimestamp,
        emotion: emotionIdx !== -1 ? resolveEmotion(cols[emotionIdx]) : undefined,
        reasons: reasonIdx !== -1 ? resolveReasons(cols[reasonIdx]) : undefined,
      })
    }

    let actualSellQty = 0
    let sellAmountTotal = 0
    if (sellTimestamp && sellPrice > 0 && sellQty > 0) {
      actualSellQty = sellQty
      const rawSellAmount = sellPrice * sellQty
      sellAmountTotal = sellTotalIdx !== -1 && cols[sellTotalIdx]
        ? parseFloat(cols[sellTotalIdx])
        : (!isNaN(fee) && fee > 0 ? rawSellAmount - fee : rawSellAmount)
      transactions.push({
        id: `${symbol}-tx-${generateId()}`,
        type: 'sell',
        price: sellPrice,
        quantity: sellQty,
        amount: sellAmountTotal,
        timestamp: sellTimestamp,
      })
    }

    positions.push({
      id: `${symbol}-${generateId()}`,
      symbol,
      name,
      costPrice,
      quantity: quantity - actualSellQty,
      currentPrice,
      changePercent: 0,
      transactions,
      totalBuyAmount: buyAmount,
      totalSellAmount: sellAmountTotal,
    })
  }

  if (positions.length === 0) {
    throw new Error('CSV 中没有有效的持仓数据')
  }

  return positions
}

// 查找表头索引（支持多个别名，严格匹配）
function idx(headers: string[], ...names: string[]): number {
  for (const name of names) {
    // 1. 精确匹配
    const i = headers.findIndex(h => h === name)
    if (i !== -1) return i
    // 2. 去除空格后精确匹配（处理 "税费 (元)" vs "税费(元)" 等情况）
    const j = headers.findIndex(h => h.replace(/\s+/g, '') === name.replace(/\s+/g, ''))
    if (j !== -1) return j
  }
  return -1
}

// 从 JSON 导入数据
export function importFromJSON(jsonContent: string): {
  positions: Position[]
  summary?: ProfitSummary
  reviews?: DailyReview[]
  events?: MarketEvent[]
} | null {
  try {
    const data = JSON.parse(jsonContent) as ExportData | ExtendedExportData

    // 验证数据格式
    if (!data.positions || !Array.isArray(data.positions)) {
      throw new Error('Invalid data format')
    }

    const result: {
      positions: Position[]
      summary?: ProfitSummary
      reviews?: DailyReview[]
      events?: MarketEvent[]
    } = {
      positions: data.positions,
      summary: data.summary,
    }

    // 如果有复盘数据，也返回
    if ('reviews' in data && Array.isArray(data.reviews)) {
      result.reviews = data.reviews
    }

    // 如果有事件数据，也返回
    if ('events' in data && Array.isArray(data.events)) {
      result.events = data.events
    }

    return result
  } catch (error) {
    console.error('Failed to import JSON:', error)
    return null
  }
}

// 导入复盘数据（单独）
export function importReviewsData(jsonContent: string): DailyReview[] | null {
  try {
    const data = JSON.parse(jsonContent) as {
      reviews?: DailyReview[]
    }

    if (!data.reviews || !Array.isArray(data.reviews)) {
      throw new Error('Invalid reviews data format')
    }

    return data.reviews
  } catch (error) {
    console.error('Failed to import reviews:', error)
    return null
  }
}

// 保存导入的复盘数据到 localStorage
export async function saveImportedReviews(reviews: DailyReview[]): Promise<boolean> {
  try {
    for (const review of reviews) {
      await reviewService.saveReview(review)
    }
    return true
  } catch (error) {
    console.error('Failed to save reviews:', error)
    return false
  }
}

// 导入事件数据（单独）
export function importEventsData(jsonContent: string): MarketEvent[] | null {
  try {
    const data = JSON.parse(jsonContent) as {
      events?: MarketEvent[]
    }

    if (!data.events || !Array.isArray(data.events)) {
      throw new Error('Invalid events data format')
    }

    return data.events
  } catch (error) {
    console.error('Failed to import events:', error)
    return null
  }
}

// 保存导入的事件数据到 localStorage
export async function saveImportedEvents(events: MarketEvent[]): Promise<boolean> {
  try {
    for (const event of events) {
      await eventService.saveEvent(event)
    }
    return true
  } catch (error) {
    console.error('Failed to save events:', error)
    return false
  }
}

// 下载文件到本地
function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

// 获取日期字符串（格式：YYYY-MM-DD）
function getDateString(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
