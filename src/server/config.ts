import 'dotenv/config';
export const network = (() => {
  const value = process.env.APP_NETWORK ?? 'simulator';
  if (value !== 'simulator' && value !== 'devnet') throw new Error('Mainnet is not supported.');
  return value;
})();
export const origin = process.env.APP_ORIGIN ?? 'http://localhost:3000';
export const databaseUrl = process.env.DATABASE_URL ?? 'postgresql://weft:weft-local-only@127.0.0.1:55432/weftcurve_simulator';
const dbName = new URL(databaseUrl).pathname;
if (network === 'devnet' && !dbName.endsWith('_devnet')) throw new Error('Devnet requires a separate _devnet database.');
if (network === 'simulator' && !/(?:_simulator|_test)$/.test(dbName)) throw new Error('Simulator requires a _simulator or _test database.');
export const epochSeconds = Math.max(1, Number(process.env.EPOCH_SECONDS ?? 300));
export function assertSimulator() {
  if (network !== 'simulator') throw new Error('This action is only available in the simulator.');
}
