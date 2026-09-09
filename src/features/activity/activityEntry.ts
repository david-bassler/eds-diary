export type ActivityEntryStatus = 'active' | 'deleted'

export interface ActivityEntry {
  id: string
  date: string
  startTime: string
  endTime: string
  isOngoing: boolean
  activityName: string
  color: string
  note: string
  status: ActivityEntryStatus
  createdAt: string
  updatedAt: string
}

export interface NewActivityEntry {
  date: string
  startTime: string
  endTime?: string
  isOngoing?: boolean
  activityName: string
  color?: string
  note?: string
}
