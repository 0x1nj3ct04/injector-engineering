'use strict';

const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'how',
  'in',
  'is',
  'it',
  'of',
  'on',
  'or',
  'that',
  'the',
  'this',
  'to',
  'with',
]);

function tokenize(value) {
  return String(value)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .match(/[a-z0-9_]+/g)
    ?.filter((token) => token.length > 1 && !STOP_WORDS.has(token)) || [];
}

function matchingTokens(text, queryTokens) {
  const textTokens = new Set(tokenize(text));
  return queryTokens.filter((token) => textTokens.has(token));
}

function buildContextBundle(codeMap, task, limit = 10) {
  const queryTokens = [...new Set(tokenize(task))];
  if (queryTokens.length === 0) {
    throw new Error('Task must include at least one searchable word or symbol.');
  }

  const candidates = codeMap.files
    .map((file) => {
      const pathMatches = matchingTokens(file.path, queryTokens);
      const symbolMatches = file.symbols
        .map((symbol) => ({ ...symbol, matchedTerms: matchingTokens(symbol.name, queryTokens) }))
        .filter((symbol) => symbol.matchedTerms.length > 0);
      const importMatches = file.imports.filter((item) => matchingTokens(item, queryTokens).length > 0);
      const dependencyMatches = file.dependencies.filter((item) => matchingTokens(item, queryTokens).length > 0);
      const testMatches = file.relatedTests.filter((item) => matchingTokens(item, queryTokens).length > 0);

      const matchedTerms = new Set(pathMatches);
      for (const symbol of symbolMatches) symbol.matchedTerms.forEach((term) => matchedTerms.add(term));
      for (const item of [...importMatches, ...dependencyMatches, ...testMatches]) {
        matchingTokens(item, queryTokens).forEach((term) => matchedTerms.add(term));
      }

      const score =
        pathMatches.length * 4 +
        symbolMatches.reduce((total, symbol) => total + symbol.matchedTerms.length * 5, 0) +
        importMatches.reduce((total, item) => total + matchingTokens(item, queryTokens).length * 2, 0) +
        dependencyMatches.reduce((total, item) => total + matchingTokens(item, queryTokens).length * 3, 0) +
        testMatches.reduce((total, item) => total + matchingTokens(item, queryTokens).length, 0);

      return {
        path: file.path,
        score,
        matchedTerms: [...matchedTerms].sort(),
        symbols: file.symbols,
        imports: file.imports,
        dependencies: file.dependencies,
        relatedTests: file.relatedTests,
        unresolvedLocalImports: file.unresolvedLocalImports,
        sha256: file.sha256,
      };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path))
    .slice(0, limit);

  const selectedPaths = new Set(candidates.map((candidate) => candidate.path));
  const relatedEvidence = [];
  const seenRelated = new Set();
  for (const candidate of candidates) {
    const file = codeMap.files.find((entry) => entry.path === candidate.path);
    for (const dependency of file.dependencies) {
      const key = `${candidate.path}\0${dependency}\0dependency`;
      if (!selectedPaths.has(dependency) && !seenRelated.has(key)) {
        relatedEvidence.push({ path: dependency, relatedTo: candidate.path, relation: 'imports' });
        seenRelated.add(key);
      }
    }
    for (const testPath of file.relatedTests) {
      const key = `${candidate.path}\0${testPath}\0test`;
      if (!selectedPaths.has(testPath) && !seenRelated.has(key)) {
        relatedEvidence.push({ path: testPath, relatedTo: candidate.path, relation: 'possible-test' });
        seenRelated.add(key);
      }
    }
  }

  return {
    schema: 'injector.context.v1',
    task: String(task).trim(),
    retrieval: 'deterministic-token-overlap',
    decision: 'not-made',
    candidateCount: candidates.length,
    candidates,
    relatedEvidence,
    relationships: codeMap.edges.filter(
      (edge) => selectedPaths.has(edge.from) || selectedPaths.has(edge.to),
    ),
    instruction: 'Candidates are leads, not conclusions. Read the cited files and tests before deciding.',
  };
}

module.exports = { buildContextBundle, tokenize };
