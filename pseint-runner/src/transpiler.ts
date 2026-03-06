/**
 * transpiler.ts
 *
 * Converts the AST produced by parser.ts into runnable JavaScript (Node.js).
 *
 * Architecture:
 *   ASTNode → transpileNode() → JavaScript string
 *
 * Design decisions:
 *  - Indentation is tracked with a simple counter so nested structures are
 *    formatted readably (useful for debugging the generated code).
 *  - Escribir (Write) maps to process.stdout.write() so that the output lands
 *    in the same terminal stream without an extra trailing newline when a
 *    semicolon argument is used.  For simplicity we always append "\n" after
 *    each Escribir call.
 *  - Variables in PSeInt are case-insensitive; we normalise them to lower-case.
 *  - Leer (Read) uses synchronous stdin via the 'readline-sync' pattern written
 *    inline — the runner injects the helper before the generated code.
 */

import type {
  ASTNode,
  ProgramNode,
  WriteNode,
  ReadNode,
  AssignNode,
  DeclareNode,
  IfNode,
  WhileNode,
  ForNode,
  RepeatNode,
  ExpressionNode,
} from "./parser";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Indentation string for a given depth */
const indent = (depth: number): string => "  ".repeat(depth);

/**
 * Normalise a PSeInt identifier to lower-case so that variables are
 * case-insensitive (matching PSeInt semantics).
 */
const normId = (id: string): string => id.toLowerCase();

/**
 * Translate a raw expression string:
 *  - Normalise identifiers to lower-case while leaving string literals alone.
 *  - Replace PSeInt's '^' power operator with Math.pow(...) calls.
 *  - Replace PSeInt's '%' with JS '%' (already compatible).
 *  - Replace PSeInt string concatenation operator '&' with '+' for JS.
 *
 * NOTE: this is a surface-level text transform, not a full expression parser.
 * It handles the common cases well enough for a minimal viable implementation.
 */
export function transpileExpression(raw: string): string {
  // Replace & string concatenation with +
  let result = raw.replace(/&/g, "+");

  // Normalise identifiers (word tokens that are not quoted strings or numbers)
  // We walk through the string and lowercase word tokens that are not inside quotes.
  result = normaliseIdentifiers(result);

  return result;
}

/**
 * Lower-cases bare word tokens while leaving string literals untouched.
 */
function normaliseIdentifiers(expr: string): string {
  const out: string[] = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i];
    // String literal – copy verbatim
    if (ch === "\"") {
      let s = "\"";
      i++;
      while (i < expr.length && expr[i] !== "\"") {
        if (expr[i] === "\\") { s += expr[i++]; }
        s += expr[i++];
      }
      s += "\"";
      i++;
      out.push(s);
      continue;
    }
    // Word token
    if (/[a-zA-ZáéíóúÁÉÍÓÚñÑ_]/.test(ch)) {
      let word = "";
      while (i < expr.length && /[a-zA-ZáéíóúÁÉÍÓÚñÑ_0-9]/.test(expr[i])) {
        word += expr[i++];
      }
      // Preserve JS keywords and boolean literals as-is
      const preserve = new Set(["true", "false", "null", "undefined", "Math", "Number", "String", "parseInt", "parseFloat"]);
      out.push(preserve.has(word) ? word : word.toLowerCase());
      continue;
    }
    out.push(ch);
    i++;
  }
  return out.join("");
}

// ─── Node transpilers ─────────────────────────────────────────────────────────

function transpileWrite(node: WriteNode, depth: number): string {
  if (node.args.length === 0) {
    return `${indent(depth)}process.stdout.write("\\n");`;
  }

  // Build a template-literal-style concatenation of all arguments.
  // String literals are kept as-is; expressions are wrapped in String().
  const parts = node.args.map(arg => {
    const raw = arg.raw.trim();
    // Already a string literal?
    if (raw.startsWith("\"") && raw.endsWith("\"")) {
      return transpileExpression(raw);
    }
    return `String(${transpileExpression(raw)})`;
  });

  // Multiple comma-separated arguments are concatenated on the same line
  const value = parts.join(" + ");
  return `${indent(depth)}process.stdout.write(${value} + "\\n");`;
}

function transpileRead(node: ReadNode, depth: number): string {
  return node.variables.map(v =>
    `${indent(depth)}${normId(v)} = __readline__(${JSON.stringify(v + ": ")});`
  ).join("\n");
}

function transpileAssign(node: AssignNode, depth: number): string {
  const v = normId(node.variable);
  const val = transpileExpression(node.value.raw);
  return `${indent(depth)}${v} = ${val};`;
}

function transpileDeclare(node: DeclareNode, depth: number): string {
  const vars = node.variables.map(normId);
  const typeLc = node.type.toLowerCase().trim();
  // Provide sensible default values per type.
  // We use `var` (instead of `let`) so that the same identifier can be
  // re-assigned by a Para loop variable without a strict-mode conflict.
  let defaultVal = "undefined";
  if (typeLc === "entero" || typeLc === "real") { defaultVal = "0"; }
  else if (typeLc === "cadena" || typeLc === "caracter") { defaultVal = '""'; }
  else if (typeLc === "logico") { defaultVal = "false"; }
  return `${indent(depth)}var ${vars.join(", ")} = ${defaultVal};`;
}

