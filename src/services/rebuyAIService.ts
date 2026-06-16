import type { Position, RebuyPlan, RebuyScoreData, Transaction } from '../types'
import { calculateRealizedProfit, calculateSafetyCushion } from './rebuyService'

// AI 分析请求数据
interface RebuyAIData {
  stocks: Array<{
    name: string
    symbol: string
    position: {
      currentPrice: number
      costPrice: number
      quantity: number
      totalInvestAmount: number
    }
    safetyCushion: {
      realizedProfit: number
      totalCushion: number
      cushionRate: number
    }
    movingAverages: {
      ma60: number | null
      ma120: number | null
      ma250: number | null
      ma500: number | null
    }
    recentTransactions: Array<{
      type: 'buy' | 'sell'
      price: number
      quantity: number
      amount: number
      timestamp: number
    }>
  }>
}

// 错误码映射
const ERROR_MESSAGES: Record<string, string> = {
  INVALID_API_KEY: 'API Key格式无效，请检查配置',
  API_KEY_INACTIVE: 'API Key已停用',
  API_KEY_EXPIRED: 'API Key已过期',
  FEATURE_NOT_AVAILABLE: '该功能需要升级会员',
  QUOTA_EXCEEDED: '本月配额已用完',
  DAILY_QUOTA_EXCEEDED: '今日请求次数已达上限',
}

/**
 * 收集回购计划 AI 分析所需数据
 * @param positions 持仓列表
 * @param rebuyPlans 回购计划映射表 (positionId -> RebuyPlan)
 * @param scoreData 评分数据映射表 (positionId -> RebuyScoreData)
 * @param maData 均线数据映射表 (positionId -> { ma60, ma120, ma250, ma500 })
 * @returns AI 分析请求数据
 */
export function collectRebuyAIData(
  positions: Position[],
  rebuyPlans: Record<string, RebuyPlan>,
  scoreData: Record<string, RebuyScoreData>,
  maData: Record<string, { ma60: number; ma120: number; ma250: number; ma500: number }>
): RebuyAIData {
  const stocks: RebuyAIData['stocks'] = []

  for (const position of positions) {
    const plan = rebuyPlans[position.id]
    const score = scoreData[position.id]

    // 只处理有回购计划的股票
    if (!plan || !plan.enabled) continue

    // 计算安全垫数据
    const realizedProfit = calculateRealizedProfit(position.transactions)
    const totalCushion = calculateSafetyCushion(position)
    const totalInvestAmount = position.costPrice * position.quantity
    const cushionRate = totalInvestAmount > 0 ? (totalCushion / totalInvestAmount) * 100 : 0

    // 获取均线数据
    const ma = maData[position.id] || { ma60: 0, ma120: 0, ma250: 0, ma500: 0 }

    // 获取最近 5 笔交易记录
    const recentTransactions = getRecentTransactions(position.transactions, 5)

    stocks.push({
      name: position.name,
      symbol: position.symbol,
      position: {
        currentPrice: position.currentPrice,
        costPrice: position.costPrice,
        quantity: position.quantity,
        totalInvestAmount,
      },
      safetyCushion: {
        realizedProfit,
        totalCushion,
        cushionRate,
      },
      movingAverages: {
        ma60: ma.ma60 || null,
        ma120: ma.ma120 || null,
        ma250: ma.ma250 || null,
        ma500: ma.ma500 || null,
      },
      recentTransactions,
    })
  }

  return { stocks }
}

/**
 * 获取最近的交易记录
 * @param transactions 交易记录列表
 * @param count 返回数量
 * @returns 最近交易记录数组
 */
function getRecentTransactions(
  transactions: Transaction[],
  count: number
): Array<{
  type: 'buy' | 'sell'
  price: number
  quantity: number
  amount: number
  timestamp: number
}> {
  return [...transactions]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, count)
    .map(tx => ({
      type: tx.type,
      price: tx.price,
      quantity: tx.quantity,
      amount: tx.amount,
      timestamp: tx.timestamp,
    }))
}

/**
 * 流式调用 AI 服务分析回购计划（DashScope OpenAI 兼容 chat.completions 接口）
 * @param data 回购计划数据
 * @param endpoint API 端点地址（用户配置的 baseURL，如 https://dashscope.aliyuncs.com/compatible-mode/v1）
 * @param apiKey API 密钥
 * @param onChunk 每次收到增量文本时的回调函数
 * @returns 完整的分析文本
 */
