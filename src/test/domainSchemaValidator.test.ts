import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { validateDomainData } from '../security/domainSchemaValidator'

const schema = (name: string): unknown => JSON.parse(readFileSync(`src/security/schemas/${name}.schema.json`, 'utf8'))
const timestamp = '2026-09-15T12:00:00.000Z'
const pain = {
  startedAt: timestamp, endedAt: '', locations: [{ view: 'front', regionId: 'knee', detailRegionIds: ['left'] }],
  intensity: 5, qualities: ['aching'], cause: '', occursWhen: '', note: '', createdAt: timestamp, updatedAt: timestamp,
}
const activity = { date: '2026-09-15', startTime: '10:00', endTime: '11:00', isOngoing: false, activityName: 'Walk', color: '#cbe7ca', note: '', createdAt: timestamp, updatedAt: timestamp }

describe('normative domain schema validation', () => {
  it('validates nested structures and rejects missing, extra, duplicate, and wrongly typed values', () => {
    expect(() => validateDomainData(schema('pain-entry.v1'), pain)).not.toThrow()
    expect(() => validateDomainData(schema('pain-entry.v1'), { ...pain, note: undefined })).toThrow(/wrong type/)
    expect(() => validateDomainData(schema('pain-entry.v1'), { ...pain, extra: true })).toThrow(/not allowed/)
    expect(() => validateDomainData(schema('pain-entry.v1'), { ...pain, locations: [{ view: 'front', regionId: 'knee', extra: true }] })).toThrow(/not allowed/)
    expect(() => validateDomainData(schema('pain-entry.v1'), { ...pain, qualities: ['same', 'same'] })).toThrow(/duplicate/)
  })

  it('enforces limits, real dates, canonical timestamps, intervals, and location identity', () => {
    expect(() => validateDomainData(schema('pain-entry.v1'), { ...pain, note: 'x'.repeat(2001) })).toThrow(/too long/)
    expect(() => validateDomainData(schema('pain-entry.v1'), { ...pain, createdAt: '2026-09-15T12:00:00Z' })).toThrow()
    expect(() => validateDomainData(schema('pain-entry.v1'), { ...pain, endedAt: timestamp })).toThrow(/later/)
    expect(() => validateDomainData(schema('pain-entry.v1'), { ...pain, locations: [{ view: 'front', regionId: 'knee' }, { view: 'front', regionId: 'knee', detailRegionIds: ['x'] }] })).toThrow(/duplicate view/)
    expect(() => validateDomainData(schema('activity-entry.v1'), { ...activity, date: '2025-02-29' })).toThrow(/real calendar/)
    expect(() => validateDomainData(schema('activity-entry.v1'), { ...activity, endTime: '09:59' })).toThrow(/later/)
    expect(() => validateDomainData(schema('activity-entry.v1'), { ...activity, isOngoing: true })).toThrow()
  })

  it('rejects invalid colors and German case-insensitive duplicates', () => {
    expect(() => validateDomainData(schema('activity-entry.v1'), { ...activity, color: '#ffffff' })).toThrow(/allowed value/)
    expect(() => validateDomainData(schema('pain-type-settings.v1'), { values: ['Ärger', 'ärger'] })).toThrow(/case-insensitive/)
    expect(() => validateDomainData(schema('activity-type-settings.v1'), { values: [{ name: 'Gehen', color: '#cbe7ca' }, { name: 'gehen', color: '#c6e3ee' }] })).toThrow(/case-insensitive/)
  })
})
