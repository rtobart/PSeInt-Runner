/**
 * parser.ts
 *
 * Responsible for tokenising PSeInt pseudocode and building a simple
 * Abstract Syntax Tree (AST) that the transpiler can consume.
 *
 * Architecture overview:
 *   Source text
 *     → tokenise()  → Token[]
 *     → parse()     → ASTNode (Program)
 *
 * The AST is intentionally minimal: each node carries a `kind` discriminant
 * and the child nodes or literal values needed by the transpiler.
 */

// ─── Token types ─────────────────────────────────────────────────────────────

export type TokenKind =
  | "KEYWORD"
  | "IDENTIFIER"
  | "NUMBER"
  | "STRING"
  | "OPERATOR"
  | "ASSIGN"       // <-
  | "SEMICOLON"
  | "LPAREN"
  | "RPAREN"
  | "COMMA"
  | "EOL"          // end of logical line (newline / semicolon)
  | "EOF";

export interface Token {
  kind: TokenKind;
  value: string;
  line: number;
}

// ─── AST node types ───────────────────────────────────────────────────────────

export type ASTNode =
  | ProgramNode
  | WriteNode
  | ReadNode
  | AssignNode
  | DeclareNode
  | IfNode
  | WhileNode
  | ForNode
  | RepeatNode
  | ExpressionNode;

export interface ProgramNode {
  kind: "Program";
  name: string;
  body: ASTNode[];
}

export interface WriteNode {
  kind: "Write";
  args: ExpressionNode[];
}

export interface ReadNode {
  kind: "Read";
  variables: string[];
}

export interface AssignNode {
  kind: "Assign";
  variable: string;
  value: ExpressionNode;
}

export interface DeclareNode {
  kind: "Declare";
  variables: string[];
  type: string;
}

export interface IfNode {
  kind: "If";
  condition: ExpressionNode;
  consequent: ASTNode[];
  alternates: Array<{ condition: ExpressionNode | null; body: ASTNode[] }>;
}

export interface WhileNode {
  kind: "While";
  condition: ExpressionNode;
  body: ASTNode[];
}

export interface ForNode {
  kind: "For";
  variable: string;
  from: ExpressionNode;
  to: ExpressionNode;
  step: ExpressionNode | null;
  body: ASTNode[];
}

export interface RepeatNode {
  kind: "Repeat";
  body: ASTNode[];
  condition: ExpressionNode;
}

export interface ExpressionNode {
  kind: "Expression";
  /** Raw expression text — preserved as-is for simple transpilation */
  raw: string;
}

// ─── Keywords (case-insensitive) ──────────────────────────────────────────────

const KEYWORDS = new Set([
  "proceso", "finproceso", "algoritmo", "finalgoritmo",
  "escribir", "leer",
  "definir", "como",
  "entero", "real", "cadena", "logico", "caracter",
  "si", "entonces", "sino", "sinosi", "finsi",
  "para", "hasta", "con", "paso", "hacer", "finpara",
  "mientras", "finmientras",
  "repetir", "hastaque", "que",
  "y", "o", "no",
  "verdadero", "falso",
]);

// ─── Tokeniser ────────────────────────────────────────────────────────────────

/**
 * Converts raw PSeInt source text into a flat list of tokens.
 * The tokeniser is line-oriented: it walks character by character and
 * groups characters into tokens, emitting EOL tokens at line boundaries.
 */
