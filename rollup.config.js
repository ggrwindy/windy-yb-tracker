import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import terser from '@rollup/plugin-terser';
import svelte from 'rollup-plugin-svelte';
import swc from 'rollup-plugin-swc3';
import sveltePreprocess from 'svelte-preprocess';
import { transformCodeToESMPlugin } from '@windycom/plugin-devtools';

export default {
    input: 'src/plugin.svelte',
    output: [
        { file: 'dist/plugin.js', format: 'module', sourcemap: false },
        { file: 'dist/plugin.min.js', format: 'module', sourcemap: false, plugins: [terser()] },
    ],
    external: id => id.startsWith('@windy/'),
    plugins: [
        svelte({ emitCss: false, preprocess: sveltePreprocess({ sourceMap: false }) }),
        swc({ include: ['**/*.ts', '**/*.svelte'], sourceMaps: false }),
        resolve({ browser: true, preferBuiltins: false, dedupe: ['svelte'] }),
        commonjs(),
        transformCodeToESMPlugin(),
    ],
};
