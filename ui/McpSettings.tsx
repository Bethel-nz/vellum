import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Button as Base } from '@gpuix/react/button'
import { useIsPresent, type PublicInstance } from '@gpuix/react'
import { Button, Field, Icon, Label, Segmented, Sheet, SheetHeader, Switch } from '../components'
import { Scroll } from '../components/Scroll'
import { AnimatePresence, motion } from '../components/spring'
import { spring, tween, useReducedMotion } from '../components/motion'
import { clipboardText } from '../core/platform'
import { cleanToken, mcp, readTool, toolTokens, type McpServer, type McpStatus, type McpView } from '../core/mcp'
import { font, radiusBase, radiusXl } from './theme'
import { useM } from './kit'
import { mcpCatalog } from './settings/mcp-catalog'
import { McpMark } from './McpMark'

const number = (value: number) => value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value)
const statusNames: Record<McpStatus, string> = { disconnected: 'Disconnected', connecting: 'Connecting', connected: 'Connected', 'needs-auth': 'Needs sign in', authorizing: 'Signing in', error: 'Error' }
const endpoint = (server: McpServer) => { if (server.transport === 'stdio') return `${server.command}${server.args?.length ? ` · ${server.args.length} arguments` : ''}`; try { const url = new URL(server.url!); return `${url.origin}${url.pathname}` } catch { return 'Invalid server URL' } }

export function McpSettings() {
  const m = useM()
  const state = useSyncExternalStore(mcp.subscribe, mcp.getSnapshot)
  const [expanded, setExpanded] = useState<string>()
  const [adding, setAdding] = useState(false)
  const [authorizing, setAuthorizing] = useState<string>()
  const [error, setError] = useState('')
  useEffect(() => { for (const { server, status } of mcp.getSnapshot().servers) if (server.enabled && status === 'disconnected') void mcp.connect(server.id).catch(() => {}) }, [])
  const totals = state.servers.map(view => ({ id: view.server.id, tokens: view.server.enabled && view.status === 'connected' ? view.tools.filter(tool => !view.server.disabledTools.includes(tool.name)).reduce((sum, tool) => sum + toolTokens(tool), 0) : 0, count: view.server.enabled && view.status === 'connected' ? view.tools.filter(tool => !view.server.disabledTools.includes(tool.name)).length : 0 }))
  const tokens = totals.reduce((sum, item) => sum + item.tokens, 0), count = totals.reduce((sum, item) => sum + item.count, 0)
  const run = (operation: () => Promise<unknown>) => { setError(''); void operation().catch(error => setError(error.message)) }
  const authView = state.servers.find(view => view.server.id === authorizing)
  return <>
    <div testId="mcp-servers" style={{ display: 'flex', flexDirection: 'column', borderRadius: radiusXl, borderWidth: 1, borderColor: m.border, backgroundColor: m.popup, overflow: 'hidden' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 9 }}><Icon name="mcp" size={16} /><text style={{ flexGrow: 1, fontSize: 14, lineHeight: 20, color: m.text, fontWeight: 500 }}>MCP servers</text><Button testId="mcp-import-refresh" title="Refresh MCP servers from Codex, Claude and OpenCode" onPress={() => run(() => mcp.refreshLocal())} style={{ width: 28, height: 28 }}><Icon name="refresh" size={13} /></Button><Button testId="mcp-add-server" onPress={() => setAdding(true)} style={{ height: 28, borderRadius: 14, borderWidth: 1, borderColor: m.borderFocused, paddingLeft: 10, paddingRight: 12 }}><Icon name="plus" size={13} /><Label>Add server</Label></Button></div>
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 12 }}><text testId="mcp-context" style={{ flexGrow: 1, fontSize: 12, lineHeight: 18, color: m.textMuted }}>{`${count} tools · ~${number(tokens)} estimated context tokens`}</text><text style={{ fontSize: 10.5, color: m.textMuted }}>Share by server</text></div>
        <div style={{ display: 'flex', flexDirection: 'row', gap: 2, height: 5, borderRadius: 3, overflow: 'hidden', backgroundColor: m.chipBg }}>{totals.filter(item => item.tokens).map((item, index) => <div key={item.id} style={{ width: `${item.tokens / Math.max(1, tokens) * 100}%`, height: 5, backgroundColor: m.accents[index % m.accents.length], opacity: 0.65 }} />)}</div>
      </div>
      {state.servers.map(view => <ServerRow key={view.server.id} view={view} open={expanded === view.server.id} onToggle={() => setExpanded(value => value === view.server.id ? undefined : view.server.id)} onSignIn={() => setAuthorizing(view.server.id)} run={run} />)}
      {!state.servers.length ? <div testId="mcp-empty" style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 20, borderTopWidth: 1, borderColor: m.border }}><text style={{ fontSize: 13, lineHeight: 19, color: m.textUi }}>Connect your first server</text><text style={{ fontSize: 12, lineHeight: 18, color: m.textMuted }}>Add a remote URL or a local command to make its tools available in your notes.</text></div> : null}
    </div>
    {state.importIssues.length ? <text style={{ marginTop: 10, fontSize: 12, lineHeight: 18, color: m.warning }}>{state.importIssues.join(" · ")}</text> : null}
    {error ? <text testId="mcp-error" style={{ marginTop: 10, fontSize: 12, lineHeight: 18, color: m.danger }}>{error}</text> : null}
    <text style={{ marginTop: 12, fontSize: 11.5, lineHeight: 17, color: m.textMuted }}>Global MCP servers come from Codex, Claude and OpenCode. Refresh to pick up changes. Tool lists update on the next message; a disabled tool is blocked immediately. Context estimates come from tool definitions.</text>
    <AddServer open={adding} onClose={() => setAdding(false)} onAdded={id => setExpanded(id)} />
    {authView ? <SignIn view={authView} onClose={() => { if (authView.status === 'authorizing') void mcp.disconnect(authView.server.id); setAuthorizing(undefined) }} /> : null}
  </>
}

