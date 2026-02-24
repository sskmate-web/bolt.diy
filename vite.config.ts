// vite.config.ts
import { cloudflareDevProxyVitePlugin as remixCloudflareDevProxy, vitePlugin as remixVitePlugin } from '@remix-run/dev';
import UnoCSS from 'unocss/vite';
import { defineConfig, type ViteDevServer } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { optimizeCssModules } from 'vite-plugin-optimize-css-modules';
import tsconfigPaths from 'vite-tsconfig-paths';
import * as dotenv from 'dotenv';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config();

// Get detailed git info with fallbacks
const getGitInfo = () => {
  try {
    return {
      commitHash: execSync('git rev-parse --short HEAD').toString().trim(),
      branch: execSync('git rev-parse --abbrev-ref HEAD').toString().trim(),
      commitTime: execSync('git log -1 --format=%cd').toString().trim(),
      author: execSync('git log -1 --format=%an').toString().trim(),
      email: execSync('git log -1 --format=%ae').toString().trim(),
      remoteUrl: execSync('git config --get remote.origin.url').toString().trim(),
      repoName: execSync('git config --get remote.origin.url')
        .toString()
        .trim()
        .replace(/^.*github.com[:/]/, '')
        .replace(/\.git$/, ''),
    };
  } catch {
    return {
      commitHash: 'no-git-info',
      branch: 'unknown',
      commitTime: 'unknown',
      author: 'unknown',
      email: 'unknown',
      remoteUrl: 'unknown',
      repoName: 'unknown',
    };
  }
};

// Read package.json with detailed dependency info
const getPackageJson = () => {
  try {
    const pkgPath = join(process.cwd(), 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));

    return {
      name: pkg.name,
      description: pkg.description,
      license: pkg.license,
      dependencies: pkg.dependencies || {},
      devDependencies: pkg.devDependencies || {},
      peerDependencies: pkg.peerDependencies || {},
      optionalDependencies: pkg.optionalDependencies || {},
    };
  } catch {
    return {
      name: 'bolt.diy',
      description: 'A DIY LLM interface',
      license: 'MIT',
      dependencies: {},
      devDependencies: {},
      peerDependencies: {},
      optionalDependencies: {},
    };
  }
};

