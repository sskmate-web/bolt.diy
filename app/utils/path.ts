// app/utils/path.ts
// Browser-compatible path utilities

import type { ParsedPath } from 'node:path'
import * as pathBrowserify from 'path-browserify'

/**
 * 브라우저 환경에서 Node의 path API와 동일한 시그니처 제공
 * 사용처는 기존처럼 `import { path } from '~/utils/path'` 또는 '/app/utils/path.ts' 로 사용 가능
 */
export const path = {
  join: (...paths: string[]) => pathBrowserify.join(...paths),
  dirname: (p: string) => pathBrowserify.dirname(p),
  basename: (p: string, ext?: string) => pathBrowserify.basename(p, ext),
  extname: (p: string) => pathBrowserify.extname(p),
  relative: (from: string, to: string) => pathBrowserify.relative(from, to),
  isAbsolute: (p: string): boolean => pathBrowserify.isAbsolute(p),
  normalize: (p: string) => pathBrowserify.normalize(p),
  parse: (p: string): ParsedPath => pathBrowserify.parse(p),
  format: (po: ParsedPath) => pathBrowserify.format(po),
} as const

export type { ParsedPath }