export function tokenise(source: string): Token[] {
  const tokens: Token[] = [];
  const lines = source.split(/\r?\n/);

  for (let lineNo = 0; lineNo < lines.length; lineNo++) {
    const lineNum = lineNo + 1;
    let col = 0;
    const line = lines[lineNo];

    const skip = (n = 1) => { col += n; };
    const peek = (offset = 0) => line[col + offset] ?? "";
    const atEnd = () => col >= line.length;

    while (!atEnd()) {
      const ch = peek();

      // Skip whitespace
      if (/\s/.test(ch)) { skip(); continue; }

      // Line comment
      if (ch === "/" && peek(1) === "/") {
        break; // rest of line is a comment
      }

      // String literal
      if (ch === "\"") {
        let value = "\"";
        skip();
        while (!atEnd() && peek() !== "\"") {
          if (peek() === "\\") { value += peek(); skip(); }
          value += peek();
          skip();
        }
        value += "\"";
        skip(); // closing quote
        tokens.push({ kind: "STRING", value, line: lineNum });
        continue;
      }

      // Assignment operator <-
      if (ch === "<" && peek(1) === "-") {
        tokens.push({ kind: "ASSIGN", value: "<-", line: lineNum });
        skip(2);
        continue;
      }

      // Two-char comparison operators
      if ((ch === "<" || ch === ">" || ch === "!") && peek(1) === "=") {
        tokens.push({ kind: "OPERATOR", value: ch + "=", line: lineNum });
        skip(2);
        continue;
      }
      if (ch === "<" && peek(1) === ">") {
        tokens.push({ kind: "OPERATOR", value: "<>", line: lineNum });
        skip(2);
        continue;
      }

      // Single-char operators & punctuation
      if ("<>=+-*/%^".includes(ch)) {
        tokens.push({ kind: "OPERATOR", value: ch, line: lineNum });
        skip();
        continue;
      }
      if (ch === "(") { tokens.push({ kind: "LPAREN", value: ch, line: lineNum }); skip(); continue; }
      if (ch === ")") { tokens.push({ kind: "RPAREN", value: ch, line: lineNum }); skip(); continue; }
      if (ch === ",") { tokens.push({ kind: "COMMA", value: ch, line: lineNum }); skip(); continue; }
      if (ch === ";") { tokens.push({ kind: "SEMICOLON", value: ch, line: lineNum }); skip(); continue; }

      // Numbers
      if (/[0-9]/.test(ch)) {
        let value = "";
        while (!atEnd() && /[0-9.]/.test(peek())) { value += peek(); skip(); }
        tokens.push({ kind: "NUMBER", value, line: lineNum });
        continue;
      }

      // Identifiers / keywords
      if (/[a-zA-ZáéíóúÁÉÍÓÚñÑ_]/.test(ch)) {
        let value = "";
        while (!atEnd() && /[a-zA-ZáéíóúÁÉÍÓÚñÑ_0-9]/.test(peek())) {
          value += peek();
          skip();
        }
        const lower = value.toLowerCase();
        const kind: TokenKind = KEYWORDS.has(lower) ? "KEYWORD" : "IDENTIFIER";
        tokens.push({ kind, value, line: lineNum });
        continue;
      }

      // Unknown character – skip it
      skip();
    }

    // End of logical line
    tokens.push({ kind: "EOL", value: "\n", line: lineNum });
  }

  tokens.push({ kind: "EOF", value: "", line: lines.length });
  return tokens;
}

// ─── Parser ───────────────────────────────────────────────────────────────────

/**
 * Recursive-descent parser.  Consumes the token list produced by tokenise()
 * and returns a ProgramNode AST ready for the transpiler.
 */
