export const ACTIVITY_PASTEL_COLORS = [
  '#f6cbd0',
  '#f6d7bd',
  '#f3e2b8',
  '#dfe8bc',
  '#cbe7ca',
  '#c7e8dc',
  '#c6e3ee',
  '#cddbf2',
  '#d8d0ef',
  '#e5cdec',
  '#efcde1',
  '#ead5c7',
] as const

function activityKey(activityName: string): string {
  return activityName.trim().toLocaleLowerCase('de')
}

function hashActivityName(activityName: string): number {
  const key = activityKey(activityName)
  let hash = 2166136261

  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  return hash >>> 0
}

export function defaultActivityColor(activityName: string): string {
  if (!activityName.trim()) return ACTIVITY_PASTEL_COLORS[6]

  return ACTIVITY_PASTEL_COLORS[
    hashActivityName(activityName) % ACTIVITY_PASTEL_COLORS.length
  ]
}

export function normalizeActivityColor(
  value: unknown,
  activityName: string,
): string {
  if (
    typeof value === 'string' &&
    ACTIVITY_PASTEL_COLORS.includes(
      value.toLowerCase() as (typeof ACTIVITY_PASTEL_COLORS)[number],
    )
  ) {
    return value.toLowerCase()
  }

  return defaultActivityColor(activityName)
}

export function sameActivityType(left: string, right: string): boolean {
  return activityKey(left) === activityKey(right)
}
