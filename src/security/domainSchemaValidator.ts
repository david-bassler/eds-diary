import { canonicalJson } from './crypto/canonical'

type JsonSchema = Readonly<Record<string, unknown>>

function fail(path: string, message: string): never {
  throw new Error(`${path} ${message}`)
}

function schemaObject(schema: unknown, path: string): JsonSchema {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) fail(path, 'contains an invalid bundled schema.')
  return schema as JsonSchema
}

function matchesType(value: unknown, type: string): boolean {
  switch (type) {
    case 'null': return value === null
    case 'array': return Array.isArray(value)
    case 'object': return value !== null && typeof value === 'object' && !Array.isArray(value)
    case 'number': return typeof value === 'number' && Number.isFinite(value)
    case 'integer': return typeof value === 'number' && Number.isSafeInteger(value)
    case 'string': return typeof value === 'string'
    case 'boolean': return typeof value === 'boolean'
    default: fail('$schema', `uses unsupported type ${type}.`)
  }
}

function deepEqual(left: unknown, right: unknown): boolean {
  return canonicalJson(left as never) === canonicalJson(right as never)
}

function validate(value: unknown, input: unknown, path: string): void {
  const schema = schemaObject(input, path)
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type]
    if (types.some((type) => typeof type !== 'string') || !types.some((type) => matchesType(value, type as string))) fail(path, 'has the wrong type.')
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((candidate) => deepEqual(value, candidate))) fail(path, 'is not an allowed value.')
  if ('const' in schema && !deepEqual(value, schema.const)) fail(path, 'does not equal the required constant.')

  if (typeof value === 'string') {
    const length = [...value].length
    if (typeof schema.minLength === 'number' && length < schema.minLength) fail(path, 'is too short.')
    if (typeof schema.maxLength === 'number' && length > schema.maxLength) fail(path, 'is too long.')
    if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern, 'u').test(value)) fail(path, 'does not match its pattern.')
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail(path, 'must be finite.')
    if (typeof schema.minimum === 'number' && value < schema.minimum) fail(path, 'is below its minimum.')
    if (typeof schema.maximum === 'number' && value > schema.maximum) fail(path, 'is above its maximum.')
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) fail(path, 'has too few items.')
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) fail(path, 'has too many items.')
    if (schema.uniqueItems === true) {
      const seen = new Set<string>()
      for (const item of value) {
        const key = canonicalJson(item as never)
        if (seen.has(key)) fail(path, 'contains duplicate items.')
        seen.add(key)
      }
    }
    if (schema.items !== undefined) value.forEach((item, index) => validate(item, schema.items, `${path}[${index}]`))
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>
    const properties = schema.properties === undefined ? {} : schemaObject(schema.properties, `${path}.properties`)
    if (Array.isArray(schema.required)) for (const key of schema.required) {
      if (typeof key !== 'string') fail(path, 'has an invalid required declaration.')
      if (!Object.prototype.hasOwnProperty.call(record, key)) fail(`${path}.${key}`, 'is required.')
    }
    if (schema.additionalProperties === false) for (const key of Object.keys(record)) {
      if (!Object.prototype.hasOwnProperty.call(properties, key)) fail(`${path}.${key}`, 'is not allowed.')
    }
    for (const [key, childSchema] of Object.entries(properties)) if (Object.prototype.hasOwnProperty.call(record, key)) validate(record[key], childSchema, `${path}.${key}`)
  }
  if (Array.isArray(schema.allOf)) schema.allOf.forEach((child, index) => validate(value, child, `${path}.allOf[${index}]`))
  if (Array.isArray(schema.anyOf)) {
    const valid = schema.anyOf.some((child) => { try { validate(value, child, path); return true } catch { return false } })
    if (!valid) fail(path, 'does not satisfy any allowed schema.')
  }
  if (schema.if !== undefined) {
    let condition = false
    try { validate(value, schema.if, path); condition = true } catch { /* JSON Schema condition did not match. */ }
    if (condition && schema.then !== undefined) validate(value, schema.then, path)
  }
}

function canonicalTimestamp(value: unknown, name: string): void {
  if (typeof value !== 'string') fail(name, 'must be a timestamp.')
  const date = new Date(value)
  if (Number.isNaN(date.valueOf()) || date.toISOString() !== value) fail(name, 'must be a canonical UTC timestamp.')
}

function calendarDate(value: unknown, name: string): void {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(name, 'must be a calendar date.')
  const date = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) fail(name, 'must be a real calendar date.')
}

function minutes(value: string): number { const [hours, mins] = value.split(':').map(Number); return hours * 60 + mins }
function uniqueGerman(values: readonly string[], path: string): void {
  const folded = new Set<string>()
  for (const value of values) {
    const key = value.toLocaleLowerCase('de')
    if (folded.has(key)) fail(path, 'contains case-insensitive duplicate names.')
    folded.add(key)
  }
}

function validateSemantics(schemaId: unknown, value: unknown): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return
  const data = value as Record<string, unknown>
  const timestampFields = schemaId === 'pain-entry/v1' ? ['startedAt', 'createdAt', 'updatedAt']
    : schemaId === 'activity-entry/v1' ? ['createdAt', 'updatedAt']
      : schemaId === 'medication-entry/v1' ? ['takenAt', 'createdAt', 'updatedAt']
        : schemaId === 'medication-prescription/v1' ? ['createdAt', 'updatedAt'] : []
  timestampFields.forEach((field) => canonicalTimestamp(data[field], `record_data.${field}`))
  if (schemaId === 'pain-entry/v1') {
    if (data.endedAt !== '') {
      canonicalTimestamp(data.endedAt, 'record_data.endedAt')
      if (String(data.endedAt) <= String(data.startedAt)) fail('record_data.endedAt', 'must be later than startedAt.')
    }
    const locations = data.locations as Array<Record<string, unknown>>
    const keys = locations.map((location) => `${String(location.view)}\0${String(location.regionId)}`)
    if (new Set(keys).size !== keys.length) fail('record_data.locations', 'contains a duplicate view/regionId pair.')
  } else if (schemaId === 'activity-entry/v1') {
    calendarDate(data.date, 'record_data.date')
    if (data.isOngoing === true && data.endTime !== '') fail('record_data.endTime', 'must be empty for an ongoing activity.')
    if (data.isOngoing === false && (typeof data.endTime !== 'string' || data.endTime === '' || minutes(String(data.startTime)) >= minutes(data.endTime))) fail('record_data.endTime', 'must be later than startTime.')
  } else if (schemaId === 'medication-prescription/v1') calendarDate(data.prescribedOn, 'record_data.prescribedOn')
  else if (schemaId === 'pain-type-settings/v1') uniqueGerman(data.values as string[], 'record_data.values')
  else if (schemaId === 'activity-type-settings/v1') uniqueGerman((data.values as Array<{ name: string }>).map(({ name }) => name), 'record_data.values')
}

/** Strictly validates untrusted remote/backup record data without modifying it. */
export function validateDomainData(schema: unknown, value: unknown): void {
  validate(value, schema, 'record_data')
  validateSemantics(schemaObject(schema, '$schema').$id, value)
}
