// The app imports './store' without an extension, as Next compiles it; plain
// Node needs the .ts added.
import { register } from 'node:module';

register('./resolve-ts.mjs', import.meta.url);
