/**
 * Next.js E1068 补丁：resolveMetadata 在 await 之后才读 AsyncLocalStorage，
 * 冷启动时会丢上下文抛 InvariantError "Expected workStore to be initialized"
 * （vercel/next.js#96261，官方修复 PR #98198；本仓库锁 16.2.6，升级到含修复
 * 的版本后可删除本脚本与 package.json 里的 postinstall 钩子）。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const targets = [
  'node_modules/next/dist/lib/metadata/resolve-metadata.js',
  'node_modules/next/dist/esm/lib/metadata/resolve-metadata.js',
]

const cjsBefore =
  'const metadataItems = await resolveMetadataItems(tree, searchParams, errorConvention, interpolatedParams, isRuntimePrefetchable);\n    const workStore = _workasyncstorageexternal.workAsyncStorage.getStore();'
const cjsAfter =
  'const workStore = _workasyncstorageexternal.workAsyncStorage.getStore();\n    const metadataItems = await resolveMetadataItems(tree, searchParams, errorConvention, interpolatedParams, isRuntimePrefetchable);'

const esmBefore =
  'const metadataItems = await resolveMetadataItems(tree, searchParams, errorConvention, interpolatedParams, isRuntimePrefetchable);\n    const workStore = workAsyncStorage.getStore();'
const esmAfter =
  'const workStore = workAsyncStorage.getStore();\n    const metadataItems = await resolveMetadataItems(tree, searchParams, errorConvention, interpolatedParams, isRuntimePrefetchable);'

let patched = 0
for (const file of targets) {
  if (!existsSync(file)) continue
  const src = readFileSync(file, 'utf8')
  if (src.includes(esmAfter) || src.includes(cjsAfter.replace(/_workasyncstorageexternal\./g, '')) && src.includes(esmAfter)) {
    continue
  }
  if (src.includes(cjsBefore)) {
    writeFileSync(file, src.replace(cjsBefore, cjsAfter))
    patched++
  } else if (src.includes(esmBefore)) {
    writeFileSync(file, src.replace(esmBefore, esmAfter))
    patched++
  } else if (src.includes('const workStore = workAsyncStorage.getStore();\n    const metadataItems = await') || src.includes('const workStore = _workasyncstorageexternal.workAsyncStorage.getStore();\n    const metadataItems = await')) {
    patched++
  }
}

console.log(`[patch-next-e1068] ${patched}/${targets.length} files patched or already patched`)
