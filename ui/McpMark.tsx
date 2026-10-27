import figma from '../assets/brands/mcp/figma.svg' with { type: 'text' }
import github from '../assets/brands/mcp/github.svg' with { type: 'text' }
import heroui from '../assets/brands/mcp/heroui.svg' with { type: 'text' }
import linear from '../assets/brands/mcp/linear.svg' with { type: 'text' }
import mcp from '../assets/brands/mcp/mcp.svg' with { type: 'text' }
import mobbin from '../assets/brands/mcp/mobbin.svg' with { type: 'text' }
import notion from '../assets/brands/mcp/notion.svg' with { type: 'text' }
import solana from '../assets/brands/mcp/solana.svg' with { type: 'text' }
import vercel from '../assets/brands/mcp/vercel.svg' with { type: 'text' }
import { useM } from './kit'

const brands = {
  linear: { source: linear, host: 'linear.app', color: '#7772ec' },
  notion: { source: notion, host: 'notion.com' },
  figma: { source: figma, host: 'figma.com' },
  vercel: { source: vercel, host: 'vercel.com' },
  github: { source: github, host: 'github.com' },
  mobbin: { source: mobbin, host: 'mobbin.com' },
  solana: { source: solana, host: 'solana.com' },
  heroui: { source: heroui, host: 'heroui.com' },
} satisfies Record<string, { source: string; host: string; color?: string }>

/** Bundled vendor vectors; never fetch arbitrary icons or favicons from a server. */
export function McpMark({ name, url, size = 20 }: { name: string; url?: string; size?: number }) {
  const m = useM()
  let host = ''
  try { host = new URL(url ?? '').hostname } catch {}
  const brand = Object.entries(brands).find(([key, value]) => host ? host === value.host || host.endsWith(`.${value.host}`) : name.toLowerCase().replace(/[^a-z0-9]/g, '').startsWith(key))?.[1]
  return <div testId={`mcp-mark-${name.toLowerCase()}`} role="img" aria-label={name} style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
    {brand
      ? <svg source={brand.source} style={{ width: size, height: size, color: 'color' in brand ? brand.color : m.textUi }} />
      : <svg source={mcp} style={{ width: size, height: size, color: m.textUi }} />}
  </div>
}