export function parse(source: string): ProgramNode {
  const tokens = tokenise(source);
  let pos = 0;

  // ── Helpers ──────────────────────────────────────────────────────────────

  const peek = (offset = 0): Token => tokens[Math.min(pos + offset, tokens.length - 1)];
  const advance = (): Token => tokens[pos++];

  const isKeyword = (value: string, offset = 0): boolean =>
    peek(offset).kind === "KEYWORD" &&
    peek(offset).value.toLowerCase() === value.toLowerCase();

  const consumeKeyword = (value: string): void => {
    if (!isKeyword(value)) {
      throw new Error(
        `Line ${peek().line}: expected keyword '${value}', got '${peek().value}'`
      );
    }
    advance();
  };

  /** Skip EOL and SEMICOLON tokens */
  const skipEOL = (): void => {
    while (peek().kind === "EOL" || peek().kind === "SEMICOLON") advance();
  };

  /** Consume the rest of a line up to (but not including) the next EOL/EOF */
  const restOfLine = (): string => {
    const parts: string[] = [];
    while (peek().kind !== "EOL" && peek().kind !== "EOF" && peek().kind !== "SEMICOLON") {
      parts.push(advance().value);
    }
    return parts.join(" ").trim();
  };

  // ── Expression parsing (raw text, operator translation) ───────────────────

  /**
   * Reads tokens until an EOL/EOF/SEMICOLON or a stop keyword is reached and
   * returns them as a single ExpressionNode with translated operators.
   */
  const parseExpression = (stopKeywords: string[] = []): ExpressionNode => {
    const parts: string[] = [];
    while (
      peek().kind !== "EOL" &&
      peek().kind !== "EOF" &&
      peek().kind !== "SEMICOLON" &&
      !(peek().kind === "KEYWORD" &&
        stopKeywords.some(k => k.toLowerCase() === peek().value.toLowerCase()))
    ) {
      const tok = advance();
      if (tok.kind === "KEYWORD") {
        const lc = tok.value.toLowerCase();
        if (lc === "y") { parts.push("&&"); }
        else if (lc === "o") { parts.push("||"); }
        else if (lc === "no") { parts.push("!"); }
        else if (lc === "verdadero") { parts.push("true"); }
        else if (lc === "falso") { parts.push("false"); }
        else { parts.push(tok.value); }
      } else if (tok.kind === "OPERATOR" && tok.value === "=") {
        // In PSeInt '=' is equality comparison (not assignment)
        parts.push("===");
      } else if (tok.kind === "OPERATOR" && tok.value === "<>") {
        parts.push("!==");
      } else {
        parts.push(tok.value);
      }
    }
    return { kind: "Expression", raw: parts.join(" ").trim() };
  };

  // ── Statement parsers ─────────────────────────────────────────────────────

  const parseWrite = (): WriteNode => {
    consumeKeyword("escribir");
    const args: ExpressionNode[] = [];
    // Collect comma-separated expressions
    while (peek().kind !== "EOL" && peek().kind !== "EOF" && peek().kind !== "SEMICOLON") {
      // If next token is a comma that we just emitted, skip it
      if (peek().kind === "COMMA") { advance(); continue; }
      // Collect expression until comma, EOL, or EOF
      const parts: string[] = [];
      while (
        peek().kind !== "EOL" &&
        peek().kind !== "EOF" &&
        peek().kind !== "SEMICOLON" &&
        peek().kind !== "COMMA"
      ) {
        const tok = advance();
        if (tok.kind === "KEYWORD") {
          const lc = tok.value.toLowerCase();
          if (lc === "verdadero") { parts.push("true"); }
          else if (lc === "falso") { parts.push("false"); }
          else { parts.push(tok.value); }
        } else {
          parts.push(tok.value);
        }
      }
      const raw = parts.join(" ").trim();
      if (raw) { args.push({ kind: "Expression", raw }); }
    }
    return { kind: "Write", args };
  };

  const parseRead = (): ReadNode => {
    consumeKeyword("leer");
    const variables: string[] = [];
    while (peek().kind !== "EOL" && peek().kind !== "EOF" && peek().kind !== "SEMICOLON") {
      if (peek().kind === "COMMA") { advance(); continue; }
      variables.push(advance().value);
    }
    return { kind: "Read", variables };
  };

  const parseDeclare = (): DeclareNode => {
    consumeKeyword("definir");
    const variables: string[] = [];
    while (!isKeyword("como") && peek().kind !== "EOL" && peek().kind !== "EOF") {
      if (peek().kind === "COMMA") { advance(); continue; }
      variables.push(advance().value);
    }
    consumeKeyword("como");
    const type = restOfLine();
    return { kind: "Declare", variables, type };
  };

  const parseAssign = (): AssignNode => {
    const variable = advance().value; // identifier
    advance(); // consume '<-'
    const value = parseExpression();
    return { kind: "Assign", variable, value };
  };

  // Forward declaration for parseBody
  let parseBody: (stopKeywords: string[]) => ASTNode[];

  const parseIf = (): IfNode => {
    consumeKeyword("si");
    const condition = parseExpression(["entonces"]);
    consumeKeyword("entonces");
    skipEOL();
    const consequent = parseBody(["sino", "sinosi", "finsi"]);
    const alternates: IfNode["alternates"] = [];

    while (isKeyword("sinosi")) {
      consumeKeyword("sinosi");
      const altCondition = parseExpression(["entonces"]);
      consumeKeyword("entonces");
      skipEOL();
      const altBody = parseBody(["sino", "sinosi", "finsi"]);
      alternates.push({ condition: altCondition, body: altBody });
    }

    if (isKeyword("sino")) {
      consumeKeyword("sino");
      skipEOL();
      const elseBody = parseBody(["finsi"]);
      alternates.push({ condition: null, body: elseBody });
    }

    consumeKeyword("finsi");
    return { kind: "If", condition, consequent, alternates };
  };

  const parseWhile = (): WhileNode => {
    consumeKeyword("mientras");
    const condition = parseExpression(["hacer"]);
    // "Hacer" is optional in some PSeInt dialects; consume if present
    if (isKeyword("hacer")) { advance(); }
    skipEOL();
    const body = parseBody(["finmientras"]);
    consumeKeyword("finmientras");
    return { kind: "While", condition, body };
  };

  const parseFor = (): ForNode => {
    consumeKeyword("para");
    const variable = advance().value; // loop variable
    advance(); // consume '<-'
    const from = parseExpression(["hasta"]);
    consumeKeyword("hasta");
    const to = parseExpression(["con", "hacer", "finpara"]);
    let step: ExpressionNode | null = null;
    if (isKeyword("con")) {
      consumeKeyword("con");
      consumeKeyword("paso");
      step = parseExpression(["hacer", "finpara"]);
    }
    if (isKeyword("hacer")) { advance(); }
    skipEOL();
    const body = parseBody(["finpara"]);
    consumeKeyword("finpara");
    return { kind: "For", variable, from, to, step, body };
  };

  const parseRepeat = (): RepeatNode => {
    consumeKeyword("repetir");
    skipEOL();
    const body = parseBody(["hastaque", "hasta"]);
    // Accept both "HastaQue" (one token) and "Hasta Que" (two tokens)
    if (isKeyword("hastaque")) {
      advance();
    } else {
      consumeKeyword("hasta");
      consumeKeyword("que");
    }
    const condition = parseExpression();
    return { kind: "Repeat", body, condition };
  };

  // ── Body parser ───────────────────────────────────────────────────────────

  parseBody = (stopKeywords: string[]): ASTNode[] => {
    const nodes: ASTNode[] = [];
    while (peek().kind !== "EOF") {
      skipEOL();
      if (peek().kind === "EOF") { break; }

      // Check for stop keywords
      const lc = peek().value.toLowerCase();
      if (
        peek().kind === "KEYWORD" &&
        stopKeywords.some(k => k.toLowerCase() === lc)
      ) {
        break;
      }

      const node = parseStatement();
      if (node) { nodes.push(node); }
    }
    return nodes;
  };

  // ── Statement dispatcher ──────────────────────────────────────────────────

  const parseStatement = (): ASTNode | null => {
    skipEOL();
    const tok = peek();
    if (tok.kind === "EOF") { return null; }

    if (tok.kind === "KEYWORD") {
      const lc = tok.value.toLowerCase();
      if (lc === "escribir") { return parseWrite(); }
      if (lc === "leer") { return parseRead(); }
      if (lc === "definir") { return parseDeclare(); }
      if (lc === "si") { return parseIf(); }
      if (lc === "mientras") { return parseWhile(); }
      if (lc === "para") { return parseFor(); }
      if (lc === "repetir") { return parseRepeat(); }
      // Unknown keyword – skip to next line
      restOfLine();
      return null;
    }

    if (tok.kind === "IDENTIFIER") {
      // Could be assignment: IDENTIFIER '<-' ...
      if (peek(1).kind === "ASSIGN") {
        return parseAssign();
      }
      // Otherwise skip
      restOfLine();
      return null;
    }

    // Skip anything else
    advance();
    return null;
  };

  // ── Top-level program ──────────────────────────────────────────────────────

  skipEOL();

  // Accept both "Proceso" and "Algoritmo" as program headers
  let programName = "Main";
  if (isKeyword("proceso") || isKeyword("algoritmo")) {
    advance(); // consume keyword
    programName = peek().kind !== "EOL" && peek().kind !== "EOF"
      ? advance().value
      : "Main";
  }

  skipEOL();

  const endKeywords = ["finproceso", "finalgoritmo"];
  const body = parseBody(endKeywords);

  // Consume optional FinProceso / FinAlgoritmo
  if (peek().kind === "KEYWORD" && endKeywords.includes(peek().value.toLowerCase())) {
    advance();
  }

  return { kind: "Program", name: programName, body };
}