const pkg = getPackageJson();
const gitInfo = getGitInfo();
const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig((config) => {
  return {
    /** ✅ 의존성 최적화 캐시 디렉토리 분리 */
    cacheDir: '.vite-bolt',

    define: {
      __COMMIT_HASH: JSON.stringify(gitInfo.commitHash),
      __GIT_BRANCH: JSON.stringify(gitInfo.branch),
      __GIT_COMMIT_TIME: JSON.stringify(gitInfo.commitTime),
      __GIT_AUTHOR: JSON.stringify(gitInfo.author),
      __GIT_EMAIL: JSON.stringify(gitInfo.email),
      __GIT_REMOTE_URL: JSON.stringify(gitInfo.remoteUrl),
      __GIT_REPO_NAME: JSON.stringify(gitInfo.repoName),
      __APP_VERSION: JSON.stringify(process.env.npm_package_version),
      __PKG_NAME: JSON.stringify(pkg.name),
      __PKG_DESCRIPTION: JSON.stringify(pkg.description),
      __PKG_LICENSE: JSON.stringify(pkg.license),
      __PKG_DEPENDENCIES: JSON.stringify(pkg.dependencies),
      __PKG_DEV_DEPENDENCIES: JSON.stringify(pkg.devDependencies),
      __PKG_PEER_DEPENDENCIES: JSON.stringify(pkg.peerDependencies),
      __PKG_OPTIONAL_DEPENDENCIES: JSON.stringify(pkg.optionalDependencies),
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV),
    },

    server: {
      host: '127.0.0.1',
      port: 5174,
      strictPort: true,
      hmr: {
        overlay: true, // 디버깅 편의를 위해 오버레이 유지(원하면 false로)
      },
    },

    build: {
      target: 'esnext',
      rollupOptions: {
        output: {
          format: 'esm',
        },
      },
      commonjsOptions: {
        transformMixedEsModules: true,
      },
    },

    resolve: {
      alias: {
        // ✅ 브라우저 코드에서 'path' 사용 시 polyfill로 대체
        path: 'path-browserify',
        // 기존: buffer polyfill alias
        buffer: 'vite-plugin-node-polyfills/polyfills/buffer',

        // ✅ 중요 1: fast-content-type-parse 경고 제거 — 절대 경로 alias
        'fast-content-type-parse': resolve(__dirname, 'app/shims/fast-content-type-parse.ts'),

        // ✅ 중요 2: Rollup이 기대하는 named export(`env`) 제공 — 래퍼로 매핑
        'node:process': resolve(__dirname, 'app/shims/node-process.ts'),

        // ⭐️ jszip/file-saver UMD로 새는 경로를 ESM 엔트리로 우회
        'jszip/dist/jszip.min.js': 'jszip',
        'jszip/dist/jszip.js': 'jszip',
        'file-saver/dist/FileSaver.min.js': 'file-saver',
      },
      dedupe: ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
    },

    /** ✅ 의존성 최적화 안정화 */
    optimizeDeps: {
      // 프리번들을 매번 새로 — 캐시 이슈 있을 때 유용
      force: true,

      esbuildOptions: {
        define: {
          global: 'globalThis',
        },
      },

      /** 충돌 잦은 패키지는 제외하여 직접 ESM 로딩 */
      exclude: [
        '@webcontainer/api',
        'isomorphic-git',
        'isomorphic-git/http/web',
        '@octokit/rest',
        // 'jszip',         // ⬅ 제거
        // 'file-saver',    // ⬅ 제거
        'remix-utils/client-only',
      ],

      /** 꼭 프리번들하고 싶은 패키지 — 인터롭 안정화 목적 */
      include: [
        'path-browserify',
        'react-toastify',
        'fast-content-type-parse',
        'jszip',        // ⬅ 추가
        'file-saver',   // ⬅ 추가
      ],
    },

    plugins: [
      nodePolyfills({
        include: ['buffer', 'process', 'util', 'stream'],
        globals: {
          Buffer: true,
          process: true,
          global: true,
        },
        protocolImports: true,
        // 여기서 'path'는 제외 — 우리는 alias로 path-browserify를 사용
        exclude: ['child_process', 'fs', 'path'],
      }),

      {
        name: 'buffer-polyfill',
        transform(code, id) {
          if (id.includes('env.mjs')) {
            return {
              code: `import { Buffer } from 'buffer';\n${code}`,
              map: null,
            };
          }
          return null;
        },
      },

      config.mode !== 'test' && remixCloudflareDevProxy(),

      remixVitePlugin({
        future: {
          v3_fetcherPersist: true,
          v3_relativeSplatPath: true,
          v3_throwAbortReason: true,
          v3_lazyRouteDiscovery: true,
        },
      }),

      UnoCSS(),
      tsconfigPaths(),
      chrome129IssuePlugin(),
      config.mode === 'production' && optimizeCssModules({ apply: 'build' }),
    ],

    envPrefix: [
      'VITE_',
      'OPENAI_LIKE_API_BASE_URL',
      'OLLAMA_API_BASE_URL',
      'LMSTUDIO_API_BASE_URL',
      'TOGETHER_API_BASE_URL',
    ],

    css: {
      preprocessorOptions: {
        scss: {
          api: 'modern-compiler',
        },
      },
    },
  };
});

function chrome129IssuePlugin() {
  return {
    name: 'chrome129IssuePlugin',
    configureServer(server: ViteDevServer) {
      server.middlewares.use((req, res, next) => {
        const raw = req.headers['user-agent']?.match(/Chrom(e|ium)\/([0-9]+)\./);

        if (raw) {
          const version = parseInt(raw[2], 10);

          if (version === 129) {
            res.setHeader('content-type', 'text/html');
            res.end(
              '<body><h1>Please use Chrome Canary for testing.</h1><p>Chrome 129 has an issue with JavaScript modules & Vite local development, see https://github.com/stackblitz/bolt.new/issues/86#issuecomment-2395519258 for more information.</p><p><b>Note:</b> This only impacts <u>local development</u>. <code>pnpm run build</code> and <code>pnpm run start</code> will work fine in this browser.</p></body>',
            );
            return;
          }
        }

        next();
      });
    },
  };
}