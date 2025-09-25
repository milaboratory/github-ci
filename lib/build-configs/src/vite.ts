import { defineConfig, UserConfig } from 'vite';
import { resolve } from 'node:path';
import nodeExternals from 'rollup-plugin-node-externals';
import nodeResolve from '@rollup/plugin-node-resolve';
import dts from 'vite-plugin-dts';

export function PlViteStdDist(overrideConfig?: UserConfig) {
  return defineConfig({
    build: {
      outDir: 'dist',
      lib: {
        entry: resolve('src', 'index.ts'),
        fileName: 'index',
        formats: ['es', 'cjs']
      },
      sourcemap: true,
      rollupOptions: {}
    },
    plugins: [
      nodeExternals({deps: false}),
      nodeResolve(),
      dts({
        staticImport: true
      })
    ],
    ...(overrideConfig ?? {})
  });
}

export function PlViteStdLib(overrideConfig?: UserConfig) {
  return defineConfig({
    build: {
      outDir: 'lib',
      minify: false,
      lib: {
        entry: resolve('src', 'index.ts'),
        fileName: 'index',
        formats: ['es', 'cjs']
      },
      sourcemap: true,
      rollupOptions: {}
    },
    plugins: [
      nodeExternals({deps: false}),
      nodeResolve(),
      dts({
        outDir: 'dist',
        staticImport: true
      })
    ],
    ...(overrideConfig ?? {})
  });
}
