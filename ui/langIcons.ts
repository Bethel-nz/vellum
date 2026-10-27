// The stacks a project folder can be, with their real marks. Brand art keeps its own
// colours, so every logo sits on a white field (its own contrast, both materials) — the same
// reason images carry their own outline. Never tinted, never redrawn.
import node from '../assets/brands/lang/nodedotjs.svg' with { type: 'file' }
import deno from '../assets/brands/lang/deno.svg' with { type: 'file' }
import bun from '../assets/brands/lang/bun.svg' with { type: 'file' }
import rust from '../assets/brands/lang/rust.svg' with { type: 'file' }
import go from '../assets/brands/lang/go.svg' with { type: 'file' }
import python from '../assets/brands/lang/python.svg' with { type: 'file' }
import ruby from '../assets/brands/lang/ruby.svg' with { type: 'file' }
import gradle from '../assets/brands/lang/gradle.svg' with { type: 'file' }
import maven from '../assets/brands/lang/apachemaven.svg' with { type: 'file' }
import php from '../assets/brands/lang/php.svg' with { type: 'file' }
import swift from '../assets/brands/lang/swift.svg' with { type: 'file' }
import c from '../assets/brands/lang/c.svg' with { type: 'file' }
import cpp from '../assets/brands/lang/cplusplus.svg' with { type: 'file' }

const files: Record<string, string> = {
  Node: node, Deno: deno, Bun: bun, Rust: rust, Go: go, Python: python, Ruby: ruby,
  Gradle: gradle, Maven: maven, PHP: php, Swift: swift, C: c, 'C++': cpp,
}

/** Data URIs for the bundled language marks (Simple Icons, CC0), keyed by stack name. */
export const langIcons: Record<string, string> = Object.fromEntries(
  await Promise.all(
    Object.entries(files).map(async ([stack, file]) => [
      stack,
      `data:image/svg+xml;base64,${Buffer.from(await Bun.file(file).arrayBuffer()).toString('base64')}`,
    ]),
  ),
)
