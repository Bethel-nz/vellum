// One ACP connection: JSON-RPC 2.0 over a child process's stdio, one message per line
// (agentclientprotocol.com, protocol v1). Agent-agnostic: Claude, Codex and opencode all speak it.
// Types come from @agentclientprotocol/sdk; the transport is ours.

import type { AnyMessage } from '@agentclientprotocol/sdk'

export type RpcError = { code: number; message: string; data?: unknown }

export class RpcFailure extends Error {
  constructor(
    readonly method: string,
    readonly error: RpcError,
  ) {
    super(`${method}: ${error.message}`)
  }
}

type Handlers = {
  /** A request from the agent (permission asks, fs, terminals). Throw an RpcFailure-shaped error to refuse. */
  request(method: string, params: any, id: number | string): Promise<unknown>
  notification(method: string, params: any): void
  /** Every line in both directions, for logs and fixtures. */
  trace?(dir: 'in' | 'out', msg: AnyMessage): void
}

export class AcpConnection {
  readonly proc: ReturnType<typeof Bun.spawn>
  readonly exited: Promise<number>
  #seq = 0
  #pending = new Map<number, { method: string; resolve: (v: any) => void; reject: (e: unknown) => void }>()
  #handlers: Handlers
  #stderr = ''
  #closed = false

  constructor(argv: string[], opts: { cwd: string; env: Record<string, string | undefined> }, handlers: Handlers) {
    this.#handlers = handlers
    this.proc = Bun.spawn(argv, { cwd: opts.cwd, env: opts.env, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe', windowsHide: true })
    this.#read()
    this.#readStderr()
    this.exited = this.proc.exited.then((code) => {
      this.#closed = true
      // Nothing more will answer: settle every request still waiting.
      for (const [, p] of this.#pending) p.reject(new RpcFailure(p.method, { code: -32099, message: `agent exited with code ${code}` }))
      this.#pending.clear()
      return code
    })
  }

  /** The last few lines the agent wrote to stderr. */
  get stderrTail() {
    return this.#stderr.trim().split('\n').slice(-6).join('\n')
  }

  get closed() {
    return this.#closed
  }

  request<T = any>(method: string, params: unknown): Promise<T> {
    const id = ++this.#seq
    return new Promise<T>((resolve, reject) => {
      if (this.#closed) return reject(new RpcFailure(method, { code: -32099, message: 'agent is not running' }))
      this.#pending.set(id, { method, resolve, reject })
      this.#write({ jsonrpc: '2.0', id, method, params } as AnyMessage)
    })
  }

  notify(method: string, params: unknown) {
    this.#write({ jsonrpc: '2.0', method, params } as AnyMessage)
  }

  kill() {
    this.proc.kill()
  }

  #write(msg: AnyMessage) {
    if (this.#closed) return
    this.#handlers.trace?.('out', msg)
    const stdin = this.proc.stdin as import('bun').FileSink
    stdin.write(JSON.stringify(msg) + '\n')
    stdin.flush()
  }

  async #read() {
    const reader = (this.proc.stdout as ReadableStream<Uint8Array>).getReader()
    const decoder = new TextDecoder()
    let buf = ''
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      let nl: number
      while ((nl = buf.indexOf('\n')) >= 0) {
        const raw = buf.slice(0, nl)
        buf = buf.slice(nl + 1)
        if (!raw.trim()) continue
        let msg: any
        try {
          msg = JSON.parse(raw)
        } catch {
          continue
        }
        this.#handlers.trace?.('in', msg)
        this.#dispatch(msg)
      }
    }
  }

  #dispatch(msg: any) {
    if (msg.method === undefined && msg.id !== undefined) {
      const p = this.#pending.get(msg.id)
      if (!p) return
      this.#pending.delete(msg.id)
      if (msg.error) p.reject(new RpcFailure(p.method, msg.error))
      else p.resolve(msg.result)
      return
    }
    if (msg.id === undefined) {
      this.#handlers.notification(msg.method, msg.params)
      return
    }
    this.#handlers.request(msg.method, msg.params, msg.id).then(
      (result) => this.#write({ jsonrpc: '2.0', id: msg.id, result: result ?? null } as AnyMessage),
      (e) => {
        const error: RpcError = e instanceof RpcFailure ? e.error : { code: -32603, message: String(e?.message ?? e) }
        this.#write({ jsonrpc: '2.0', id: msg.id, error } as AnyMessage)
      },
    )
  }

  async #readStderr() {
    const reader = (this.proc.stderr as ReadableStream<Uint8Array>).getReader()
    const decoder = new TextDecoder()
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      this.#stderr = (this.#stderr + decoder.decode(value, { stream: true })).slice(-8000)
    }
  }
}
