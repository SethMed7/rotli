// Local rendering commands get no inherited model credentials or telemetry.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const commands = new Set(['lint', 'check', 'snapshot', 'render', 'doctor']);
if (!commands.has(args[0]) || args.some((arg) => arg.startsWith('--describe'))) {
  throw new Error('Use a local rendering command; frame descriptions are always disabled.');
}
if (args[0] === 'snapshot') args.push('--describe', 'false');
const inherited = ['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'TERM', 'PUPPETEER_EXECUTABLE_PATH'];
const env = Object.fromEntries(inherited.filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]]));
env.HYPERFRAMES_NO_TELEMETRY = '1';
env.HYPERFRAMES_NO_UPDATE_CHECK = '1';
env.HYPERFRAMES_NO_AUTO_INSTALL = '1';
env.DO_NOT_TRACK = '1';
env.CI = 'true';
const result = spawnSync(fileURLToPath(new URL('../node_modules/.bin/hyperframes', import.meta.url)), args, {
  cwd: fileURLToPath(new URL('..', import.meta.url)), env, stdio: 'inherit',
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
