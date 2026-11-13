#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT_DIR = process.cwd();
const SRC_DIR = path.join(ROOT_DIR, 'src');

const TARGET_CALLS = new Set([
  'doc',
  'collection',
  'getDoc',
  'getDocFromServer',
  'getDocs',
  'setDoc',
  'updateDoc',
  'deleteDoc',
  'writeBatch',
  'runTransaction',
  'onSnapshot',
]);

function walkFiles(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      results.push(...walkFiles(full));
    } else if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry.name)) {
      results.push(full);
    }
  }
  return results.sort();
}

function collectConstants(code) {
  const map = new Map();
  const re = /(?:const|let)\s+([A-Z0-9_]+)\s*=\s*['"`]([^'"`]+)['"`]\s*;/g;
  let m;
  while ((m = re.exec(code)) !== null) {
    map.set(m[1], m[2]);
  }
  return map;
}

/**
 * Splits top-level comma-separated arguments inside (...) respecting nested parens/braces/quotes.
 */
function splitArgs(argText) {
  const args = [];
  let cur = '';
  let depthParen = 0;
  let depthBrace = 0;
  let depthBracket = 0;
  let quote = null;
  for (let i = 0; i < argText.length; i++) {
    const ch = argText[i];
    const prev = i > 0 ? argText[i - 1] : '';
    if (quote) {
      cur += ch;
      if (ch === quote && prev !== '\\') quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      cur += ch;
      continue;
    }
    if (ch === '(') depthParen++;
    else if (ch === ')') depthParen--;
    else if (ch === '{') depthBrace++;
    else if (ch === '}') depthBrace--;
    else if (ch === '[') depthBracket++;
    else if (ch === ']') depthBracket--;
    else if (ch === ',' && depthParen === 0 && depthBrace === 0 && depthBracket === 0) {
      args.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) args.push(cur.trim());
  return args;
}

/**
 * Extracts balanced (...) starting at openParenIndex.
 */
function extractParenContent(code, openParenIndex) {
  let depth = 0;
  let quote = null;
  for (let i = openParenIndex; i < code.length; i++) {
    const ch = code[i];
    const prev = i > 0 ? code[i - 1] : '';
    if (quote) {
      if (ch === quote && prev !== '\\') quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '/' && code[i + 1] === '/') {
      const nl = code.indexOf('\n', i);
      if (nl === -1) break;
      i = nl;
      continue;
    }
    if (ch === '/' && code[i + 1] === '*') {
      const end = code.indexOf('*/', i + 2);
      if (end === -1) break;
      i = end + 1;
      continue;
    }
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) {
        return code.slice(openParenIndex + 1, i);
      }
    }
  }
  return '';
}

function resolveArgExpr(expr, constants, localRefs) {
  if (!expr) return '';
  const trimmed = expr.trim();
  if (/^['"`][^'"`]*['"`]$/.test(trimmed)) {
    return trimmed.slice(1, -1);
  }
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) {
    if (constants.has(trimmed)) return constants.get(trimmed);
    if (localRefs.has(trimmed)) return localRefs.get(trimmed);
    return `{${trimmed}}`;
  }
  if (trimmed.startsWith('doc(') || trimmed.startsWith('collection(')) {
    const parenIdx = trimmed.indexOf('(');
    const inner = extractParenContent(trimmed, parenIdx);
    const parts = splitArgs(inner);
    const cleaned = parts[0] === 'db' ? parts.slice(1) : parts;
    return cleaned.map((p) => resolveArgExpr(p, constants, localRefs)).join('/');
  }
  if (trimmed.startsWith('query(')) {
    const parenIdx = trimmed.indexOf('(');
    const inner = extractParenContent(trimmed, parenIdx);
    const parts = splitArgs(inner);
    return parts[0] ? resolveArgExpr(parts[0], constants, localRefs) : '(query)';
  }
  // Clean up template literals or identifiers inside strings
  return trimmed
    .replace(/\b([A-Z0-9_]+)\b/g, (m) => constants.get(m) || m)
    .replace(/\s+/g, ' ');
}

