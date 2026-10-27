import { chmodSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { auth, UnauthorizedError, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import type { OAuthClientInformationMixed, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js'
import { paths, readJson } from './store'

type Credentials = { client?: OAuthClientInformationMixed; tokens?: OAuthTokens; verifier?: string; redirect?: string; bearer?: string; headers?: Record<string, string> }
const file = () => path.join(paths.home, 'mcp-credentials.json')
export const credentials = (id: string) => readJson<Record<string, Credentials>>(file(), {})[id] ?? {}
export function saveCredentials(id: string, patch: Partial<Credentials> | null) {
  const all = readJson<Record<string, Credentials>>(file(), {})
  if (patch) all[id] = { ...all[id], ...patch }
  else delete all[id]
  writeFileSync(file(), JSON.stringify(all), { mode: 0o600 }); chmodSync(file(), 0o600)
}

/** Timeout connection headers without timing out a healthy event stream. */
export async function mcpFetch(input: string | URL | Request, init?: RequestInit) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('The server took too long to respond')), 20_000)
  try { return await fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal }) }
  finally { clearTimeout(timer) }
}

export class McpAuth implements OAuthClientProvider {
  #state = crypto.randomUUID()
  #open?: (url: URL) => void
  #cancel?: () => void
  #disposed = false
  constructor(readonly id: string, readonly url: string) {}
  get redirectUrl() { return credentials(this.id).redirect ?? 'http://127.0.0.1:38465/callback' }
  get clientMetadata() { return { client_name: 'Vellum', redirect_uris: [this.redirectUrl], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' as const } }
  state() { return this.#state }
  clientInformation() { return credentials(this.id).client }
  saveClientInformation(client: OAuthClientInformationMixed) { this.#save({ client }) }
  tokens() { return credentials(this.id).tokens }
  saveTokens(tokens: OAuthTokens) { this.#save({ tokens }) }
  saveCodeVerifier(verifier: string) { this.#save({ verifier }) }
  #save(patch: Partial<Credentials>) { if (this.#disposed) throw new Error('This server has been removed'); saveCredentials(this.id, patch) }
  codeVerifier() { const verifier = credentials(this.id).verifier; if (!verifier) throw new Error('Sign in again to create a new authorization session'); return verifier }
  redirectToAuthorization(url: URL) {
    if (!this.#open) throw new UnauthorizedError('Sign in to connect this server')
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) throw new Error('The authorization URL must use HTTPS')
    this.#open(url)
  }
  invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery') {
    if (scope === 'all') saveCredentials(this.id, null)
    else if (scope === 'client') saveCredentials(this.id, { client: undefined })
    else if (scope === 'tokens') saveCredentials(this.id, { tokens: undefined })
    else if (scope === 'verifier') saveCredentials(this.id, { verifier: undefined })
  }
  cancel() { this.#cancel?.() }
  dispose() { this.#disposed = true; this.cancel() }
  async signIn(open: (url: URL) => void) {
    this.cancel()
    this.#state = crypto.randomUUID()
    const controller = new AbortController()
    const fetchAuth: typeof mcpFetch = (input, init) => mcpFetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal })
    let resolve!: () => void, reject!: (error: Error) => void
    const completed = new Promise<void>((yes, no) => { resolve = yes; reject = no })
    // Attach a handler immediately: cancellation can happen during discovery.
    void completed.catch(() => {})
    let exchanging = false
    const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: async (request) => {
      const incoming = new URL(request.url)
      if (request.method !== 'GET' || incoming.pathname !== '/callback' || incoming.searchParams.get('state') !== this.#state) return new Response('Invalid authorization response', { status: 400 })
      if (exchanging) return new Response('Authorization is already being completed', { status: 409 })
      exchanging = true
      try {
        if (incoming.searchParams.has('error')) throw new Error('Sign in was cancelled or refused by the server')
        const code = incoming.searchParams.get('code')
        if (!code) throw new Error('The authorization server did not return a code')
        await auth(this, { serverUrl: this.url, authorizationCode: code, fetchFn: fetchAuth })
        resolve()
        return new Response('Connected to Vellum. You can close this tab.', { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } })
      } catch (error) { reject(error as Error); return new Response('Vellum could not complete sign in. Return to the app to try again.', { status: 400 }) }
    } })
    const redirect = `http://127.0.0.1:${server.port}/callback`
    if (credentials(this.id).redirect !== redirect) saveCredentials(this.id, { client: undefined, redirect })
    this.#open = open
    const fail = (error: Error) => { this.#open = undefined; controller.abort(error); reject(error) }
    this.#cancel = () => fail(new Error('Sign in cancelled'))
    const timer = setTimeout(() => fail(new Error('Sign in timed out. Please try again.')), 10 * 60_000)
    try {
      const result = await auth(this, { serverUrl: this.url, fetchFn: fetchAuth })
      if (result !== 'AUTHORIZED') await completed
    } finally {
      clearTimeout(timer); this.#open = undefined; this.#cancel = undefined
      setTimeout(() => server.stop(true), 100)
    }
  }
}
