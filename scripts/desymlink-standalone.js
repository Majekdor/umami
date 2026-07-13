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

// Multiple versions of a package (e.g. postgres-array) can exist in the pnpm
// store for different consumers; only some copies were fully traced by Next.
// Prefer whichever candidate actually has real content, not just a package.json stub.
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

    if (PG_FAMILY.includes(entry.name)) {
      try {
        const real = fs.realpathSync(fullPath);

        if (!canonical[entry.name] || completeness(real) > completeness(canonical[entry.name])) {
          canonical[entry.name] = real;
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

    if (entry.isSymbolicLink() && PG_FAMILY.includes(entry.name)) {
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
