import { useState, useEffect, useCallback, useRef } from 'react'
import { PositionManager } from './components/dashboard/PositionManager'
import { ProfitDashboard } from './components/dashboard/ProfitDashboard'
import { DataExport } from './components/dashboard/DataExport'
import { RebuyDashboard } from './components/dashboard/RebuyDashboard'
import { AccountManager } from './components/dashboard/AccountManager'
import { MobileTabBar } from './components/layout/mobile/MobileTabBar'
import { MobileTopBar } from './components/layout/mobile/MobileTopBar'
import type { Position, ProfitSummary } from './types'
import type { Account } from './types/account'
import { calculateProfitSummary, calculateClearedProfit } from './utils/calculations'
import {
  getAccounts,
  getLastActiveAccount,
  setLastActiveAccount,
  getPositions,
  initializeAccountSystem,
} from './services/accountService'

type TabId = 'overview' | 'positions' | 'rebuy' | 'add' | 'accounts' | 'data'

const pageTitles: Record<TabId, string> = {
  overview: '总览',
  positions: '持仓管理',
  rebuy: '回购计划',
  add: '补仓计划',
  accounts: '账户管理',
  data: '设置',
}

interface MobileAppProps {
  onSwitchToDesktop: () => void
}

export function MobileApp({ onSwitchToDesktop }: MobileAppProps) {
  const prevPositionsRef = useRef<string | null>(null)

  const [positions, setPositions] = useState<Position[]>([])
  const [allPositions, setAllPositions] = useState<Position[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [currentAccountId, setCurrentAccountId] = useState<string | null>(null)
  const [showClearedProfitCard, setShowClearedProfitCard] = useState(true)
  const [summary, setSummary] = useState<ProfitSummary>({
    totalCost: 0,
    totalValue: 0,
    totalProfit: 0,
    totalProfitPercent: 0,
    positions: [],
  })
  const [activeTab, setActiveTab] = useState<TabId>('overview')

  useEffect(() => {
    const { migrated } = initializeAccountSystem()
    if (migrated) {
      console.log('Data migrated to multi-account structure')
    }
    const loadedAccounts = getAccounts()
    setAccounts(loadedAccounts)
    const lastActive = getLastActiveAccount()
    setCurrentAccountId(lastActive.id)
    const loadedPositions = getPositions()
    setAllPositions(loadedPositions)
  }, [])

  useEffect(() => {
    if (currentAccountId === null) {
      setPositions(allPositions)
    } else {
      setPositions(allPositions.filter(p => p.accountId === currentAccountId))
    }
  }, [currentAccountId, allPositions])

  useEffect(() => {
    const newSummary = calculateProfitSummary(positions)
    const clearedProfit = calculateClearedProfit(positions) ?? undefined
    setSummary({
      ...newSummary,
      clearedProfit,
    })
  }, [positions])

  const handleAccountChange = useCallback((accountId: string | null) => {
    setCurrentAccountId(accountId)
    if (accountId) {
      setLastActiveAccount(accountId)
    }
    setAccounts(getAccounts())
  }, [])

  const handleOpenAccountManager = useCallback(() => {
    setActiveTab('accounts')
  }, [])

  const handleAccountChangeRefresh = useCallback(() => {
    setAccounts(getAccounts())
    setAllPositions(getPositions())
  }, [])

  const handlePositionsChange = useCallback((newPositions: Position[]) => {
    const targetAccountId = currentAccountId || accounts.find(a => a.isDefault)?.id
    let merged: Position[]
    if (currentAccountId === null) {
      const otherAccountPositions = allPositions.filter(
        p => p.accountId !== targetAccountId
      )
      const updatedPositions = newPositions.map(p => ({
        ...p,
        accountId: targetAccountId || p.accountId,
      }))
      merged = [...otherAccountPositions, ...updatedPositions]
    } else {
      const otherAccountPositions = allPositions.filter(p => p.accountId !== currentAccountId)
      const updatedPositions = newPositions.map(p => ({
        ...p,
        accountId: currentAccountId,
      }))
      merged = [...otherAccountPositions, ...updatedPositions]
    }
    setAllPositions(merged)
    localStorage.setItem('stock-positions', JSON.stringify(merged))
  }, [currentAccountId, allPositions, accounts])

  useEffect(() => {
    const currentData = JSON.stringify(allPositions)
    if (allPositions.length > 0) {
      localStorage.setItem('stock-positions', currentData)
      prevPositionsRef.current = currentData
    }
  }, [allPositions])

  const handleImportPositions = (importedPositions: Position[]) => {
    const accountId = currentAccountId || accounts.find(a => a.isDefault)?.id
    const positionsWithAccount = importedPositions.map(p => ({
      ...p,
      accountId: accountId || p.accountId,
    }))
    setAllPositions(positionsWithAccount)
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <MobileTopBar
        title={pageTitles[activeTab]}
        accounts={accounts}
        currentAccountId={currentAccountId}
        onAccountChange={handleAccountChange}
        onOpenManager={handleOpenAccountManager}
        onSwitchToDesktop={onSwitchToDesktop}
      />

      <main className="flex-1 overflow-y-auto px-4 py-4 pb-16 scrollbar-thin">
        {activeTab === 'overview' && (
          <ProfitDashboard
            summary={summary}
            showClearedProfitCard={showClearedProfitCard}
            onToggleClearedProfitCard={() => setShowClearedProfitCard(!showClearedProfitCard)}
            positions={positions}
          />
        )}

        {activeTab === 'positions' && (
          <PositionManager
            positions={positions}
            onPositionsChange={handlePositionsChange}
            currentAccountId={currentAccountId}
          />
        )}

        {activeTab === 'rebuy' && (
          <RebuyDashboard positions={positions} mode="rebuy" />
        )}

        {activeTab === 'add' && (
          <RebuyDashboard positions={positions} mode="add" />
        )}

        {activeTab === 'accounts' && (
          <AccountManager
            onAccountChange={handleAccountChangeRefresh}
          />
        )}

        {activeTab === 'data' && (
          <DataExport
            positions={allPositions}
            summary={summary}
            onImport={handleImportPositions}
          />
        )}
      </main>

      <MobileTabBar
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />
    </div>
  )
}
