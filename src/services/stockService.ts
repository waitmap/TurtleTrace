import type { StockQuote } from '../types'

// 东方财富API返回的数据类型
interface EastMoneyResponse {
  data: {
    f43: number  // 最新价
    f44: number  // 最高价
    f45: number  // 最低价
    f46: number  // 开盘价
    f58: string  // 股票名称
    f60?: number // 昨收价（用于计算涨跌幅）
  } | null
}

// 将股票代码转换为东方财富API的secid格式
function convertSymbolToSecId(symbol: string): string {
  let code = symbol
  let market = ''

  if (symbol.includes('.')) {
    const [symbolCode, suffix] = symbol.split('.')
    code = symbolCode
    market = suffix
  } else if (symbol.includes('SH') || symbol.includes('SZ')) {
    const parts = symbol.split(/(SH|SZ)/)
    code = parts[1]
    market = parts[0]
  }

  const marketPrefix = market === 'SH' ? '1' : '0'
  return `${marketPrefix}.${code}`
}

// 将股票代码转换为腾讯行情格式: sh600519 / sz000002
function convertSymbolToTencentFormat(symbol: string): string {
  let code = symbol
  let market = ''

  if (symbol.includes('.')) {
    const [symbolCode, suffix] = symbol.split('.')
    code = symbolCode
    market = suffix.toLowerCase()
  } else if (symbol.toUpperCase().startsWith('SH')) {
    code = symbol.slice(2)
    market = 'sh'
  } else if (symbol.toUpperCase().startsWith('SZ')) {
    code = symbol.slice(2)
    market = 'sz'
  }

  if (!market) {
    if (code.startsWith('60') || code.startsWith('68')) market = 'sh'
    else if (code.startsWith('00') || code.startsWith('30') || code.startsWith('02')) market = 'sz'
  }

  return `${market}${code}`
}

// 从东方财富API获取股票实时行情
async function getStockQuoteFromEastMoney(symbol: string): Promise<StockQuote | null> {
  const secId = convertSymbolToSecId(symbol)
  const url = `https://push2.eastmoney.com/api/qt/stock/get?fltt=2&invt=2&secid=${secId}&fields=f43,f44,f45,f46,f58,f60`

  const response = await fetch(url)
  if (!response.ok) return null

  const result: EastMoneyResponse = await response.json()
  if (!result.data || !result.data.f58) return null

  const { f43: price, f44: high, f45: low, f46: open, f58: name, f60: prevClose } = result.data
  const change = prevClose ? price - prevClose : 0
  const changePercent = prevClose ? (change / prevClose) * 100 : 0

  return {
    symbol,
    name,
    price: Number(price.toFixed(2)),
    change: Number(change.toFixed(2)),
    changePercent: Number(changePercent.toFixed(2)),
    open: Number(open.toFixed(2)),
    high: Number(high.toFixed(2)),
    low: Number(low.toFixed(2)),
    prevClose: Number((prevClose || 0).toFixed(2)),
    volume: 0,
    timestamp: Date.now(),
  }
}

// 从腾讯行情API获取股票实时行情（备用源，东方财富不可用时自动切换）
async function getStockQuoteFromTencent(symbol: string): Promise<StockQuote | null> {
  const tencentCode = convertSymbolToTencentFormat(symbol)
  const url = `https://qt.gtimg.cn/q=${tencentCode}`

  const response = await fetch(url)
  if (!response.ok) return null

  const text = await response.text()

  // 解析腾讯返回的文本格式: v_sh600519="field1~field2~...~fieldN";
  const match = text.match(/"([^"]+)"/)
  if (!match) return null

  const fields = match[1].split('~')
  if (fields.length < 35) return null

  const name = fields[1]
  if (!name) return null

  const price = parseFloat(fields[3])
  const prevClose = parseFloat(fields[4])
  const open = parseFloat(fields[5])
  const high = parseFloat(fields[33])
  const low = parseFloat(fields[34])

  if (isNaN(price) || isNaN(prevClose)) return null

  const change = price - prevClose
  const changePercent = prevClose > 0 ? (change / prevClose) * 100 : 0

  return {
    symbol,
    name,
    price: Number(price.toFixed(2)),
    change: Number(change.toFixed(2)),
    changePercent: Number(changePercent.toFixed(2)),
    open: isNaN(open) ? 0 : Number(open.toFixed(2)),
    high: isNaN(high) ? 0 : Number(high.toFixed(2)),
    low: isNaN(low) ? 0 : Number(low.toFixed(2)),
    prevClose: Number(prevClose.toFixed(2)),
    volume: 0,
    timestamp: Date.now(),
  }
}

