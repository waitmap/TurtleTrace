import { useState, useRef, useEffect } from 'react'
import { ChevronDown, RefreshCw, Layers, Check, Settings, Building2, Users, Monitor } from 'lucide-react'
import type { Account } from '../../../types'

interface MobileTopBarProps {
  title: string
  accounts: Account[]
  currentAccountId: string | null
  onAccountChange: (accountId: string | null) => void
  onOpenManager: () => void
  onRefresh?: () => void
  onSwitchToDesktop?: () => void
}

function getAccountIcon(type: string) {
  switch (type) {
    case 'broker': return Building2
    case 'strategy': return Layers
    case 'family': return Users
    default: return Building2
  }
}

export function MobileTopBar({
  title,
  accounts,
  currentAccountId,
  onAccountChange,
  onOpenManager,
  onRefresh,
  onSwitchToDesktop,
}: MobileTopBarProps) {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const currentAccount = currentAccountId
    ? accounts.find(a => a.id === currentAccountId)
    : null

  return (
    <header className="h-12 border-b border-border bg-card flex items-center justify-between px-4 flex-shrink-0">
      <div className="flex items-center gap-2">
        {onSwitchToDesktop && (
          <button
            onClick={onSwitchToDesktop}
            className="p-1.5 rounded-lg text-muted-foreground hover:bg-surface-hover transition-colors"
            title="桌面版"
          >
            <Monitor className="h-4 w-4" />
          </button>
        )}
        <h1 className="text-base font-bold">{title}</h1>
      </div>

      <div className="flex items-center gap-2">
        {onRefresh && (
          <button
            onClick={onRefresh}
            className="p-1.5 rounded-lg text-muted-foreground hover:bg-surface-hover transition-colors"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        )}

        <div className="relative" ref={containerRef}>
          <button
            onClick={() => setIsOpen(!isOpen)}
            className="flex items-center gap-1 px-2 py-1 rounded-lg bg-surface hover:bg-surface-hover transition-colors text-xs"
          >
            {currentAccount ? (
              <>
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: currentAccount.color || '#6b7280' }}
                />
                <span className="font-medium max-w-[72px] truncate">{currentAccount.name}</span>
              </>
            ) : (
              <span className="text-muted-foreground">全部</span>
            )}
            <ChevronDown className={`h-3 w-3 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`} />
          </button>

          {isOpen && (
            <div className="absolute top-full right-0 mt-1 w-48 bg-popover border rounded-lg shadow-lg z-50 py-1">
              <button
                onClick={() => { onAccountChange(null); setIsOpen(false) }}
                className={`w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-surface-hover transition-colors ${
                  currentAccountId === null ? 'bg-primary/10 text-primary' : ''
                }`}
              >
                <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center">
                  <Layers className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
                <span className="flex-1 text-left">全部账户</span>
                {currentAccountId === null && <Check className="h-4 w-4" />}
              </button>
              <div className="my-1 border-t" />
              {accounts.map(account => {
                const Icon = getAccountIcon(account.type)
                const isSelected = currentAccountId === account.id
                return (
                  <button
                    key={account.id}
                    onClick={() => { onAccountChange(account.id); setIsOpen(false) }}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-surface-hover transition-colors ${
                      isSelected ? 'bg-primary/10 text-primary' : ''
                    }`}
                  >
                    <div
                      className="w-6 h-6 rounded-full flex items-center justify-center"
                      style={{ backgroundColor: `${account.color || '#6b7280'}20` }}
                    >
                      <Icon className="h-3.5 w-3.5" style={{ color: account.color || '#6b7280' }} />
                    </div>
                    <span className="flex-1 text-left truncate">{account.name}</span>
                    {isSelected && <Check className="h-4 w-4" />}
                  </button>
                )
              })}
              <div className="my-1 border-t" />
              <button
                onClick={() => { setIsOpen(false); onOpenManager() }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:bg-surface-hover transition-colors"
              >
                <Settings className="h-4 w-4" />
                <span>账户管理</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
