import { useEffect } from 'react'
import { Button } from '../ui/button'
import { Sparkles, AlertTriangle, Loader2, X, RefreshCw } from 'lucide-react'
import ReactMarkdown from 'react-markdown'

interface RebuyAIDialogProps {
  open: boolean
  onClose: () => void
  analysis: string | null
  loading: boolean
  error: string | null
  onRetry?: () => void
  analysisTime?: string | null
}

export function RebuyAIDialog({ open, onClose, analysis, loading, error, onRetry, analysisTime }: RebuyAIDialogProps) {
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    if (open) {
      document.addEventListener('keydown', handleEsc)
    }
    return () => {
      document.removeEventListener('keydown', handleEsc)
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-card rounded-xl shadow-xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="p-4 border-b flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-lg">
              <Sparkles className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h3 className="text-lg font-semibold">AI 智能分析报告</h3>
              <p className="text-sm text-muted-foreground">基于市场数据的智能回购建议</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto p-4">
          {/* Loading 状态 - 只在没有内容时显示 */}
          {loading && !analysis && (
            <div className="flex flex-col items-center justify-center py-16">
              <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
              <p className="text-muted-foreground text-base">AI 正在分析中...</p>
              <p className="text-xs text-muted-foreground mt-1">正在分析市场数据和您的持仓情况</p>
            </div>
          )}

          {/* 错误状态 */}
          {error && !loading && (
            <div className="text-center py-16">
              <AlertTriangle className="h-16 w-16 mx-auto mb-4 text-destructive/50" />
              <p className="text-destructive mb-6">{error}</p>
              {onRetry && (
                <Button variant="outline" onClick={onRetry}>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  重试
                </Button>
              )}
            </div>
          )}

          {/* 成功状态 - Markdown 渲染（流式输出时也会显示） */}
          {analysis && !error && (
            <div className="space-y-4">
              <div className="prose prose-sm max-w-none dark:prose-invert
                prose-headings:text-foreground prose-headings:font-semibold
                prose-h1:text-xl prose-h1:border-b prose-h1:pb-2 prose-h1:mb-4
                prose-h2:text-lg prose-h2:mt-6 prose-h2:mb-3
                prose-h3:text-base prose-h3:mt-4 prose-h3:mb-2
                prose-p:text-foreground prose-p:leading-relaxed
                prose-li:text-foreground prose-li:marker:text-muted-foreground
                prose-strong:text-foreground
                prose-code:text-primary prose-code:bg-primary/10 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-xs
                prose-blockquote:border-primary/30 prose-blockquote:text-muted-foreground
                prose-table:text-sm prose-th:text-foreground prose-th:bg-muted/50 prose-td:text-foreground
              ">
                <ReactMarkdown>{analysis}</ReactMarkdown>
              </div>
              <div className="text-xs text-muted-foreground text-center pt-4 border-t">
                分析完成时间：{analysisTime || new Date().toLocaleString('zh-CN')}
              </div>
            </div>
          )}
        </div>

        {/* 底部按钮 */}
        {analysis && !loading && !error && (
          <div className="p-4 border-t flex justify-end gap-2 shrink-0">
            <Button variant="outline" onClick={onClose}>
              关闭
            </Button>
            {onRetry && (
              <Button onClick={onRetry}>
                <RefreshCw className="h-4 w-4 mr-2" />
                重新分析
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