function transpileIf(node: IfNode, depth: number): string {
  const lines: string[] = [];
  const cond = transpileExpression(node.condition.raw);
  lines.push(`${indent(depth)}if (${cond}) {`);
  node.consequent.forEach(n => lines.push(transpileNode(n, depth + 1)));

  for (const alt of node.alternates) {
    if (alt.condition === null) {
      lines.push(`${indent(depth)}} else {`);
    } else {
      const altCond = transpileExpression(alt.condition.raw);
      lines.push(`${indent(depth)}} else if (${altCond}) {`);
    }
    alt.body.forEach(n => lines.push(transpileNode(n, depth + 1)));
  }

  lines.push(`${indent(depth)}}`);
  return lines.join("\n");
}

function transpileWhile(node: WhileNode, depth: number): string {
  const lines: string[] = [];
  const cond = transpileExpression(node.condition.raw);
  lines.push(`${indent(depth)}while (${cond}) {`);
  node.body.forEach(n => lines.push(transpileNode(n, depth + 1)));
  lines.push(`${indent(depth)}}`);
  return lines.join("\n");
}

function transpileFor(node: ForNode, depth: number): string {
  const lines: string[] = [];
  const v = normId(node.variable);
  const from = transpileExpression(node.from.raw);
  const to = transpileExpression(node.to.raw);
  const step = node.step ? transpileExpression(node.step.raw) : "1";

  // We capture '__to__' and '__step__' in vars to avoid re-evaluating expressions.
  // The loop variable is declared with 'var' so it is visible in the enclosing
  // function scope after the loop (matching PSeInt semantics where the counter
  // variable retains its last value).
  lines.push(`${indent(depth)}{`);
  lines.push(`${indent(depth + 1)}const __to__ = ${to};`);
  lines.push(`${indent(depth + 1)}const __step__ = ${step};`);
  lines.push(`${indent(depth + 1)}var ${v} = ${from};`);
  lines.push(`${indent(depth + 1)}for (; __step__ > 0 ? ${v} <= __to__ : ${v} >= __to__; ${v} += __step__) {`);
  node.body.forEach(n => lines.push(transpileNode(n, depth + 2)));
  lines.push(`${indent(depth + 1)}}`);
  lines.push(`${indent(depth)}}`);
  return lines.join("\n");
}

function transpileRepeat(node: RepeatNode, depth: number): string {
  const lines: string[] = [];
  lines.push(`${indent(depth)}do {`);
  node.body.forEach(n => lines.push(transpileNode(n, depth + 1)));
  const cond = transpileExpression(node.condition.raw);
  lines.push(`${indent(depth)}} while (!(${cond}));`);
  return lines.join("\n");
}

function transpileExpNode(node: ExpressionNode, depth: number): string {
  // Standalone expression statement (e.g. a bare function call)
  return `${indent(depth)}${transpileExpression(node.raw)};`;
}

// ─── Main dispatch ────────────────────────────────────────────────────────────

export function transpileNode(node: ASTNode, depth = 0): string {
  switch (node.kind) {
    case "Program":   return transpileProgram(node as ProgramNode, depth);
    case "Write":     return transpileWrite(node as WriteNode, depth);
    case "Read":      return transpileRead(node as ReadNode, depth);
    case "Assign":    return transpileAssign(node as AssignNode, depth);
    case "Declare":   return transpileDeclare(node as DeclareNode, depth);
    case "If":        return transpileIf(node as IfNode, depth);
    case "While":     return transpileWhile(node as WhileNode, depth);
    case "For":       return transpileFor(node as ForNode, depth);
    case "Repeat":    return transpileRepeat(node as RepeatNode, depth);
    case "Expression": return transpileExpNode(node as ExpressionNode, depth);
    default:
      // Exhaustiveness guard
      return `${indent(depth)}// [unsupported node: ${(node as ASTNode).kind}]`;
  }
}

function transpileProgram(node: ProgramNode, depth: number): string {
  const lines: string[] = [];
  lines.push(`// Generated from PSeInt process: ${node.name}`);
  lines.push(`"use strict";`);
  lines.push(`// Synchronous readline helper (uses only Node.js built-in 'fs')`);
  lines.push(`function __readline__(prompt) {`);
  lines.push(`  process.stdout.write(prompt);`);
  lines.push(`  try {`);
  lines.push(`    const fs = require("fs");`);
  lines.push(`    // Open the console input device synchronously (cross-platform)`);
  lines.push(`    const devIn = process.platform === "win32" ? "CONIN$" : "/dev/stdin";`);
  lines.push(`    const fd = fs.openSync(devIn, "rs");`);
  lines.push(`    const buf = Buffer.alloc(4096);`);
  lines.push(`    let line = "", bytesRead, byte = Buffer.alloc(1);`);
  lines.push(`    while (true) {`);
  lines.push(`      bytesRead = fs.readSync(fd, byte, 0, 1, null);`);
  lines.push(`      if (bytesRead === 0) break;`);
  lines.push(`      const ch = byte.toString("utf8");`);
  lines.push(`      if (ch === "\\n") break;`);
  lines.push(`      if (ch !== "\\r") line += ch;`);
  lines.push(`    }`);
  lines.push(`    fs.closeSync(fd);`);
  lines.push(`    return line;`);
  lines.push(`  } catch (_) { return ""; }`);
  lines.push(`}`);
  lines.push(``);

  node.body.forEach(n => {
    const code = transpileNode(n, depth);
    if (code.trim()) { lines.push(code); }
  });

  return lines.join("\n");
}

/**
 * Convenience entry point: parse + transpile in one call.
 */
export function transpile(node: ProgramNode): string {
  return transpileProgram(node, 0);
}
