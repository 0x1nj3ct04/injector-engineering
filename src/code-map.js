'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CODE_MAP_SCHEMA = 'injector.code-map.v1';
const SUPPORTED_EXTENSIONS = new Map([
  ['.js', 'javascript'],
  ['.cjs', 'javascript'],
  ['.mjs', 'javascript'],
  ['.jsx', 'javascript'],
  ['.ts', 'typescript'],
  ['.cts', 'typescript'],
  ['.mts', 'typescript'],
  ['.tsx', 'typescript'],
  ['.py', 'python'],
]);
const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.hg',
  '.svn',
  '.next',
  '.nuxt',
  '.turbo',
  '.venv',
  'venv',
  'node_modules',
  'vendor',
  'build',
  'dist',
  'coverage',
  'target',
]);
const MAX_SOURCE_FILE_BYTES = 1024 * 1024;
const MAX_SOURCE_FILES = 20000;

function normalizeRelativePath(value) {
  return value.split(path.sep).join('/');
}

function getRootHash(root) {
  const absoluteRoot = fs.realpathSync(root);
  return crypto.createHash('sha256').update(absoluteRoot).digest('hex');
}

function languageForFile(filePath) {
  return SUPPORTED_EXTENSIONS.get(path.extname(filePath).toLowerCase()) || null;
}

function isTestFile(filePath) {
  const normalized = filePath.toLowerCase();
  const fileName = path.posix.basename(normalized);
  return (
    /(^|\/)(__tests__|tests?|specs?)(\/|$)/.test(normalized) ||
    /\.(test|spec)\.[^.]+$/.test(fileName) ||
    /^test_.+\.py$/.test(fileName) ||
    /_.+_test\.py$/.test(fileName)
  );
}

function parseSymbols(source, language) {
  const symbols = [];
  const lines = source.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('*')) {
      continue;
    }

    let match;
    if (language === 'python') {
      match = line.match(/^(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/);
      if (match) {
        symbols.push({ name: match[1], kind: 'function', line: index + 1 });
        continue;
      }
      match = line.match(/^class\s+([A-Za-z_]\w*)\b/);
      if (match) {
        symbols.push({ name: match[1], kind: 'class', line: index + 1 });
      }
      continue;
    }

    // Restrict declarations to top-level lines to avoid indexing local variables.
    if (/^\s/.test(line)) continue;

    match = line.match(/^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\b/);
    if (match) {
      symbols.push({ name: match[1], kind: 'function', line: index + 1 });
      continue;
    }
    match = line.match(/^(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)\b/);
    if (match) {
      symbols.push({ name: match[1], kind: 'class', line: index + 1 });
      continue;
    }
    match = line.match(/^(?:export\s+)?(?:interface|type|enum)\s+([A-Za-z_$][\w$]*)\b/);
    if (match) {
      symbols.push({ name: match[1], kind: 'type', line: index + 1 });
      continue;
    }
    match = line.match(
      /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>)/,
    );
    if (match) {
      symbols.push({ name: match[1], kind: 'function', line: index + 1 });
    }
  }

  return symbols;
}

function parseImports(source, language) {
  const imports = new Set();
  const patterns =
    language === 'python'
      ? [
          /^\s*from\s+([.A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s+import\b/gm,
          /^\s*import\s+([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)/gm,
        ]
      : [
          /(?:^|\n)\s*import\s+(?:type\s+)?(?:[^;\n]*?\s+from\s+)?['"]([^'"]+)['"]/g,
          /(?:^|\n)\s*export\s+[^;\n]*?\s+from\s+['"]([^'"]+)['"]/g,
          /\b(?:require|import)\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
        ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source)) !== null) {
      imports.add(match[1]);
    }
  }

  return [...imports].sort();
}

function testStem(filePath) {
  let stem = path.posix.basename(filePath).replace(/\.[^.]+$/, '');
  stem = stem.replace(/\.(test|spec)$/i, '');
  stem = stem.replace(/^test_/i, '').replace(/_test$/i, '');
  return stem.toLowerCase();
}

function resolveLocalImport(importPath, sourcePath, language, knownFiles) {
  const isRelative = importPath.startsWith('.');
  if (!isRelative && language !== 'python') return null;

  let basePath;
  if (language === 'python') {
    const relativePrefix = importPath.match(/^\.+/);
    if (relativePrefix) {
      const levels = Math.max(0, relativePrefix[0].length - 1);
      const sourceDirectory = path.posix.dirname(sourcePath);
      const segments = sourceDirectory === '.' ? [] : sourceDirectory.split('/');
      basePath = path.posix.join(
        segments.slice(0, Math.max(0, segments.length - levels)).join('/'),
        importPath.slice(relativePrefix[0].length).replace(/\./g, '/'),
      );
    } else {
      basePath = importPath.replace(/\./g, '/');
    }
  } else {
    basePath = path.posix.normalize(path.posix.join(path.posix.dirname(sourcePath), importPath));
  }

  const candidates = [basePath];
  if (!path.posix.extname(basePath)) {
    for (const extension of SUPPORTED_EXTENSIONS.keys()) {
      candidates.push(`${basePath}${extension}`);
    }
    for (const extension of SUPPORTED_EXTENSIONS.keys()) {
      candidates.push(path.posix.join(basePath, `index${extension}`));
    }
    candidates.push(path.posix.join(basePath, '__init__.py'));
  }

  return candidates.find((candidate) => knownFiles.has(candidate) && candidate !== sourcePath) || null;
}

