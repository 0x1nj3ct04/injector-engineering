'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { buildCodeMap, getCachePath, getRootHash, readCodeMap, writeCodeMap } = require('./code-map');
const { buildContextBundle } = require('./context');

const USAGE = `Injector — prepare structured code evidence before a decision.

Usage:
  injector map [directory] [--out <file>] [--json]
  injector context [directory] --task <description> [--map <file>] [--limit <count>]
  injector --help

Examples:
  injector map .
  injector context . --task "session expiry validation"
  injector map ./src --out ./tmp/code-map.json --json

Supported source: JavaScript, TypeScript, and Python.
The index stores paths, symbols, imports, file hashes, and relationships—not source text.
All scanning and retrieval happen locally; no AI service or network connection is used.`;

function parseOptions(args) {
  const positional = [];
  const options = {};
  const valueFlags = new Set(['--out', '--map', '--task', '--limit']);

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--json') {
      options.json = true;
    } else if (valueFlags.has(argument)) {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${argument}.`);
      options[argument.slice(2)] = value;
      index += 1;
    } else if (argument.startsWith('-')) {
      throw new Error(`Unknown option: ${argument}`);
    } else {
      positional.push(argument);
    }
  }

  return { positional, options };
}

function writeJson(stream, value) {
  stream.write(`${JSON.stringify(value, null, 2)}\n`);
}

function runCli(args = process.argv.slice(2), io = { out: process.stdout, err: process.stderr }) {
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h' || args[0] === 'help') {
    io.out.write(`${USAGE}\n`);
    return 0;
  }

  const [command, ...remainingArgs] = args;
  let parsed;
  try {
    parsed = parseOptions(remainingArgs);
    if (parsed.positional.length > 1) throw new Error('Only one project directory may be supplied.');

    const root = path.resolve(parsed.positional[0] || process.cwd());
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
      throw new Error(`Not a directory: ${root}`);
    }

    if (command === 'map') {
      const map = buildCodeMap(root);
      const outputPath = parsed.options.out
        ? path.resolve(parsed.options.out)
        : getCachePath(root);
      writeCodeMap(map, outputPath);
      writeJson(
        io.out,
        parsed.options.json
          ? map
          : {
              command: 'map',
              files: map.counts.files,
              symbols: map.counts.symbols,
              relationships: map.counts.edges,
              skippedLargeFiles: map.counts.skippedLargeFiles,
              map: outputPath,
            },
      );
      return 0;
    }

    if (command === 'context') {
      if (!parsed.options.task) throw new Error('Missing required --task description.');
      const limit = parsed.options.limit === undefined ? 10 : Number(parsed.options.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
        throw new Error('--limit must be a whole number from 1 to 50.');
      }

      const mapPath = parsed.options.map ? path.resolve(parsed.options.map) : getCachePath(root);
      const map = readCodeMap(mapPath, getRootHash(root));
      writeJson(io.out, buildContextBundle(map, parsed.options.task, limit));
      return 0;
    }

    throw new Error(`Unknown command: ${command}`);
  } catch (error) {
    io.err.write(`injector: ${error.message}\n`);
    io.err.write('Run "injector --help" for usage.\n');
    return 2;
  }
}

module.exports = { runCli };
