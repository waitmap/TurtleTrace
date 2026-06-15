import type { RebuyPlan } from '../types'

const STORAGE_KEY = 'turtletrace_rebuy_plans'

interface RebuyPlansStorage {
  version: number
  plans: Record<string, RebuyPlan>
}

const CURRENT_VERSION = 1

function getStorage(): RebuyPlansStorage {
  const saved = localStorage.getItem(STORAGE_KEY)
  if (saved) {
    try {
      return JSON.parse(saved) as RebuyPlansStorage
    } catch {
      console.error('Failed to parse rebuy plans storage')
    }
  }
  return { version: CURRENT_VERSION, plans: {} }
}

function saveStorage(data: RebuyPlansStorage): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
}

export function getRebuyPlan(positionId: string): RebuyPlan | null {
  const storage = getStorage()
  return storage.plans[positionId] || null
}

export function saveRebuyPlan(positionId: string, plan: RebuyPlan): void {
  const storage = getStorage()
  storage.plans[positionId] = plan
  saveStorage(storage)
}

export function deleteRebuyPlan(positionId: string): void {
  const storage = getStorage()
  delete storage.plans[positionId]
  saveStorage(storage)
}

export function getAllRebuyPlans(): Record<string, RebuyPlan> {
  return getStorage().plans
}

export function incrementBatchesExecuted(positionId: string): RebuyPlan | null {
  const storage = getStorage()
  const plan = storage.plans[positionId]
  if (!plan) return null

  plan.batchesExecuted += 1
  saveStorage(storage)
  return plan
}

export function resetBatchesExecuted(positionId: string): void {
  const storage = getStorage()
  const plan = storage.plans[positionId]
  if (plan) {
    plan.batchesExecuted = 0
    saveStorage(storage)
  }
}