// 获取股票实时行情（自动切换备用源）
export async function getStockQuote(symbol: string): Promise<StockQuote | null> {
  try {
    const result = await getStockQuoteFromEastMoney(symbol)
    if (result) return result

    console.warn(`东方财富行情失效，切换到腾讯备用源: ${symbol}`)
    const fallback = await getStockQuoteFromTencent(symbol)
    if (fallback) return fallback

    return null
  } catch (error) {
    // 东方财富出错，尝试腾讯
    try {
      console.warn(`东方财富行情异常，切换到腾讯备用源: ${symbol}`)
      return await getStockQuoteFromTencent(symbol)
    } catch (fallbackError) {
      console.error(`获取股票 ${symbol} 行情失败:`, fallbackError)
      return null
    }
  }
}

// 批量获取股票行情
export async function getStockQuotes(symbols: string[]): Promise<StockQuote[]> {
  const quotes = await Promise.all(
    symbols.map(symbol => getStockQuote(symbol))
  )
  return quotes.filter((q): q is StockQuote => q !== null)
}

// 根据代码获取股票名称（需要调用API）
export async function getStockName(symbol: string): Promise<string | null> {
  const quote = await getStockQuote(symbol)
  return quote?.name || null
}

// 获取支持的股票列表（已废弃，请使用stockDatabase中的数据）
export function getSupportedStocks(): Array<{ symbol: string; name: string }> {
  return []
}

// 从东方财富K线数据计算MA60
async function fetchMa60FromEastMoney(symbol: string): Promise<number | null> {
  const secId = convertSymbolToSecId(symbol)
  const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secId}&fields1=f1,f2,f3&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=101&fqt=1&end=20500101&lmt=120`

  const response = await fetch(url)
  if (!response.ok) return null

  const result = await response.json()
  if (!result.data || !result.data.klines) return null

  const klines: string[] = result.data.klines
  const closes = klines.map((k: string) => {
    const parts = k.split(',')
    return parseFloat(parts[2])
  })

  if (closes.length < 60) {
    const sum = closes.reduce((a: number, b: number) => a + b, 0)
    return Math.round((sum / closes.length) * 100) / 100
  }

  const last60 = closes.slice(-60)
  const sum = last60.reduce((a: number, b: number) => a + b, 0)
  return Math.round((sum / 60) * 100) / 100
}

// 从新浪获取日K线计算MA60（备用源）
async function fetchMa60FromSina(symbol: string): Promise<number | null> {
  const sinaCode = convertSymbolToTencentFormat(symbol)
  const url = `https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=${sinaCode}&scale=240&ma=no&datalen=120`

  const response = await fetch(url)
  if (!response.ok) return null

  const data = await response.json()
  if (!Array.isArray(data) || data.length === 0) return null

  const closes = data
    .map((item: any) => {
      const close = parseFloat(item.close)
      return isNaN(close) ? null : close
    })
    .filter((c: number | null): c is number => c !== null)

  if (closes.length < 60) {
    const sum = closes.reduce((a: number, b: number) => a + b, 0)
    return Math.round((sum / closes.length) * 100) / 100
  }

  const last60 = closes.slice(-60)
  const sum = last60.reduce((a: number, b: number) => a + b, 0)
  return Math.round((sum / 60) * 100) / 100
}

// 获取MA60（自动切换备用源）
export async function fetchMa60(symbol: string): Promise<number | null> {
  try {
    const result = await fetchMa60FromEastMoney(symbol)
    if (result !== null) return result

    console.warn(`东方财富K线失效，切换到新浪备用源: ${symbol}`)
    return await fetchMa60FromSina(symbol)
  } catch (error) {
    try {
      console.warn(`东方财富K线异常，切换到新浪备用源: ${symbol}`)
      return await fetchMa60FromSina(symbol)
    } catch (fallbackError) {
      console.error(`获取 ${symbol} MA60 失败:`, fallbackError)
      return null
    }
  }
}

// 从东方财富获取长期K线数据（最多2500条，约10年日线）
export async function fetchLongTermKLine(symbol: string, days: number = 2500): Promise<number[] | null> {
  const secId = convertSymbolToSecId(symbol)
  const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secId}&fields1=f1,f2,f3&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=101&fqt=1&end=20500101&lmt=${days}`

  const response = await fetch(url)
  if (!response.ok) return null

  const result = await response.json()
  if (!result.data || !result.data.klines) return null

  const klines: string[] = result.data.klines
  const closes = klines.map((k: string) => {
    const parts = k.split(',')
    return parseFloat(parts[2])
  }).filter((c: number) => !isNaN(c))

  return closes.length > 0 ? closes : null
}

