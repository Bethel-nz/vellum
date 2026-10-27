/** JSON tree paths and rows, shared by search, paging and keyboard navigation. */
export type JsonKind = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null' | 'other'
export type JsonRow = {
  path: string
  parent?: string
  name: string | number | null
  value: unknown
  type: JsonKind
  level: number
  count: number
  open: boolean
  position: number
  siblings: number
  hidden?: number
}

export function jsonKind(value: unknown): JsonKind {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  const type = typeof value
  return type === 'bigint' ? 'number' : type === 'object' || type === 'string' || type === 'number' || type === 'boolean' ? type : 'other'
}

export const jsonBranch = (type: JsonKind) => type === 'object' || type === 'array'
export const jsonEntries = (value: unknown): [string | number, unknown][] => Array.isArray(value) ? Array.from(value, (item, index) => [index, item]) : value && typeof value === 'object' ? Object.entries(value) : []
export const jsonPath = (parent: string, key: string | number) => typeof key === 'number' ? `${parent}[${key}]` : /^[A-Za-z_$][\w$]*$/.test(key) ? `${parent}.${key}` : `${parent}[${JSON.stringify(key)}]`
export const jsonWithin = (parent: string, path: string) => path === parent || path.startsWith(`${parent}.`) || path.startsWith(`${parent}[`)
export const jsonText = (value: unknown) => typeof value === 'string' ? value : String(value)
export const jsonCopy = (value: unknown) => jsonBranch(jsonKind(value)) ? JSON.stringify(value, null, 2) : jsonText(value)
export const jsonCount = (row: Pick<JsonRow, 'type' | 'count'>) => `${row.count.toLocaleString()} ${row.type === 'array' ? row.count === 1 ? 'item' : 'items' : row.count === 1 ? 'key' : 'keys'}`

export function jsonBranches(data: unknown, root: string, depth = Number.POSITIVE_INFINITY) {
  const out: string[] = []
  const seen = new Set<unknown>()
  const visit = (value: unknown, path: string, level: number) => {
    if (level >= depth || !jsonBranch(jsonKind(value)) || seen.has(value)) return
    seen.add(value)
    out.push(path)
    for (const [key, child] of jsonEntries(value)) visit(child, jsonPath(path, key), level + 1)
    seen.delete(value)
  }
  visit(data, root, 0)
  return out
}

export function searchJson(data: unknown, root: string, needle: string) {
  const matches: string[] = []
  const ancestors = new Set<string>()
  const needed = new Map<string, number>()
  const frames: [string, number][] = []
  const seen = new Set<unknown>()
  const visit = (value: unknown, path: string, name: string | number | null) => {
    if (matches.length >= 2000) return
    const type = jsonKind(value)
    if ((typeof name === 'string' && name.toLowerCase().includes(needle)) || (!jsonBranch(type) && jsonText(value).toLowerCase().includes(needle))) {
      matches.push(path)
      for (const [parent, index] of frames) {
        ancestors.add(parent)
        needed.set(parent, Math.max(needed.get(parent) ?? 0, index + 1))
      }
    }
    if (!jsonBranch(type) || seen.has(value)) return
    seen.add(value)
    for (const [index, [key, child]] of jsonEntries(value).entries()) {
      if (matches.length >= 2000) break
      frames.push([path, index])
      visit(child, jsonPath(path, key), key)
      frames.pop()
    }
    seen.delete(value)
  }
  visit(data, root, null)
  return { matches, ancestors, needed }
}

export function jsonRows(data: unknown, root: string, isOpen: (path: string) => boolean, limitOf: (path: string) => number) {
  const rows: JsonRow[] = []
  const seen = new Set<unknown>()
  const visit = (value: unknown, path: string, name: string | number | null, level: number, parent: string | undefined, position: number, siblings: number) => {
    const circular = jsonBranch(jsonKind(value)) && seen.has(value)
    const type = circular ? 'other' : jsonKind(value)
    const list = jsonBranch(type) ? jsonEntries(value) : []
    const open = jsonBranch(type) && isOpen(path)
    rows.push({ path, parent, name, value: circular ? '[Circular]' : value, type, level, count: list.length, open, position, siblings })
    if (!open) return
    seen.add(value)
    const shown = list.slice(0, limitOf(path))
    const hidden = list.length - shown.length
    const size = shown.length + (hidden ? 1 : 0)
    shown.forEach(([key, child], index) => { visit(child, jsonPath(path, key), key, level + 1, path, index + 1, size) })
    if (hidden) rows.push({ path: `${path}::more`, parent: path, name: null, value: undefined, type: 'other', level: level + 1, count: 0, open: false, position: size, siblings: size, hidden })
    seen.delete(value)
  }
  visit(data, root, null, 1, undefined, 1, 1)
  return rows
}

/** Only objects and arrays become trees; a command's plain text stays readable as text. */
export function parseJsonContainer(text: string | undefined): { data: unknown } | undefined {
  const source = text?.trim()
  if (!source || (source[0] !== '{' && source[0] !== '[')) return
  try {
    const data: unknown = JSON.parse(source)
    if (data !== null && typeof data === 'object') return { data }
  } catch { /* A partial or non-JSON tool result remains plain text. */ }
}