function ServerRow({ view, open, onToggle, onSignIn, run }: { view: McpView; open: boolean; onToggle: () => void; onSignIn: () => void; run: (operation: () => Promise<unknown>) => void }) {
  const m = useM()
  const { server, tools, status } = view
  const enabled = tools.filter(tool => !server.disabledTools.includes(tool.name))
  const cost = enabled.reduce((sum, tool) => sum + toolTokens(tool), 0)
  const busy = status === 'connecting' || status === 'authorizing'
  const color = status === 'connected' ? m.success : status === 'error' ? m.danger : status === 'needs-auth' ? m.warning : m.textMuted
  return <div testId={`mcp-server-${server.id}`} style={{ display: 'flex', flexDirection: 'column', borderTopWidth: 1, borderColor: m.border }}>
    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14 }}>
      <McpMark name={server.name} url={server.url} />
      <Base testId={`mcp-toggle-${server.id}`} onClick={onToggle} aria-expanded={open} aria-label={`${server.name} details`} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 12, flexGrow: 1, minWidth: 0, borderRadius: 6, focusVisible: { outlineWidth: 2, outlineColor: m.focusRing, outlineOffset: 2 } }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flexGrow: 1, minWidth: 0 }}><text style={{ fontSize: 13, lineHeight: 18, color: m.text }}>{server.name}</text><div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 5 }}><Icon name={status === 'connected' ? 'circleCheck' : status === 'needs-auth' ? 'lock' : status === 'error' ? 'circleX' : 'circleDot'} size={11} color={color} /><text style={{ fontSize: 11, lineHeight: 15, color }}>{`${server.enabled ? statusNames[status] : 'Paused'} · ${server.transport === 'stdio' ? 'Local' : 'Remote'}`}</text>{server.sources?.length ? <text style={{ fontSize: 10.5, lineHeight: 15, color: m.textMuted }}>{`· ${[...new Set(server.sources.map(source => source.provider))].join(', ')}`}</text> : null}</div></div>
        {status === 'connected' ? <text style={{ fontSize: 11, lineHeight: 16, color: m.textMuted }}>{`${enabled.length} of ${tools.length} tools`}</text> : null}
        {status === 'connected' ? <text style={{ fontSize: 12, lineHeight: 16, color: m.textUi, fontFamily: font.mono }}>{`~${number(cost)}`}</text> : null}
        <Icon name={open ? 'chevronUp' : 'chevronDown'} size={13} />
      </Base>
      {server.enabled && status !== 'connected' ? <Button testId={`mcp-connect-${server.id}`} disabled={busy} onPress={() => status === 'needs-auth' ? onSignIn() : run(() => mcp.connect(server.id))} style={{ height: 27, borderRadius: 14, paddingLeft: 10, paddingRight: 10, borderWidth: 1, borderColor: m.borderFocused }}>{status === 'needs-auth' ? <Icon name="lock" size={12} /> : null}<Label>{busy ? 'Connecting…' : status === 'needs-auth' ? 'Sign in' : status === 'error' ? 'Retry' : 'Connect'}</Label></Button> : null}
    </div>
    <AnimatePresence initial={false}>{open ? <ServerDetails key="details" view={view} run={run} onSignIn={onSignIn} /> : null}</AnimatePresence>
  </div>
}

