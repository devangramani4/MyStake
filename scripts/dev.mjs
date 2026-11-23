// Starts API, web app and admin console together. Ctrl+C stops all three.
import { spawn } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const apps = [
  ['api', 'backend', '\x1b[33m'],
  ['web', 'frontend', '\x1b[36m'],
  ['admin', 'admin', '\x1b[35m'],
];
const children = apps.map(([label, ws, color]) => {
  const child = spawn(npm, ['run', 'dev', '-w', ws], { shell: process.platform === 'win32', env: process.env });
  const prefix = `${color}[${label}]\x1b[0m `;
  const pipe = (stream, out) => stream.on('data', (d) => d.toString().split('\n').filter(Boolean).forEach((l) => out.write(prefix + l + '\n')));
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  return child;
});
setTimeout(() => {
  console.log('\n  Web app : http://localhost:5173   (login: demo / DemoPass123)');
  console.log('  Admin   : http://localhost:5174   (login: admin@example.com / AdminPass123)\n');
}, 6000);
const stop = () => { children.forEach((c) => c.kill()); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
