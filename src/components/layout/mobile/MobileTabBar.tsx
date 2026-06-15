import { LayoutDashboard, TrendingUp, RefreshCw, Newspaper, Building2, Settings } from 'lucide-react'

type TabId = 'overview' | 'positions' | 'rebuy' | 'news' | 'accounts' | 'data'

interface MobileTabBarProps {
  activeTab: TabId
  onTabChange: (tab: TabId) => void
}

const tabs: { id: TabId; icon: typeof LayoutDashboard }[] = [
  { id: 'overview', icon: LayoutDashboard },
  { id: 'positions', icon: TrendingUp },
  { id: 'rebuy', icon: RefreshCw },
  { id: 'news', icon: Newspaper },
  { id: 'accounts', icon: Building2 },
  { id: 'data', icon: Settings },
]

export function MobileTabBar({ activeTab, onTabChange }: MobileTabBarProps) {
  return (
    <nav className="fixed bottom-0 left-0 right-0 h-14 bg-card border-t border-border flex items-center justify-around px-2 z-50 pb-safe">
      {tabs.map(tab => {
        const Icon = tab.icon
        const isActive = activeTab === tab.id
        return (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`flex items-center justify-center w-12 h-10 rounded-full transition-colors ${
              isActive
                ? 'text-primary bg-primary/10'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Icon className="h-5 w-5" />
          </button>
        )
      })}
    </nav>
  )
}