function ServerDetails({ view, run, onSignIn }: { view: McpView; run: (operation: () => Promise<unknown>) => void; onSignIn: () => void }) {
  const m = useM(), reduced = useReducedMotion(), present = useIsPresent()
  const [height, setHeight] = useState(0)
  const { server, tools, status } = view
  return <motion.div initial={reduced ? false : { height: 0, opacity: 0 }} animate={{ height, opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={tween(spring.smooth)} style={{ position: 'relative', overflow: 'hidden', pointerEvents: 'none', flexShrink: 0 }}>
    <div onLayout={event => setHeight(value => Math.ceil(event.height ?? 0) === value ? value : Math.ceil(event.height ?? 0))} style={{ position: 'absolute', top: 0, left: 0, right: 0, display: 'flex', flexDirection: 'column', gap: 14, paddingLeft: 52, paddingRight: 16, paddingBottom: 16, pointerEvents: present ? 'auto' : 'none' }}>
      {view.error ? <text testId={`mcp-server-error-${server.id}`} style={{ fontSize: 12, lineHeight: 18, color: status === 'needs-auth' ? m.warning : m.danger }}>{view.error}</text> : null}
      {status === 'needs-auth' ? <Button onPress={onSignIn} style={{ alignSelf: 'start' }}><Icon name="lock" size={12} /><Label>Sign in to load tools</Label></Button> : null}
      {tools.length ? <Scroll testId={`mcp-tools-${server.id}`} style={{ maxHeight: 300 }}>{tools.map(tool => <div key={tool.name} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 38, borderBottomWidth: 1, borderColor: m.border }}>
        <text style={{ flexGrow: 1, minWidth: 0, fontSize: 11.5, lineHeight: 17, fontFamily: font.mono, color: server.disabledTools.includes(tool.name) ? m.textMuted : m.textUi, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{tool.name}</text>
        <text style={{ fontSize: 10.5, lineHeight: 16, color: readTool(tool) ? m.textMuted : m.warning }}>{readTool(tool) ? 'Read' : tool.annotations?.readOnlyHint === false ? 'Write' : 'Unknown'}</text>
        <text style={{ width: 36, fontSize: 10.5, lineHeight: 16, color: m.textMuted, fontFamily: font.mono }}>{`~${toolTokens(tool)}`}</text>
        <Switch testId={`mcp-tool-${server.id}-${tool.name}`} label={`${tool.name} enabled`} checked={!server.disabledTools.includes(tool.name)} onChange={value => mcp.toggleTool(server.id, tool.name, value)} />
      </div>)}</Scroll> : status === 'connected' ? <text style={{ fontSize: 12, color: m.textMuted }}>This server has no tools.</text> : null}
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 12 }}><text style={{ flexGrow: 1, fontSize: 12, color: m.textMuted }}>Before a tool runs</text><Segmented pill testId={`mcp-policy-${server.id}`} value={server.policy} onChange={value => mcp.policy(server.id, value)} width={116} options={[{ value: 'ask', label: 'Ask every time' }, { value: 'reads', label: 'Always allow reads' }]} /></div>
      <text style={{ fontSize: 10.5, lineHeight: 16, color: m.textMuted }}>Read/write labels are declared by the server. Unclassified tools always ask.</text>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 12 }}><text style={{ flexGrow: 1, fontSize: 12, color: m.textMuted }}>Available in notes</text><Switch testId={`mcp-enabled-${server.id}`} label={`${server.name} available in notes`} checked={server.enabled} onChange={value => run(() => mcp.enable(server.id, value))} /></div>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 10 }}><text style={{ flexGrow: 1, minWidth: 0, fontSize: 10.5, lineHeight: 16, color: m.textMuted, fontFamily: font.mono, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{endpoint(server)}</text><Button testId={`mcp-remove-${server.id}`} onPress={() => run(() => mcp.remove(server.id))}><Icon name="trash" size={12} /><Label muted>Remove</Label></Button></div>
    </div>
  </motion.div>
}

function AddServer({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: (id: string) => void }) {
  const m = useM()
  const input = useRef<PublicInstance>(null)
  const [stage, setStage] = useState<'browse' | 'configure'>('browse')
  const [query, setQuery] = useState(''), [name, setName] = useState(''), [url, setUrl] = useState(''), [command, setCommand] = useState(''), [args, setArgs] = useState('')
  const [transport, setTransport] = useState<McpServer['transport']>('http')
  const [bearer, setBearer] = useState(''), [env, setEnv] = useState<Record<string, string>>({}), [error, setError] = useState('')
  useEffect(() => { if (open) { setStage('browse'); setQuery(''); setName(''); setUrl(''); setCommand(''); setArgs(''); setBearer(''); setEnv({}); setError(''); setTransport('http') } }, [open])
  const connect = () => {
    try {
      const server = mcp.add({ name, transport, ...(transport === 'stdio' ? { command: command.trim(), args: args.split('\n').filter(Boolean), env } : { url: url.trim(), bearer }) })
      onAdded(server.id); onClose(); void mcp.connect(server.id).catch(() => {})
    } catch (error) { setError((error as Error).message) }
  }
  const pasteToken = async () => { try { const text = cleanToken(await clipboardText()); if (!text) throw new Error('The clipboard is empty'); setBearer(text); setError('') } catch (error) { setError((error as Error).message) } }
  const pasteEnv = async () => {
    try { const values: Record<string, string> = {}; for (const line of (await clipboardText()).split('\n').filter(line => line.trim())) { const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/); if (!match) throw new Error('Use NAME=value, one variable per line'); values[match[1]!] = match[2]! } setEnv(values); setError('') } catch (error) { setError((error as Error).message) }
  }
  return <Sheet open={open} onClose={onClose} width={540} initialFocus={input} testId="mcp-add-dialog">
    <div onKeyDown={event => { if (event.key === 'escape') { event.preventDefault(); event.stopPropagation(); onClose() } }} style={{ display: 'flex', flexDirection: 'column' }}>
      <SheetHeader title="Add a server" onClose={onClose}>{stage === 'configure' ? <Button onPress={() => setStage('browse')} title="Back to servers"><Icon name="chevronLeft" size={13} /></Button> : null}</SheetHeader>
      <Scroll style={{ maxHeight: 470 }} padding={{ left: 20, right: 20, top: 4, bottom: 20 }} gap={14}>
        {stage === 'browse' ? <>
          <Field fieldRef={input} testId="mcp-catalog-search" value={query} onChange={setQuery} placeholder="Search servers…" />
          {mcpCatalog.filter(server => `${server.name} ${server.description}`.toLowerCase().includes(query.toLowerCase())).map(server => <Base key={server.name} testId={`mcp-preset-${server.name.toLowerCase()}`} onClick={() => { setName(server.name); setUrl(server.url); setTransport('http'); setStage('configure') }} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: radiusBase, hover: { backgroundColor: m.hover }, focusVisible: { backgroundColor: m.selected } }}><McpMark name={server.name} url={server.url} /><div style={{ display: 'flex', flexDirection: 'column', gap: 3, flexGrow: 1 }}><text style={{ fontSize: 13, color: m.text }}>{server.name}</text><text style={{ fontSize: 11.5, lineHeight: 17, color: m.textMuted }}>{server.description}</text></div><text style={{ fontSize: 11, color: m.textMuted }}>Remote</text><Icon name="chevronRight" size={13} /></Base>)}
          <div style={{ height: 1, backgroundColor: m.border }} />
          <text style={{ fontSize: 12, color: m.textMuted }}>Or connect your own server</text>
          <div style={{ display: 'flex', flexDirection: 'row', gap: 8 }}><Field testId="mcp-quick-url" value={url} onChange={setUrl} placeholder="https://mcp.example.com/mcp" /><Button testId="mcp-custom-remote" onPress={() => { setTransport('http'); setStage('configure') }} style={{ height: 32 }}><Label>Continue</Label></Button></div>
          <Button testId="mcp-custom-local" onPress={() => { setTransport('stdio'); setStage('configure') }} style={{ alignSelf: 'start', paddingLeft: 0 }}><Icon name="terminalBox" size={13} /><Label muted>Connect a local command</Label></Button>
        </> : <>
          <text style={{ fontSize: 12, color: m.textMuted }}>Name</text><Field testId="mcp-name" value={name} onChange={setName} placeholder="My server" />
          <Segmented testId="mcp-transport" value={transport} onChange={setTransport} width="fill" options={[{ value: 'http', label: 'HTTP' }, { value: 'sse', label: 'SSE' }, { value: 'stdio', label: 'Local command' }]} />
          {transport === 'stdio' ? <>
            <text style={{ fontSize: 12, color: m.textMuted }}>Executable</text><Field testId="mcp-command" value={command} onChange={setCommand} mono placeholder="npx" />
            <text style={{ fontSize: 12, color: m.textMuted }}>Arguments · one per line</text><textarea testId="mcp-args" value={args} onChange={event => setArgs(event.value ?? '')} minRows={3} maxRows={6} style={{ fontSize: 12, fontFamily: font.mono, color: m.text, backgroundColor: m.chipBg, borderRadius: radiusBase, padding: 10 }} />
            <Button onPress={() => void pasteEnv()} style={{ alignSelf: 'start' }}><Icon name="copy" size={12} /><Label muted>{Object.keys(env).length ? `${Object.keys(env).length} environment variables added` : 'Paste environment variables'}</Label></Button>
          </> : <>
            <text style={{ fontSize: 12, color: m.textMuted }}>Server URL</text><Field testId="mcp-url" value={url} onChange={setUrl} mono placeholder="https://mcp.example.com/mcp" />
            <div style={{ display: 'flex', flexDirection: 'row', gap: 8 }}><Button testId="mcp-paste-token" onPress={() => void pasteToken()}><Icon name="lock" size={12} /><Label muted>{bearer ? 'Access token added' : 'Paste an access token'}</Label></Button>{bearer ? <Button onPress={() => setBearer('')} title="Remove access token"><Icon name="x" size={12} /></Button> : null}</div>
            <text style={{ fontSize: 11.5, lineHeight: 17, color: m.textMuted }}>A token is optional. Servers that require browser sign-in offer it after connecting.</text>
            {mcpCatalog.find(server => server.name === name && server.url === url && 'note' in server)?.name === 'Vercel' ? <text style={{ fontSize: 11.5, lineHeight: 17, color: m.textMuted }}>Vercel may restrict access to approved clients.</text> : null}
          </>}
        </>}
        {error ? <text testId="mcp-add-error" style={{ fontSize: 12, lineHeight: 18, color: m.danger }}>{error}</text> : null}
      </Scroll>
      {stage === 'configure' ? <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 8, padding: 16, borderTopWidth: 1, borderColor: m.border }}><Button onPress={onClose}><Label muted>Cancel</Label></Button><Button testId="mcp-add-connect" variant="solid" onPress={connect} style={{ height: 30, borderRadius: 15, paddingLeft: 16, paddingRight: 16 }}><Label variant="solid">Connect</Label></Button></div> : null}
    </div>
  </Sheet>
}

