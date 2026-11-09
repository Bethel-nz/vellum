import dialkit from 'dialkit/styles.css?inline'
import foundation from './foundation.css?inline'
import panel from './panel.css?inline'
import button from '../arc/button/button.module.css?inline'
import textarea from '../arc/textarea/textarea.module.css?inline'
import checkbox from '../arc/checkbox/checkbox.module.css?inline'
import segmented from '../arc/segmented-control/segmented-control.module.css?inline'

export const shadowStyles = [dialkit, foundation, button, textarea, checkbox, segmented, panel].join('\n')
  .replace(/@import\s*(?:url\([^)]*\)|"[^"]*"|'[^']*')[^;]*;/gi, '')
