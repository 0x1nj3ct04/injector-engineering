'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  buildCodeMap,
  getRootHash,
  readCodeMap,
  writeCodeMap,
} = require('../src/code-map');
const { buildContextBundle } = require('../src/context');

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'injector-test-'));
  fs.mkdirSync(path.join(root, 'src', 'auth'), { recursive: true });
  fs.mkdirSync(path.join(root, 'tests'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'src', 'auth', 'session.ts'),
    [
      'import { readStore } from "../store";',
      'export async function validateSession(token: string) {',
      '  return readStore(token);',
      '}',
      'export class SessionGuard {}',
      'export interface SessionRecord {}',
      '// secret-source-text must not be stored in the map',
    ].join('\n'),
  );
  fs.writeFileSync(path.join(root, 'src', 'store.ts'), 'export function readStore(token) { return token; }\n');
  fs.writeFileSync(
    path.join(root, 'tests', 'session.test.ts'),
    'import { validateSession } from "../src/auth/session";\n',
  );
  fs.writeFileSync(
    path.join(root, 'auth.py'),
    'class SessionAuth:\n    pass\n\nasync def validate_session(token):\n    return token\n',
  );
  fs.writeFileSync(path.join(root, 'handler.py'), 'from auth import SessionAuth\n');
  fs.mkdirSync(path.join(root, 'node_modules', 'ignored'), { recursive: true });
  fs.writeFileSync(path.join(root, 'node_modules', 'ignored', 'bad.js'), 'export function ignored() {}\n');
  fs.writeFileSync(path.join(root, 'unindexed.java'), 'class NotIndexed {}\n');
  return root;
}

function removeFixture(root) {
  fs.rmSync(root, { recursive: true, force: true });
}

test('map extracts supported files, symbols, local imports, and likely tests', () => {
  const root = createFixture();
  try {
    const map = buildCodeMap(root);
    const session = map.files.find((file) => file.path === 'src/auth/session.ts');
    const handler = map.files.find((file) => file.path === 'handler.py');

    assert.equal(map.schema, 'injector.code-map.v1');
    assert.equal(map.files.some((file) => file.path.includes('node_modules')), false);
    assert.equal(map.files.some((file) => file.path.endsWith('.java')), false);
    assert.deepEqual(
      session.symbols.map((symbol) => symbol.name),
      ['validateSession', 'SessionGuard', 'SessionRecord'],
    );
    assert.deepEqual(session.dependencies, ['src/store.ts']);
    assert.deepEqual(session.relatedTests, ['tests/session.test.ts']);
    assert.deepEqual(handler.dependencies, ['auth.py']);
    assert.equal(map.edges.length, 3);
    assert.equal(JSON.stringify(map).includes('secret-source-text'), false);
  } finally {
    removeFixture(root);
  }
});

test('context ranks matching code and returns connected tests and dependencies', () => {
  const root = createFixture();
  try {
    const map = buildCodeMap(root);
    const bundle = buildContextBundle(map, 'validate session', 1);

    assert.equal(bundle.schema, 'injector.context.v1');
    assert.equal(bundle.decision, 'not-made');
    assert.equal(bundle.candidates[0].path, 'src/auth/session.ts');
    assert.deepEqual(bundle.candidates[0].matchedTerms, ['session', 'validate']);
    assert.ok(
      bundle.relatedEvidence.some(
        (item) => item.path === 'tests/session.test.ts' && item.relation === 'possible-test',
      ),
    );
    assert.ok(bundle.relationships.some((edge) => edge.to === 'src/store.ts'));
  } finally {
    removeFixture(root);
  }
});

test('context rejects an empty or stop-word-only task', () => {
  assert.throws(
    () => buildContextBundle({ files: [] }, 'the and to'),
    /at least one searchable word/,
  );
});

test('map cache is local metadata and cannot be reused for another project root', () => {
  const firstRoot = createFixture();
  const secondRoot = createFixture();
  const output = path.join(os.tmpdir(), `injector-map-${process.pid}.json`);
  try {
    const map = buildCodeMap(firstRoot);
    writeCodeMap(map, output);
    assert.equal(readCodeMap(output, getRootHash(firstRoot)).files.length, map.files.length);
    assert.throws(() => readCodeMap(output, getRootHash(secondRoot)), /different project directory/);
    assert.equal(fs.readFileSync(output, 'utf8').includes('secret-source-text'), false);
  } finally {
    removeFixture(firstRoot);
    removeFixture(secondRoot);
    fs.rmSync(output, { force: true });
  }
});

test('CLI map then context works with an isolated local cache', () => {
  const root = createFixture();
  const cacheHome = fs.mkdtempSync(path.join(os.tmpdir(), 'injector-cache-'));
  const cliPath = path.join(__dirname, '..', 'bin', 'injector.js');
  const env = { ...process.env, INJECTOR_CACHE_HOME: cacheHome };
  try {
    const mapSummary = JSON.parse(execFileSync(process.execPath, [cliPath, 'map', root], { env, encoding: 'utf8' }));
    const context = JSON.parse(
      execFileSync(
        process.execPath,
        [cliPath, 'context', root, '--task', 'validate session'],
        { env, encoding: 'utf8' },
      ),
    );

    assert.equal(mapSummary.command, 'map');
    assert.equal(mapSummary.files, 5);
    assert.equal(context.candidates[0].path, 'src/auth/session.ts');
    assert.equal(fs.existsSync(path.join(root, '.injector')), false);
  } finally {
    removeFixture(root);
    fs.rmSync(cacheHome, { recursive: true, force: true });
  }
});
