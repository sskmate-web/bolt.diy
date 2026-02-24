import __buffer_polyfill from 'vite-plugin-node-polyfills/shims/buffer'
globalThis.Buffer = globalThis.Buffer || __buffer_polyfill
import __global_polyfill from 'vite-plugin-node-polyfills/shims/global'
globalThis.global = globalThis.global || __global_polyfill
import __process_polyfill from 'vite-plugin-node-polyfills/shims/process'
globalThis.process = globalThis.process || __process_polyfill

import {
  __export,
  __toESM,
  require_dist,
  require_dist2,
  require_dist3
} from "./chunk-DLS533JF.js";

// app/shims/fast-content-type-parse.ts
var fast_content_type_parse_exports = {};
__export(fast_content_type_parse_exports, {
  default: () => fast_content_type_parse_default,
  parse: () => parse,
  safeParse: () => safeParse
});
var import_dist = __toESM(require_dist());
var import_dist2 = __toESM(require_dist2());
var import_dist3 = __toESM(require_dist3());
var m = (fast_content_type_parse_exports == null ? void 0 : fast_content_type_parse_exports.default) ?? fast_content_type_parse_exports;
var parse = (m == null ? void 0 : m.parse) ?? ((..._args) => {
  throw new Error("fast-content-type-parse.parse is not available at runtime");
});
var safeParse = (m == null ? void 0 : m.safeParse) ?? ((..._args) => {
  throw new Error("fast-content-type-parse.safeParse is not available at runtime");
});
var fast_content_type_parse_default = m;
export {
  fast_content_type_parse_default as default,
  parse,
  safeParse
};
//# sourceMappingURL=fast-content-type-parse.js.map
