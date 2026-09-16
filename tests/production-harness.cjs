'use strict';

// No browser, database or credentials are needed. This harness evaluates the
// functions copied verbatim from index.html, with explicit boundary stubs.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const filename = path.resolve(__dirname, '../index.html');
const html = fs.readFileSync(filename, 'utf8');

function inlineScripts() {
  const scripts = [];
  const pattern = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let match;
  while ((match = pattern.exec(html))) {
    if (/\bsrc\s*=/i.test(match[1])) continue;
    scripts.push({ source: match[2], line: html.slice(0, match.index).split('\n').length });
  }
  return scripts;
}

function syntaxCheck() {
  return inlineScripts().map(({ source, line }) => {
    new vm.Script(source, { filename, lineOffset: line - 1 });
    return { line, characters: source.length };
  });
}

function extractFunction(name) {
  if (!/^[A-Za-z_$][\w$]*$/.test(name)) throw new Error('Invalid function name');
  const startPattern = new RegExp(`^(?:async\\s+)?function\\s+${name}\\s*\\(`, 'm');
  for (const { source, line } of inlineScripts()) {
    const start = startPattern.exec(source);
    if (!start) continue;
    // Top-level declarations in this app close at column zero. Test each
    // candidate with the JS parser, so braces in template text do not truncate
    // a function. Never execute any top-level application initialization.
    const ends = /^\}[;\t ]*\r?$/gm;
    ends.lastIndex = start.index;
    let end;
    while ((end = ends.exec(source))) {
      const code = source.slice(start.index, end.index + 1);
      try {
        new vm.Script(`(${code})`, { filename });
        return { code, line: line + source.slice(0, start.index).split('\n').length - 1 };
      } catch (error) {
        if (error.name !== 'SyntaxError') throw error;
      }
    }
    throw new Error(`Cannot isolate production function ${name}`);
  }
  throw new Error(`Missing production function ${name}`);
}

function extractDeclaration(name) {
  if (!/^[A-Za-z_$][\w$]*$/.test(name)) throw new Error('Invalid declaration name');
  const pattern = new RegExp(`^(?:const|let|var)\\s+${name}\\s*=`, 'm');
  for (const { source, line } of inlineScripts()) {
    const start = pattern.exec(source);
    if (!start) continue;
    for (let end = source.indexOf(';', start.index); end >= 0; end = source.indexOf(';', end + 1)) {
      const code = source.slice(start.index, end + 1);
      try {
        new vm.Script(code, { filename });
        return { code, line: line + source.slice(0, start.index).split('\n').length - 1 };
      } catch (error) {
        if (error.name !== 'SyntaxError') throw error;
      }
    }
  }
  throw new Error(`Missing production declaration ${name}`);
}

function productionContext(names, globals = {}, declarations = []) {
  const sandbox = {
    console: { log() {}, info() {}, warn() {}, error() {} },
    performance: require('node:perf_hooks').performance,
    setTimeout, clearTimeout, AbortController,
    ...globals,
  };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  for (const name of declarations) {
    const { code, line } = extractDeclaration(name);
    new vm.Script(code, { filename, lineOffset: line - 1 }).runInContext(context);
  }
  for (const name of names) {
    const { code, line } = extractFunction(name);
    new vm.Script(code, { filename, lineOffset: line - 1 }).runInContext(context);
  }
  return context;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

module.exports = { filename, html, inlineScripts, syntaxCheck, extractFunction, extractDeclaration, productionContext, deferred };

if (require.main === module) {
  const checked = syntaxCheck();
  process.stdout.write(`Parsed ${checked.length} inline scripts (${checked.reduce((n, s) => n + s.characters, 0)} characters).\n`);
}
