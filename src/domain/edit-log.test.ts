import { describe, expect, it } from 'vitest'
import { assertPlainJson, EditLogValidationError, validateEditLogInput, type EditLogInput } from './edit-log'

function input(overrides: Partial<EditLogInput> = {}): EditLogInput {
  return {
    villageId: 1,
    entityType: 'item-instance',
    entityId: 7,
    itemId: 'test-cannon',
    action: 'update',
    before: { level: 3 },
    after: { level: 4 },
    batchId: null,
    note: null,
    ...overrides
  }
}

function message(fn: () => void): string {
  try {
    fn()
  } catch (error) {
    expect(error).toBeInstanceOf(EditLogValidationError)
    return (error as Error).message
  }
  return 'no error'
}

describe('assertPlainJson', () => {
  it('accepts plain JSON values, including nested objects, arrays and null-prototype objects', () => {
    expect(() =>
      assertPlainJson({ a: 1, b: 'x', c: null, d: true, e: [1, { f: [] }], g: Object.assign(Object.create(null), { h: 2 }) }, 'v')
    ).not.toThrow()
  })

  it('rejects values that JSON.stringify would silently drop or convert', () => {
    const cases: Array<[unknown, string]> = [
      [{ a: undefined }, 'v.a is undefined, which is not JSON'],
      [[1, undefined], 'v[1] is undefined, which is not JSON'],
      [undefined, 'v is undefined, which is not JSON'],
      [{ n: Number.NaN }, 'v.n must be a finite number'],
      [{ n: Number.POSITIVE_INFINITY }, 'v.n must be a finite number'],
      [{ d: new Date(0) }, 'v.d must be a plain object, not Date'],
      [{ m: new Map() }, 'v.m must be a plain object, not Map'],
      [{ s: new Set([1]) }, 'v.s must be a plain object, not Set'],
      [{ f: () => 1 }, 'v.f is function, which is not JSON'],
      [{ s: Symbol('x') }, 'v.s is symbol, which is not JSON'],
      [{ b: BigInt(1) }, 'v.b is bigint, which is not JSON'],
      [{ [Symbol('k')]: 1 }, 'v has symbol keys, which are not JSON'],
      [[1, , 3], 'v[1] is an empty slot']
    ]
    for (const [value, expected] of cases) {
      expect(message(() => assertPlainJson(value, 'v'))).toBe(expected)
    }
  })

  it('rejects class instances and cycles, but allows the same object twice without a cycle', () => {
    class Thing {
      x = 1
    }
    expect(message(() => assertPlainJson({ t: new Thing() }, 'v'))).toBe('v.t must be a plain object, not Thing')
    const cyclic: Record<string, unknown> = {}
    cyclic['self'] = cyclic
    expect(message(() => assertPlainJson(cyclic, 'v'))).toBe('v.self contains a circular reference')
    const shared = { level: 1 }
    expect(() => assertPlainJson({ a: shared, b: shared }, 'v')).not.toThrow()
  })
})

describe('validateEditLogInput', () => {
  it('accepts a valid entry', () => {
    expect(() => validateEditLogInput(input())).not.toThrow()
    expect(() => validateEditLogInput(input({ entityType: 'builders', entityId: null, itemId: null, action: 'set-count', before: 2, after: 3 }))).not.toThrow()
  })

  it('enforces create and delete shapes and requires a state', () => {
    expect(message(() => validateEditLogInput(input({ action: 'create' })))).toBe('a create entry has no before state')
    expect(message(() => validateEditLogInput(input({ action: 'delete' })))).toBe('a delete entry has no after state')
    expect(message(() => validateEditLogInput(input({ before: null, after: null })))).toBe('an entry needs a before or an after state')
    expect(() => validateEditLogInput(input({ action: 'create', before: null }))).not.toThrow()
    expect(() => validateEditLogInput(input({ action: 'delete', after: null }))).not.toThrow()
  })

  it('rejects undefined states instead of treating them as null', () => {
    expect(message(() => validateEditLogInput(input({ before: undefined as never })))).toBe(
      'before and after must be given (use null for none)'
    )
    expect(message(() => validateEditLogInput(input({ after: { level: undefined } as never })))).toBe(
      'after.level is undefined, which is not JSON'
    )
  })

  it('validates ids, item ids, batch ids and notes', () => {
    expect(message(() => validateEditLogInput(input({ villageId: 0 })))).toBe('villageId must be a positive integer')
    expect(message(() => validateEditLogInput(input({ entityId: 1.5 })))).toBe('entityId must be null or a positive integer')
    expect(message(() => validateEditLogInput(input({ itemId: 'Cannon' })))).toBe('itemId must be null or a catalogue item id')
    expect(message(() => validateEditLogInput(input({ entityType: 'wall' as never })))).toBe('entityType is invalid')
    expect(message(() => validateEditLogInput(input({ action: 'rename' as never })))).toBe('action is invalid')
    expect(message(() => validateEditLogInput(input({ batchId: '' })))).toBe('batchId must be null or 1-64 characters')
    expect(message(() => validateEditLogInput(input({ batchId: 'x'.repeat(65) })))).toBe('batchId must be null or 1-64 characters')
    expect(message(() => validateEditLogInput(input({ note: '   ' })))).toBe('note must be null or non-empty text')
    expect(message(() => validateEditLogInput(input({ note: 'x'.repeat(501) })))).toBe('note must be at most 500 characters')
  })
})
