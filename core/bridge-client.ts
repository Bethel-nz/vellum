// Requests to the desktop bridge at its endpoint: `unix:/path` (macOS, Linux) or a loopback URL (Windows).
export function bridgeFetch(endpoint: string, route: string, init: RequestInit = {}): Promise<Response> {
  if (endpoint.startsWith('unix:')) return fetch(`http://vellum${route}`, { ...init, unix: endpoint.slice('unix:'.length) })
  return fetch(`${endpoint}${route}`, init)
}