export async function analyzeRebuyPlansStream(
  data: RebuyAIData,
  endpoint: string,
  apiKey: string,
  onChunk: (text: string) => void
): Promise<string> {
  if (!endpoint || !apiKey) {
    throw new Error('请先在设置中配置AI服务')
  }

  // 拼接 chat completions 路径
  const baseUrl = endpoint.replace(/\/+$/, '')
  const url = `${baseUrl}/chat/completions`

  // 构建提示词
  const systemPrompt = `你是一位专业的股票投资分析师。请根据以下回购计划数据，对每只股票进行详细的回购时机分析。

## 分析要求

### 1. 个股分析（每只股票）
对每只股票分别给出详细分析，包括：

**时机评估**
- 当前价格与均线位置关系（MA60/120/250/500）
- 是否处于支撑位或压力位
- 趋势方向判断

**安全垫分析**
- 已实现利润情况
- 总安全垫金额和安全垫率
- 下行风险缓冲能力

**风险提示**
- 市场系统性风险
- 个股特有风险
- 技术面风险信号

**操作建议**
- 明确的回购建议（立即回购/分批回购/观望等待）
- 具体操作策略（仓位、价位区间、分批方案）
- 止损或暂停条件

### 2. 整体组合建议
- 整体回购策略（激进/稳健/保守）
- 资金分配优先级排序（哪些股票优先回购）
- 需要重点关注的风险因素
- 未来操作的时间窗口建议

## 返回格式要求
请直接返回纯文本分析报告，使用清晰的段落和标题，不要使用 JSON 格式。
报告结构：
1. 开头总结（一句话概括整体情况）
2. 个股详细分析（每只股票一个小节）
3. 整体组合建议
4. 风险提示

请确保分析专业、具体、可操作。`

  // 构建 OpenAI chat completions 格式的请求体
  const requestBody = {
    model: 'qwen-plus',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `## 数据\n${JSON.stringify(data, null, 2)}` }
    ],
    stream: true,
  }

  console.log('[AI] 请求 URL:', url)
  console.log('[AI] 请求体大小:', JSON.stringify(requestBody).length, '字节')

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestBody),
  })

  console.log('[AI] 响应状态:', response.status, response.statusText)

  if (!response.ok) {
    let errorCode = 'UNKNOWN_ERROR'
    let errorText = ''
    try {
      const errorData = await response.json()
      errorText = JSON.stringify(errorData)
      errorCode = errorData.code || errorData.error?.code || errorCode
    } catch {
      // 无法解析错误响应
    }

    console.error('[AI] 请求失败:', response.status, errorText)

    if (response.status === 401) {
      throw new Error(ERROR_MESSAGES[errorCode] || 'API Key验证失败')
    } else if (response.status === 403) {
      throw new Error(ERROR_MESSAGES[errorCode] || '无权限访问该功能')
    } else if (response.status === 429) {
      throw new Error(ERROR_MESSAGES[errorCode] || '请求过于频繁，请稍后重试')
    }

    throw new Error(ERROR_MESSAGES[errorCode] || `请求失败: ${response.status}`)
  }

  // 处理 SSE 流式响应（OpenAI chat completions 格式）
  const reader = response.body?.getReader()
  if (!reader) {
    throw new Error('无法读取响应流')
  }

  const decoder = new TextDecoder()
  let fullText = ''
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })

    // 按行解析 SSE 数据
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''  // 保留最后一个不完整的行

    for (const line of lines) {
      const trimmed = line.trim()

      if (!trimmed || trimmed.startsWith('event:') || trimmed.startsWith('id:')) {
        continue
      }

      if (trimmed.startsWith('data:')) {
        const dataContent = trimmed.slice(5).trim()

        // 流结束信号
        if (dataContent === '[DONE]') {
          console.log('[AI] 收到 [DONE]，流结束')
          continue
        }

        try {
          const parsed = JSON.parse(dataContent)
          // OpenAI chat completions 格式: choices[0].delta.content
          const content = parsed.choices?.[0]?.delta?.content
          if (content) {
            fullText += content
            onChunk(fullText)
          }
        } catch (e) {
          console.warn('[AI] 解析 SSE 数据失败:', e, dataContent)
        }
      }
    }
  }

  console.log('[AI] 流结束，最终文本长度:', fullText.length)
  return fullText
}
