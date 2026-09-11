import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  publicDir: 'outputs/web',
  build: {
    outDir: 'build',
    rollupOptions: {
      input: {
        main: resolve('index.html'),
        phones: resolve('phones.html'),
        airpods: resolve('accessories/airpods/index.html'),
        accessories: resolve('accessories/index.html'),
        privacy: resolve('privacy/index.html'),
        info: resolve('store-information/index.html'),
        viewer: resolve('viewer.html'),
        lpascan: resolve('lpascan/index.html'),
        redirect: resolve('redirect/index.html')
      }
    }
  }
});
