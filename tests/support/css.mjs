// Client modules import their own stylesheets, which Vite bundles in the browser. Under node a
// stylesheet has nothing to give, so a test importing such a module gets an empty one instead of
// "Unknown file extension .css".
import { register } from 'node:module';

register('./css-loader.mjs', import.meta.url);