function getCachePath(root) {
  const rootHash = getRootHash(root);
  const cacheBase =
    process.env.INJECTOR_CACHE_HOME ||
    process.env.XDG_CACHE_HOME ||
    (process.platform === 'win32'
      ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Injector')
      : path.join(os.homedir(), '.cache', 'injector'));
  return path.join(cacheBase, rootHash.slice(0, 20), 'code-map.json');
}

function discoverSourceFiles(root) {
  const sourceFiles = [];
  const pendingDirectories = [root];
  let skippedLargeFiles = 0;

  while (pendingDirectories.length > 0) {
    const currentDirectory = pendingDirectories.pop();
    const entries = fs.readdirSync(currentDirectory, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentDirectory, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) pendingDirectories.push(fullPath);
        continue;
      }
      if (!entry.isFile() || !languageForFile(entry.name)) continue;

      const fileStat = fs.statSync(fullPath);
      if (fileStat.size > MAX_SOURCE_FILE_BYTES) {
        skippedLargeFiles += 1;
        continue;
      }
      sourceFiles.push(fullPath);
      if (sourceFiles.length > MAX_SOURCE_FILES) {
        throw new Error(`More than ${MAX_SOURCE_FILES} source files found; index a smaller directory.`);
      }
    }
  }

  sourceFiles.sort((left, right) => left.localeCompare(right));
  return { sourceFiles, skippedLargeFiles };
}

function buildCodeMap(root) {
  const absoluteRoot = fs.realpathSync(path.resolve(root));
  if (!fs.statSync(absoluteRoot).isDirectory()) {
    throw new Error(`Not a directory: ${root}`);
  }

  const { sourceFiles, skippedLargeFiles } = discoverSourceFiles(absoluteRoot);
  const fileRecords = sourceFiles.map((absolutePath) => {
    const source = fs.readFileSync(absolutePath, 'utf8');
    const relativePath = normalizeRelativePath(path.relative(absoluteRoot, absolutePath));
    const language = languageForFile(relativePath);
    return {
      path: relativePath,
      language,
      sha256: crypto.createHash('sha256').update(source).digest('hex'),
      sizeBytes: Buffer.byteLength(source),
      isTest: isTestFile(relativePath),
      symbols: parseSymbols(source, language),
      imports: parseImports(source, language),
      dependencies: [],
      unresolvedLocalImports: [],
      relatedTests: [],
    };
  });
  const knownFiles = new Set(fileRecords.map((file) => file.path));

  for (const file of fileRecords) {
    for (const importPath of file.imports) {
      const dependency = resolveLocalImport(importPath, file.path, file.language, knownFiles);
      if (dependency) {
        file.dependencies.push(dependency);
      } else if (importPath.startsWith('.')) {
        file.unresolvedLocalImports.push(importPath);
      }
    }
    file.dependencies.sort();
    file.unresolvedLocalImports.sort();
  }

  const testFiles = fileRecords.filter((file) => file.isTest);
  for (const file of fileRecords) {
    if (file.isTest) continue;
    file.relatedTests = testFiles
      .filter((testFile) => testStem(testFile.path) === testStem(file.path))
      .map((testFile) => testFile.path)
      .sort();
  }

  const edges = fileRecords
    .flatMap((file) => file.dependencies.map((dependency) => ({ from: file.path, to: dependency, kind: 'import' })))
    .sort((left, right) => `${left.from}\0${left.to}`.localeCompare(`${right.from}\0${right.to}`));

  return {
    schema: CODE_MAP_SCHEMA,
    rootHash: getRootHash(absoluteRoot),
    generatedAt: new Date().toISOString(),
    languages: [...new Set(fileRecords.map((file) => file.language))].sort(),
    counts: {
      files: fileRecords.length,
      symbols: fileRecords.reduce((count, file) => count + file.symbols.length, 0),
      edges: edges.length,
      skippedLargeFiles,
    },
    files: fileRecords,
    edges,
  };
}

function writeCodeMap(map, outputPath) {
  const resolvedOutputPath = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(resolvedOutputPath), { recursive: true });
  const temporaryPath = `${resolvedOutputPath}.${process.pid}.tmp`;

  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(map, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporaryPath, resolvedOutputPath);
  } catch (error) {
    try {
      fs.rmSync(temporaryPath, { force: true });
    } catch {
      // Preserve the original write error.
    }
    throw error;
  }

  return resolvedOutputPath;
}

function readCodeMap(mapPath, expectedRootHash) {
  let map;
  try {
    map = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`No map found at ${mapPath}. Run "injector map <directory>" first.`);
    if (error instanceof SyntaxError) throw new Error(`Invalid map JSON at ${mapPath}. Run "injector map <directory>" again.`);
    throw error;
  }

  if (map.schema !== CODE_MAP_SCHEMA || !Array.isArray(map.files)) {
    throw new Error(`Unsupported or invalid map at ${mapPath}. Run "injector map <directory>" again.`);
  }
  if (expectedRootHash && map.rootHash !== expectedRootHash) {
    throw new Error('This map belongs to a different project directory. Run "injector map <directory>" again.');
  }
  return map;
}

module.exports = {
  CODE_MAP_SCHEMA,
  buildCodeMap,
  getCachePath,
  getRootHash,
  readCodeMap,
  writeCodeMap,
};
