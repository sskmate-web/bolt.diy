// app/shims/node-process.ts
import processShim from 'vite-plugin-node-polyfills/shims/process';

export const env = processShim.env;
export default processShim;