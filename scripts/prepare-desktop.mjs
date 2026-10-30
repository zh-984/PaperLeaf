import {
  cp,
  mkdir,
  readFile,
  writeFile,
  rm,
  realpath,
  copyFile,
  access,
  readdir,
  stat,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const require = createRequire(import.meta.url);
const output = path.resolve(root, '.desktop-build');
const dist = '.next-desktop';
if (!process.argv.includes('--skip-build')) {
  const result = spawnSync(process.execPath, ['node_modules/next/dist/bin/next', 'build'], {
    stdio: 'inherit',
    windowsHide: true,
    env: {
      ...process.env,
      PAPERLEAF_DESKTOP_BUILD: '1',
      NEXT_DIST_DIR: dist,
      NEXT_TELEMETRY_DISABLED: '1',
    },
  });
  if (result.status !== 0) process.exit(result.status || 1);
}
await access(path.join(dist, 'standalone/server.js'));
// Only this exact generated staging directory may be removed.
if (output !== path.join(root, '.desktop-build') || path.dirname(output) !== root)
  throw new Error('Unsafe staging path');
await rm(output, { recursive: true, force: true });
const appRoot = path.join(output, 'app');
const serverRoot = path.join(output, 'server');
await mkdir(appRoot, { recursive: true });
await mkdir(serverRoot, { recursive: true });
const standalone = path.resolve(dist, 'standalone');
await cp(standalone, serverRoot, {
  recursive: true,
  dereference: true,
  filter(source) {
    const relative = path.relative(standalone, source);
    if (!relative) return true;
    const base = path.basename(source);
    if (base === '.env' || base.startsWith('.env.')) return false;
    return [dist, 'server.js', 'package.json'].includes(relative.split(path.sep)[0]);
  },
});
await cp('public', path.join(serverRoot, 'public'), { recursive: true, dereference: true });
await cp(path.join(dist, 'static'), path.join(serverRoot, dist, 'static'), { recursive: true });
await cp('prisma/migrations', path.join(serverRoot, 'prisma/migrations'), { recursive: true });
async function resolvePackageJson(name, fromRequire) {
  try {
    return await realpath(fromRequire.resolve(`${name}/package.json`));
  } catch (error) {
    if (error.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') throw error;
    let folder = path.dirname(await realpath(fromRequire.resolve(name)));
    while (path.dirname(folder) !== folder) {
      try {
        const file = path.join(folder, 'package.json');
        if (JSON.parse(await readFile(file, 'utf8')).name === name) return file;
      } catch {
        /* Continue to package root. */
      }
      folder = path.dirname(folder);
    }
    throw new Error(`Cannot locate package metadata: ${name}`);
  }
}
async function copyPackage(
  name,
  fromRequire,
  targetModules = path.join(serverRoot, 'node_modules'),
  ancestors = new Set(),
) {
  const packagePath = await resolvePackageJson(name, fromRequire);
  const packageRoot = path.dirname(packagePath);
  if (ancestors.has(packageRoot)) return createRequire(packagePath);
  const target = path.join(targetModules, ...name.split('/'));
  await cp(packageRoot, target, {
    recursive: true,
    dereference: true,
    filter(source) {
      const base = path.basename(source);
      return (
        source === packageRoot ||
        (base !== 'node_modules' && base !== '.env' && !base.startsWith('.env.'))
      );
    },
  });
  const localRequire = createRequire(packagePath);
  const meta = JSON.parse(await readFile(packagePath, 'utf8'));
  const nextAncestors = new Set([...ancestors, packageRoot]);
  for (const dependency of Object.keys(meta.dependencies || {}))
    await copyPackage(dependency, localRequire, path.join(target, 'node_modules'), nextAncestors);
  for (const dependency of Object.keys(meta.optionalDependencies || {})) {
    try {
      await resolvePackageJson(dependency, localRequire);
    } catch {
      continue;
    }
    await copyPackage(dependency, localRequire, path.join(target, 'node_modules'), nextAncestors);
  }
  return localRequire;
}
// Materialize exact runtime dependencies instead of copying non-relocatable Windows pnpm junctions.
for (const name of ['next', 'react', 'react-dom', 'busboy', 'zod', 'dotenv', '@prisma/client'])
  await copyPackage(name, require);
const prismaRequire = createRequire(require.resolve('@prisma/client/package.json'));
await copyPackage('.prisma/client', prismaRequire);
// PDF.js dynamically imports its fake worker and optional native canvas.
const pdfRequire = await copyPackage('pdfjs-dist', require);
await copyPackage('@napi-rs/canvas', pdfRequire);
// Turbopack relocates external ESM imports into a hashed package directory. Preserve
// PDF.js's relative fake-worker imports there as well as in canonical node_modules.
for (const entry of await readdir(path.join(serverRoot, dist, 'node_modules'), {
  withFileTypes: true,
})) {
  if (entry.isDirectory() && entry.name.startsWith('pdfjs-dist-')) {
    await cp(
      path.dirname(require.resolve('pdfjs-dist/package.json')),
      path.join(serverRoot, dist, 'node_modules', entry.name),
      { recursive: true, dereference: true },
    );
  }
}

const assets = path.resolve('desktop/assets');
await mkdir(assets, { recursive: true });
const { createCanvas } = pdfRequire('@napi-rs/canvas');
const images = [];
for (const size of [16, 32, 48, 64, 128, 256]) {
  const canvas = createCanvas(size, size);
  const context = canvas.getContext('2d');
  context.scale(size / 256, size / 256);
  context.fillStyle = '#eef2e5';
  context.beginPath();
  context.roundRect(4, 4, 248, 248, 56);
  context.fill();
  context.strokeStyle = '#c8d1be';
  context.lineWidth = 3;
  context.stroke();
  context.strokeStyle = '#557546';
  context.lineWidth = 10;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.beginPath();
  context.moveTo(80, 170);
  context.bezierCurveTo(36, 107, 106, 83, 180, 55);
  context.bezierCurveTo(191, 137, 170, 201, 88, 172);
  context.stroke();
  context.beginPath();
  context.moveTo(68, 203);
  context.bezierCurveTo(86, 152, 127, 133, 154, 110);
  context.stroke();
  images.push({ size, data: canvas.toBuffer('image/png') });
}
await writeFile(path.join(assets, 'icon.png'), images.at(-1).data);
const header = Buffer.alloc(6);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(images.length, 4);
const entries = [];
let offset = 6 + images.length * 16;
for (const image of images) {
  const entry = Buffer.alloc(16);
  entry[0] = image.size === 256 ? 0 : image.size;
  entry[1] = entry[0];
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(image.data.length, 8);
  entry.writeUInt32LE(offset, 12);
  offset += image.data.length;
  entries.push(entry);
}
await writeFile(
  path.join(assets, 'icon.ico'),
  Buffer.concat([header, ...entries, ...images.map((image) => image.data)]),
);
for (const file of [
  'main.cjs',
  'preload.cjs',
  'server-bootstrap.cjs',
  'data.cjs',
  'word.cjs',
  'loading.html',
])
  await copyFile(path.join('desktop', file), path.join(appRoot, file));
await cp(assets, path.join(appRoot, 'assets'), { recursive: true });
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
await writeFile(
  path.join(appRoot, 'package.json'),
  JSON.stringify(
    {
      name: 'paperleaf-desktop',
      productName: '知页 Paperleaf',
      version: pkg.version,
      main: 'main.cjs',
      description: '本地优先的极简文献解读器',
      author: 'Paperleaf',
      private: true,
      dependencies: {},
      packageManager: 'pnpm@11.25.0',
    },
    null,
    2,
  ),
);
await writeFile(path.join(appRoot, 'pnpm-workspace.yaml'), "packages:\n  - '.'\n");
await writeFile(
  path.join(appRoot, 'pnpm-lock.yaml'),
  "lockfileVersion: '9.0'\nimporters:\n  .: {}\n",
);
// Production never loads sourcemaps or TypeScript declarations. Keep all runtime
// code, native binaries, fonts, workers, assets and license files intact.
let removedBytes = 0,
  removedFiles = 0;
async function pruneBuildMetadata(folder) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) await pruneBuildMetadata(file);
    else if (entry.isFile() && /(?:\.map|\.d\.(?:ts|mts|cts))$/i.test(entry.name)) {
      removedBytes += (await stat(file)).size;
      await rm(file);
      removedFiles++;
    }
  }
}
await pruneBuildMetadata(serverRoot);
console.log(
  `Production metadata removed: ${removedFiles} files, ${(removedBytes / 1024 / 1024).toFixed(1)} MiB. Runtime assets and licenses retained.`,
);
console.log('Desktop staging ready. No workspace .env, PDFs or database were included.');
