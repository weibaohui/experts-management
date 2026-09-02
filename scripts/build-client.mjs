/**
 * Build `client/bundle.js` from `client/index.js`.
 *
 * The static-install artifact follows the client-modules bundle protocol:
 * `window.__ModuleLoader__.load({ id, factory })` registers a lazy CommonJS
 * factory that receives a `require` resolving framework modules (react is a
 * platform module; every other dependency is inlined). This script is a thin
 * wrapper: it injects `var React = require("react")` and the module/exports
 * scaffolding, then wraps the dynamic-plugin source verbatim.
 *
 * Run: `npm run build:client`
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const sourcePath = join(here, '..', 'client', 'index.js')
const bundlePath = join(here, '..', 'client', 'bundle.js')

const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'))

const source = readFileSync(sourcePath, 'utf8')

// 共享工具箱内联（@weibaohui/dsh-plugin-kit/client/source.js）：构建期打进
// bundle，kit 升级随消费者重新构建生效；kit 不在时静默跳过（消费者需自行
// 兜底 PluginKit 缺失的分支）
let kitSource = ''
try {
  const { createRequire } = await import('node:module')
  const kitPath = createRequire(import.meta.url).resolve('@weibaohui/dsh-plugin-kit/client/source.js')
  kitSource = readFileSync(kitPath, 'utf8')
} catch { /* kit 未安装：bundle 照常产出，消费者需保证不触发 PluginKit 分支 */ }

const banner = `/* Generated from client/index.js by scripts/build-client.mjs — do not edit by hand.
 * Regenerate with: npm run build:client
 */
window.__ModuleLoader__.load({
  id: ${JSON.stringify(pkg.name)},
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" })
    var React = require("react")
`

const footer = `
    return module.exports
  }
})
`

// The dynamic source references the React global directly; in the static
// bundle the factory's `var React` above satisfies it. Indent the wrapped
// body uniformly for readability of the artifact.
// kit 源同样缩进后注入 factory 顶部（consumer source 之前），供其引用 PluginKit
const kitIndented = kitSource === ''
  ? ''
  : kitSource.split('\n').map((line) => (line.length === 0 ? line : '    ' + line)).join('\n') + '\n'

const indented = source
  .split('\n')
  .map((line) => (line.length === 0 ? line : '    ' + line))
  .join('\n')

writeFileSync(bundlePath, banner + kitIndented + indented + footer)
console.log(`built ${bundlePath} (${Buffer.byteLength(banner + indented + footer, 'utf8')} bytes)`)