// 从新浪获取长期K线数据（最多800条）
async function fetchLongTermKLineFromSina(symbol: string, days: number = 800): Promise<number[] | null> {
  const sinaCode = convertSymbolToTencentFormat(symbol)
  const url = `https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=${sinaCode}&scale=240&ma=no&datalen=${days}`

  const response = await fetch(url)
  if (!response.ok) return null

  const data = await response.json()
  if (!Array.isArray(data) || data.length === 0) return null

  const closes = data
    .map((item: any) => {
      const close = parseFloat(item.close)
      return isNaN(close) ? null : close
    })
    .filter((c: number | null): c is number => c !== null)

  return closes.length > 0 ? closes : null
}

// 获取长期K线数据（东方财富优先，新浪备用）
export async function getLongTermKLine(symbol: string, days: number = 2500): Promise<number[] | null> {
  try {
    const result = await fetchLongTermKLine(symbol, days)
    if (result) return result

    console.warn(`东方财富长期K线失效，切换到新浪备用源: ${symbol}`)
    return await fetchLongTermKLineFromSina(symbol, Math.min(days, 800))
  } catch (error) {
    try {
      console.warn(`东方财富长期K线异常，切换到新浪备用源: ${symbol}`)
      return await fetchLongTermKLineFromSina(symbol, Math.min(days, 800))
    } catch (fallbackError) {
      console.error(`获取 ${symbol} 长期K线失败:`, fallbackError)
      return null
    }
  }
}

// 计算移动平均线
function calculateMA(closes: number[], period: number): number | null {
  if (closes.length < period) {
    if (closes.length === 0) return null
    const sum = closes.reduce((a, b) => a + b, 0)
    return Math.round((sum / closes.length) * 100) / 100
  }
  const lastPeriod = closes.slice(-period)
  const sum = lastPeriod.reduce((a, b) => a + b, 0)
  return Math.round((sum / period) * 100) / 100
}

export interface AllMAData {
  ma60: number | null
  ma120: number | null
  ma250: number | null
  ma500: number | null
  ma1000: number | null
}

// 一次性获取所有均线（只发1次请求）
export async function fetchAllMA(symbol: string): Promise<AllMAData> {
  const empty: AllMAData = { ma60: null, ma120: null, ma250: null, ma500: null, ma1000: null }
  const closes = await getLongTermKLine(symbol, 2500)
  if (!closes) return empty
  return {
    ma60: calculateMA(closes, 60),
    ma120: calculateMA(closes, 120),
    ma250: calculateMA(closes, 250),
    ma500: calculateMA(closes, 500),
    ma1000: calculateMA(closes, 1000),
  }
}
