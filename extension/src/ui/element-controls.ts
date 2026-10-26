export const styleProperties = {
  color: 'color', background: 'background-color', opacity: 'opacity',
  font: 'font-family', fontSize: 'font-size', fontWeight: 'font-weight',
  borderRadius: 'border-radius', borderColor: 'border-color', borderWidth: 'border-width',
  width: 'width', height: 'height',
  paddingTop: 'padding-top', paddingRight: 'padding-right', paddingBottom: 'padding-bottom', paddingLeft: 'padding-left',
  marginTop: 'margin-top', marginRight: 'margin-right', marginBottom: 'margin-bottom', marginLeft: 'margin-left',
} as const

export type StyleField = keyof typeof styleProperties
export type ElementStyles = Record<StyleField, string>
export type StyleChange = { before: string; after: string; inline: string; priority: string }

export function readStyles(element: Element): ElementStyles {
  const style = getComputedStyle(element)
  return Object.fromEntries(Object.entries(styleProperties).map(([key, property]) => [key, style.getPropertyValue(property)])) as ElementStyles
}

export function inlineStyle(element: Element): CSSStyleDeclaration | undefined {
  return element instanceof HTMLElement || element instanceof SVGElement ? element.style : undefined
}
