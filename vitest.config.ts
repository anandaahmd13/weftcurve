import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
export default defineConfig({resolve:{alias:{'@':resolve('src')}},test:{environment:'node',include:['tests/unit/**/*.test.ts','tests/integration/**/*.test.ts'],fileParallelism:false,testTimeout:15000,env:{APP_NETWORK:'simulator',DATABASE_URL:'postgresql://weft:weft-local-only@127.0.0.1:55432/weftcurve_test'}}});
