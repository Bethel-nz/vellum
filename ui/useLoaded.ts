// A read from disk as a component renders: undefined until the read lands, then its value.
// A newer read wins over an older one that's still on its way.
import { useEffect, useState, type DependencyList } from 'react'

export function useLoaded<T>(load: () => Promise<T>, deps: DependencyList): T | undefined {
  const [value, setValue] = useState<T>()
  useEffect(() => {
    let current = true
    load().then(
      (v) => current && setValue(() => v),
      () => current && setValue(undefined),
    )
    return () => {
      current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return value
}