function stripCommentsAndImportsForLineScan(code) {
  // Replace comments with spaces preserving newlines so line numbers stay exact
  let out = '';
  let i = 0;
  let quote = null;
  while (i < code.length) {
    const ch = code[i];
    const next = code[i + 1];
    if (quote) {
      out += ch;
      if (ch === quote && code[i - 1] !== '\\') quote = null;
      i++;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      out += ch;
      i++;
      continue;
    }
    if (ch === '/' && next === '/') {
      while (i < code.length && code[i] !== '\n') {
        out += ' ';
        i++;
      }
      continue;
    }
    if (ch === '/' && next === '*') {
      out += '  ';
      i += 2;
      while (i < code.length && !(code[i] === '*' && code[i + 1] === '/')) {
        out += code[i] === '\n' ? '\n' : ' ';
        i++;
      }
      if (i < code.length) {
        out += '  ';
        i += 2;
      }
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

function buildLineStarts(code) {
  const starts = [0];
  for (let i = 0; i < code.length; i++) {
    if (code[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

function offsetToLine(starts, offset) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (starts[mid] <= offset) lo = mid + 1;
    else hi = mid - 1;
  }
  return hi + 1;
}

function findEnclosingFunction(lines, lineNum, relPath) {
  // Scan backwards from lineNum for nearest function / arrow const / React component / useEffect
  const collected = [];
  let minIndent = Infinity;
  for (let idx = lineNum - 1; idx >= 0; idx--) {
    const raw = lines[idx];
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const indent = raw.search(/\S/);
    if (indent >= minIndent && minIndent !== 0) continue;

    // Function declaration: export async function foo(
    let m = trimmed.match(/^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_]+)/);
    if (m) {
      collected.push(m[1]);
      minIndent = indent;
      if (indent === 0) break;
      continue;
    }
    // Variable arrow/function: export const foo = async (...) => { or const foo = useCallback(async (...) => {
    m = trimmed.match(/^(?:export\s+)?(?:const|let)\s+([A-Za-z0-9_]+)\s*(?::[^=]+)?=\s*(?:useCallback\s*\(\s*)?(?:async\s+)?(?:\([^)]*\)\s*(?::\s*[^=]+)?=>|[A-Za-z0-9_]+\s*=>|function\b)/);
    if (m) {
      collected.push(m[1]);
      minIndent = indent;
      if (indent === 0) break;
      continue;
    }
    // React FC component: export const App: React.FC<...> = ({ ... }) => {
    m = trimmed.match(/^(?:export\s+)?(?:default\s+)?const\s+([A-Z][A-Za-z0-9_]*)\s*:\s*React\.FC\b/);
    if (m) {
      collected.push(m[1]);
      minIndent = indent;
      if (indent === 0) break;
      continue;
    }
    // useEffect(() => {
    if (/^useEffect\s*\(/.test(trimmed)) {
      collected.push('useEffect');
      minIndent = indent;
      continue;
    }
    if (indent === 0 && /^(?:export\s+default\s+)?function\s+([A-Za-z0-9_]+)/.test(trimmed)) {
      const m2 = trimmed.match(/function\s+([A-Za-z0-9_]+)/);
      if (m2) collected.push(m2[1]);
      break;
    }
  }
  if (collected.length === 0) {
    return path.basename(relPath);
  }
  return collected.reverse().join('.');
}

function scanFile(absPath) {
  const relPath = path.relative(ROOT_DIR, absPath).replace(/\\/g, '/');
  const rawCode = fs.readFileSync(absPath, 'utf8');
  const code = stripCommentsAndImportsForLineScan(rawCode);
  const constants = collectConstants(code);
  const lines = code.split('\n');
  const starts = buildLineStarts(code);

  // Also gather simple local ref bindings within +/- 40 lines of usage
  const refAssignments = [];
  const assignRe = /(?:const|let)\s+([A-Za-z0-9_]+)\s*=\s*((?:doc|collection|query)\s*\()/g;
  let am;
  while ((am = assignRe.exec(code)) !== null) {
    const varName = am[1];
    const openIdx = am.index + am[0].length - 1;
    const inner = extractParenContent(code, openIdx);
    const fullExpr = am[2].slice(0, -1).trim() + '(' + inner + ')';
    const lineNum = offsetToLine(starts, am.index);
    refAssignments.push({ varName, fullExpr, lineNum });
  }

  function localRefsAt(lineNum) {
    const map = new Map();
    for (const a of refAssignments) {
      if (a.lineNum <= lineNum && lineNum - a.lineNum <= 80) {
        map.set(a.varName, resolveArgExpr(a.fullExpr, constants, map));
      }
    }
    return map;
  }

  const results = [];
  const callRe = /\b(doc|collection|getDoc|getDocFromServer|getDocs|setDoc|updateDoc|deleteDoc|writeBatch|runTransaction|onSnapshot)\s*\(/g;
  let cm;
  while ((cm = callRe.exec(code)) !== null) {
    const fnName = cm[1];
    const callOffset = cm.index;
    const lineNum = offsetToLine(starts, callOffset);

    // Ignore import lines or type annotations
    const lineText = lines[lineNum - 1] || '';
    if (/^\s*import\b/.test(lineText)) continue;
    // Check dot-prefix (e.g., foo.doc( or foo.collection( wouldn't happen in modular SDK, wait: navigator / map)
    if (callOffset > 0 && code[callOffset - 1] === '.') continue;

    const openIdx = callOffset + cm[0].length - 1;
    const inner = extractParenContent(code, openIdx);
    const args = splitArgs(inner);
    const localRefs = localRefsAt(lineNum);

    let colPath = '(unknown)';
    if (fnName === 'doc' || fnName === 'collection') {
      const cleaned = args[0] === 'db' ? args.slice(1) : args;
      colPath = cleaned.map((a) => resolveArgExpr(a, constants, localRefs)).join('/');
    } else if (fnName === 'writeBatch' || fnName === 'runTransaction') {
      colPath = '(batch/transaction)';
    } else if (args.length > 0) {
      colPath = resolveArgExpr(args[0], constants, localRefs);
    }

    const enclosing = findEnclosingFunction(lines, lineNum, relPath);
    results.push({
      location: `${relPath}:${lineNum}`,
      enclosing,
      op: fnName,
      path: colPath,
    });
  }

  return results;
}

function main() {
  const files = walkFiles(SRC_DIR);
  const allRows = [];
  for (const f of files) {
    allRows.push(...scanFile(f));
  }
  for (const r of allRows) {
    console.log(`${r.location} | ${r.enclosing} | ${r.op} | ${r.path}`);
  }
}

main();
