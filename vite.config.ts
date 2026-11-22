import { defineConfig, type Connect, type Plugin } from 'vite';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const MIME_TYPES: Record<string, string> = {
  '.glb': 'model/gltf-binary',
  '.js': 'application/javascript; charset=utf-8',
  '.wasm': 'application/wasm'
};

const CLEAN_ROUTE_MAP: Record<string, string> = {
  '/store': '/store/index.html',
  '/phones': '/phones/index.html',
  '/phones.html': '/phones/index.html',
  '/accessories': '/accessories/index.html',
  '/accessories/airpods': '/accessories/airpods/index.html',
  '/privacy': '/privacy/index.html',
  '/store-information': '/store-information/index.html',
  '/lpascan': '/lpascan/index.html',
  '/redirect': '/redirect/index.html',
  '/activate': '/activate/index.html',
  '/admin': '/admin/index.html'
};

/** Rewrites extensionless and legacy paths to their built HTML entrypoints so dev/preview match Vercel cleanUrls. */
function applyCleanRouteRewrite(req: Connect.IncomingMessage): boolean {
  const rawUrl = req.url || '/';
  const [pathname, search = ''] = rawUrl.split('?');
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  const suffix = search ? `?${search}` : '';

  const mapped = CLEAN_ROUTE_MAP[normalized];
  if (mapped) {
    req.url = `${mapped}${suffix}`;
    return true;
  }

  if (normalized === '/s' || (normalized.startsWith('/s/') && pathname !== '/s/index.html' && !extname(pathname))) {
    req.url = `/s/index.html${suffix}`;
    return true;
  }

  return false;
}

function devAssetsAndRewritesPlugin(): Plugin {
  const devAssetsDir = resolve('dev-assets');

  return {
    name: 'ezrefill-dev-assets-and-rewrites',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (applyCleanRouteRewrite(req)) {
          return next();
        }

        const [pathname = '/'] = (req.url || '/').split('?');
        if (pathname.startsWith('/models/') || pathname.startsWith('/decoders/')) {
          const safeRel = pathname.replace(/^\/+/, '').replace(/\.\./g, '');
          const filePath = join(devAssetsDir, safeRel);
          if (existsSync(filePath) && statSync(filePath).isFile()) {
            const ext = extname(filePath);
            if (MIME_TYPES[ext]) res.setHeader('Content-Type', MIME_TYPES[ext]);
            createReadStream(filePath).pipe(res);
            return;
          }
        }

        next();
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, _res, next) => {
        applyCleanRouteRewrite(req);
        next();
      });
    }
  };
}

export default defineConfig({
  publicDir: 'outputs/web',
  plugins: [devAssetsAndRewritesPlugin()],
  build: {
    outDir: 'build',
    rollupOptions: {
      input: {
        main: resolve('index.html'),
        store: resolve('store/index.html'),
        phones: resolve('phones/index.html'),
        airpods: resolve('accessories/airpods/index.html'),
        accessories: resolve('accessories/index.html'),
        privacy: resolve('privacy/index.html'),
        info: resolve('store-information/index.html'),
        lpascan: resolve('lpascan/index.html'),
        redirect: resolve('redirect/index.html'),
        activate: resolve('activate/index.html'),
        admin: resolve('admin/index.html'),
        shortlink: resolve('s/index.html')
      }
    }
  }
});
