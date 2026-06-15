import { useState, useMemo, useEffect } from 'react'
import { X, AlertCircle } from 'lucide-react'
import { Input } from '../../ui/input'
import { Button } from '../../ui/button'
import type { Position, PositionBatch, Transaction, EmotionTag, ReasonTag } from '../../../types'
import {
  getSellableQuantity,
  calculateBatchSellAllocation,
  calculateBatchProfit,
} from '../../../services/batchService'
import { formatCurrency } from '../../../lib/utils'

interface SellBatchDialogProps {
  open: boolean
  onClose: () => void
  position: Position | null
  batch?: PositionBatch | null
  onConfirm: (transaction: Transaction, allocation: { batchId: string; quantity: number }[]) => void
  emotionTags: EmotionTag[]
  reasonTags: ReasonTag[]
}

export function SellBatchDialog({
  open,
  onClose,
  position,
  batch,
  onConfirm,
  emotionTags,
  reasonTags,
}: SellBatchDialogProps) {
  const todayStr = new Date().toISOString().split('T')[0]
  const [sellQuantity, setSellQuantity] = useState(0)
  const [sellPrice, setSellPrice] = useState(0)
  const [sellDate, setSellDate] = useState(todayStr)
  const [selectedEmotion, setSelectedEmotion] = useState<EmotionTag | undefined>()
  const [selectedReasons, setSelectedReasons] = useState<ReasonTag[]>([])

  // 当 position 变化时更新 sellPrice
  useEffect(() => {
    if (position) {
      setSellPrice(position.currentPrice || 0)
    }
  }, [position])

  const batches = position?.batches || []

  // 可卖数量 - 始终调用 useMemo
  const maxSellable = useMemo(() => {
    if (!position) return 0
    if (batch) {
      return batch.quantity > 0 && !batch.isLocked ? batch.quantity : 0
    }
    return getSellableQuantity(batches)
  }, [position, batch, batches])

  // 卖出分配预览 - 始终调用 useMemo
  const allocation = useMemo(() => {
    if (!position) return []
    if (batch) {
      return [{ batchId: batch.id, quantity: Math.min(sellQuantity, batch.quantity) }]
    }
    return calculateBatchSellAllocation(batches, sellQuantity)
  }, [position, batch, batches, sellQuantity])

  // 计算卖出金额和预估盈亏
  const sellAmount = sellQuantity * sellPrice
  const estimatedProfit = useMemo(() => {
    if (!position) return 0
    let totalCost = 0
    for (const alloc of allocation) {
      const b = batches.find(bb => bb.id === alloc.batchId)
      if (b) {
        totalCost += alloc.quantity * b.costPrice
      }
    }
    return sellAmount - totalCost
  }, [position, allocation, batches, sellAmount])

  // 重置状态
  useEffect(() => {
    if (!open) {
      setSellQuantity(0)
      setSellDate(todayStr)
      setSelectedEmotion(undefined)
      setSelectedReasons([])
    }
  }, [open])

  // 不打开或没有 position 时返回 null（在所有 hooks 之后）
  if (!open || !position) return null

  const handleConfirm = () => {
    if (sellQuantity <= 0 || sellPrice <= 0 || allocation.length === 0) {
      return
    }

    const txTimestamp = sellDate ? new Date(`${sellDate}T00:00:00+08:00`).getTime() : Date.now()
    const transaction: Transaction = {
      id: `tx-${txTimestamp}`,
      type: 'sell',
      price: sellPrice,
      quantity: sellQuantity,
      amount: sellAmount,
      timestamp: txTimestamp,
      emotion: selectedEmotion,
      reasons: selectedReasons.length > 0 ? selectedReasons : undefined,
    }

    onConfirm(transaction, allocation)
    onClose()
  }

  const handleQuantityChange = (value: number) => {
    setSellQuantity(Math.min(value, maxSellable))
  }

  const handleMaxClick = () => {
    setSellQuantity(maxSellable)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Dialog */}
      <div className="relative bg-card rounded-lg shadow-xl w-full max-w-lg mx-4 max-h-[85vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h3 className="text-lg font-semibold">
            卖出 - {position.name} ({position.symbol})
          </h3>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-surface-hover rounded-lg transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* 可卖数量提示 */}
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">可卖数量:</span>
            <span className="font-mono font-medium">{maxSellable} 股</span>
          </div>

          {/* 卖出数量和价格 */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1.5">
                卖出数量 <span className="text-destructive">*</span>
              </label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  value={sellQuantity || ''}
                  onChange={(e) => handleQuantityChange(Number(e.target.value))}
                  placeholder="100"
                  className="font-mono flex-1"
                  step="100"
                />
                <Button variant="outline" size="sm" onClick={handleMaxClick}>
                  全部
                </Button>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">
                卖出价格 <span className="text-destructive">*</span>
              </label>
              <Input
                type="number"
                value={sellPrice || ''}
                onChange={(e) => setSellPrice(Number(e.target.value))}
                placeholder="0.00"
                className="font-mono"
                step="0.01"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">卖出日期</label>
            <Input
              type="date"
              value={sellDate}
              onChange={(e) => setSellDate(e.target.value)}
              className="h-10"
            />
          </div>

          {/* 卖出分配预览 */}
          {allocation.length > 0 && sellQuantity > 0 && (
            <div className="border rounded-lg p-3 space-y-2">
              <div className="text-sm font-medium">卖出分配 (FIFO)</div>
              <div className="space-y-1.5">
                {allocation.map(alloc => {
                  const b = batches.find(bb => bb.id === alloc.batchId)
                  if (!b) return null
                  const { profit } = calculateBatchProfit(b, sellPrice)
                  const allocProfit = (profit / b.quantity) * alloc.quantity

                  return (
                    <div key={alloc.batchId} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        {b.tag && (
                          <span className="px-1.5 py-0.5 bg-primary/10 text-primary text-xs rounded">
                            {b.tag}
                          </span>
                        )}
                        <span className="font-mono">{alloc.quantity}股</span>
                        <span className="text-muted-foreground">@{b.costPrice.toFixed(2)}</span>
                      </div>
                      <span className={`font-mono ${allocProfit >= 0 ? 'text-up' : 'text-down'}`}>
                        {allocProfit >= 0 ? '+' : ''}{formatCurrency(allocProfit)}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* 交易情绪 */}
          {emotionTags.length > 0 && (
            <div>
              <label className="block text-sm font-medium mb-1.5">交易情绪</label>
              <div className="flex flex-wrap gap-2">
                {emotionTags.map(tag => (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => setSelectedEmotion(selectedEmotion?.id === tag.id ? undefined : tag)}
                    className={`px-3 py-1 text-sm rounded-full border transition-colors ${
                      selectedEmotion?.id === tag.id
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border hover:bg-surface-hover'
                    }`}
                  >
                    {tag.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 交易原因 */}
          {reasonTags.length > 0 && (
            <div>
              <label className="block text-sm font-medium mb-1.5">交易原因</label>
              <div className="flex flex-wrap gap-2">
                {reasonTags.map(tag => (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => {
                      setSelectedReasons(prev =>
                        prev.find(t => t.id === tag.id)
                          ? prev.filter(t => t.id !== tag.id)
                          : [...prev, tag]
                      )
                    }}
                    className={`px-3 py-1 text-sm rounded-full border transition-colors ${
                      selectedReasons.find(t => t.id === tag.id)
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border hover:bg-surface-hover'
                    }`}
                  >
                    {tag.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 汇总信息 */}
          {sellQuantity > 0 && sellPrice > 0 && (
            <div className="bg-muted/50 rounded-lg p-3 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">卖出金额</span>
                <span className="font-mono">{formatCurrency(sellAmount)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">预估盈亏</span>
                <span className={`font-mono font-medium ${estimatedProfit >= 0 ? 'text-up' : 'text-down'}`}>
                  {estimatedProfit >= 0 ? '+' : ''}{formatCurrency(estimatedProfit)}
                </span>
              </div>
            </div>
          )}

          {/* 警告信息 */}
          {sellQuantity > maxSellable && (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4" />
              <span>卖出数量超过可卖数量</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-4 py-3 border-t">
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={sellQuantity <= 0 || sellPrice <= 0 || allocation.length === 0}
          >
            确认卖出
          </Button>
        </div>
      </div>
    </div>
  )
}
