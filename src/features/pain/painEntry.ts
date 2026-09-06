export type BodyView = 'front' | 'back'
export type PainEntryStatus = 'active' | 'deleted'

export interface PainLocation {
  view: BodyView
  regionId: string
}

export interface PainEntry {
  id: string
  startedAt: string
  endedAt: string
  locations: PainLocation[]
  intensity: number | null
  qualities: string[]
  cause: string
  occursWhen: string
  note: string
  status: PainEntryStatus
  createdAt: string
  updatedAt: string
}

export interface NewPainEntry {
  startedAt?: string
  endedAt?: string
  locations?: readonly PainLocation[]
  intensity?: number | null
  qualities?: readonly string[]
  cause?: string
  occursWhen?: string
  note?: string
}
