import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from 'rollup-plugin-typescript2';
import dts from "rollup-plugin-dts";


const CleanCSS = require('clean-css');

// Inline plugin to load css as minified string
const css = () => {return {
  name: "css",
  transform(code, id) {
    if (id.endsWith(".css")) {
      const minified = new CleanCSS({level: 2}).minify(code);
      return `export default ${JSON.stringify(minified.styles)}`;
    }
  }
}}


export default {
  input: `src/index.ts`,
  output: [
    {file: 'dist/index.js', format: 'es'}
  ],
  plugins: [
    typescript({
      include: [
          './src/*.ts',
      ],
    }),
    dts(),
    resolve(),
    commonjs(),
    css(),
  ]
}
;