function SignIn({ view, onClose }: { view: McpView; onClose: () => void }) {
  const m = useM()
  const [error, setError] = useState('')
  const busy = view.status === 'authorizing'
  const signIn = async () => { setError(''); try { await mcp.signIn(view.server.id); onClose() } catch (error) { setError((error as Error).message) } }
  const pasteToken = async () => { setError(''); try { await mcp.setToken(view.server.id, await clipboardText()); onClose() } catch (error) { setError((error as Error).message) } }
  return <Sheet open onClose={onClose} width={480} testId="mcp-sign-in">
    <div onKeyDown={event => { if (event.key === 'escape') { event.preventDefault(); event.stopPropagation(); onClose() } }} style={{ display: 'flex', flexDirection: 'column' }}>
      <SheetHeader title={`Sign in to ${view.server.name}`} onClose={onClose} />
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: 28 }}><McpMark name={view.server.name} url={view.server.url} /><text style={{ fontSize: 17, lineHeight: 24, color: m.text, textAlign: 'center' }}>{`Connect ${view.server.name} to Vellum`}</text><text style={{ fontSize: 12, lineHeight: 18, color: m.textMuted, textAlign: 'center' }}>Your browser opens the server’s authorization page so you can sign in and choose the access to grant.</text><text style={{ fontSize: 11, lineHeight: 17, fontFamily: font.mono, color: m.textMuted }}>{endpoint(view.server)}</text><Button disabled={busy} onPress={() => void pasteToken()}><Icon name="lock" size={12} /><Label muted>Paste an access token instead</Label></Button>{error ? <text style={{ fontSize: 12, lineHeight: 18, color: m.danger }}>{error}</text> : null}</div>
      <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 8, padding: 16, borderTopWidth: 1, borderColor: m.border }}><Button onPress={onClose}><Label muted>Cancel</Label></Button><Button testId="mcp-authorize" disabled={busy} variant="solid" onPress={() => void signIn()} style={{ height: 30, borderRadius: 15, paddingLeft: 14, paddingRight: 14 }}><Label variant="solid">{busy ? 'Waiting for browser…' : 'Continue in browser'}</Label></Button></div>
    </div>
  </Sheet>
}
