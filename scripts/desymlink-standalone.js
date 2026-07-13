import fs from 'node:fs';
import path from 'node:path';

// Amplify's compute-bundle step cannot follow pnpm's nested, relative
// cross-package symlinks (e.g. .pnpm/pg-pool@x/node_modules/pg -> ../../pg@x/node_modules/pg).
// Replace every pg driver family symlink with a real, self-contained copy (including
// copies of its own pg-family siblings, since dropping a copy outside the .pnpm tree
// would otherwise lose access to their normal fallback resolution path).
const PG_FAMILY = [
  'pg',
  'pg-types',
  'pg-pool',
  'pg-protocol',
  'pgpass',
  'pg-int8',
  'pg-cloudflare',
  'pg-connection-string',
  'postgres-array',
  'postgres-bytea',
  'postgres-date',
  'postgres-interval',
  'xtend',
];

const target = process.argv[2] || '.next/standalone/node_modules';

const canonical = {};

// Multiple candidates can share a bare directory name (e.g. runtime "pg" vs.
// the unrelated "@types/pg" types-only package, or multiple pnpm-store
// versions of "postgres-array"). Only accept a candidate whose package.json
// actually resolves to a real JS entry point, and prefer the most complete one.
function resolveMainFile(dirPath) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dirPath, 'package.json'), 'utf8'));
    const mainRel = pkg.main || 'index.js';

    if (!mainRel) {
      return null;
    }

    let mainPath = path.join(dirPath, mainRel);

    if (fs.existsSync(mainPath) && fs.statSync(mainPath).isDirectory()) {
      mainPath = path.join(mainPath, 'index.js');
    } else if (!path.extname(mainPath)) {
      mainPath += '.js';
    }

    return fs.existsSync(mainPath) ? mainPath : null;
  } catch {
    return null;
  }
}

function completeness(dirPath) {
  try {
    return fs.readdirSync(dirPath).length;
  } catch {
    return 0;
  }
}

function collectCanonical(dir) {
  if (!fs.existsSync(dir)) {
    return;
  }

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);

    if (PG_FAMILY.includes(entry.name) && path.basename(dir) !== '@types') {
      try {
        const real = fs.realpathSync(fullPath);

        if (resolveMainFile(real)) {
          const current = canonical[entry.name];

          if (!current || completeness(real) > completeness(current)) {
            canonical[entry.name] = real;
          }
        }
      } catch {
        // broken symlink, skip
      }
    }

    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      collectCanonical(fullPath);
    }
  }
}

function fixSymlinks(dir) {
  if (!fs.existsSync(dir)) {
    return;
  }

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isSymbolicLink() && PG_FAMILY.includes(entry.name) && path.basename(dir) !== '@types') {
      const src = canonical[entry.name];
      fs.unlinkSync(fullPath);

      if (!src) {
        continue;
      }

      fs.cpSync(src, fullPath, { recursive: true, dereference: true });

      const localNodeModules = path.join(fullPath, 'node_modules');

      for (const [name, srcDir] of Object.entries(canonical)) {
        if (name === entry.name) {
          continue;
        }

        const dest = path.join(localNodeModules, name);

        if (!fs.existsSync(dest)) {
          fs.mkdirSync(localNodeModules, { recursive: true });
          fs.cpSync(srcDir, dest, { recursive: true, dereference: true });
        }
      }
    } else if (entry.isDirectory() && !entry.isSymbolicLink()) {
      fixSymlinks(fullPath);
    }
  }
}

collectCanonical(target);
fixSymlinks(target);
