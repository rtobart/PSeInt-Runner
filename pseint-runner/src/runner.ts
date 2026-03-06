/**
 * runner.ts
 *
 * Responsible for executing the JavaScript code that the transpiler produces.
 *
 * Strategy:
 *  1. Write the generated JS to a temporary file in the OS temp directory.
 *  2. Open (or reuse) a VS Code terminal named "PSeInt Runner".
 *  3. Run `node <tempFile>` in that terminal so the user can see output,
 *     interact with Leer prompts, and keep the terminal open after execution.
 *  4. Clean up the temp file after a short delay.
 *
 * This approach means the generated code runs in a real Node.js process with
 * full stdout/stderr visibility and interactive stdin support.
 */

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

/** Name shown on the VS Code terminal panel */
const TERMINAL_NAME = "PSeInt Runner";

/**
 * Milliseconds to wait before deleting the temp file.
 * 5 seconds gives Node.js time to fully load and execute the script before
 * the file is removed, even on slower machines or with larger programs.
 */
const CLEANUP_DELAY_MS = 5000;

/**
 * Writes `code` to a temp file and executes it inside the VS Code integrated
 * terminal using `node`.
 *
 * @param code      Generated JavaScript source.
 * @param sourcePath  Original .psc file path (used to derive a readable temp name).
 */
export async function runInTerminal(code: string, sourcePath: string): Promise<void> {
  // ── 1. Write generated JS to a temp file ─────────────────────────────────

  const baseName = path.basename(sourcePath, path.extname(sourcePath));
  const tmpDir = os.tmpdir();
  const tmpFile = path.join(tmpDir, `pseint_${baseName}_${Date.now()}.js`);

  fs.writeFileSync(tmpFile, code, "utf-8");

  // ── 2. Obtain or create the runner terminal ───────────────────────────────

  const terminal = getOrCreateTerminal();

  // Show the terminal to the user
  terminal.show(true /* preserveFocus */);

  // ── 3. Run the generated script ───────────────────────────────────────────

  // Quote the path to handle spaces in directory names
  const escapedPath = quoteForShell(tmpFile);
  terminal.sendText(`node ${escapedPath}`);

  // ── 4. Schedule temp-file cleanup ─────────────────────────────────────────

  setTimeout(() => {
    try {
      if (fs.existsSync(tmpFile)) {
        fs.unlinkSync(tmpFile);
      }
    } catch (_) {
      // Non-fatal: if cleanup fails, the OS will eventually reclaim the file
    }
  }, CLEANUP_DELAY_MS);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns the existing "PSeInt Runner" terminal if one is still open,
 * otherwise creates a fresh one.
 */
function getOrCreateTerminal(): vscode.Terminal {
  const existing = vscode.window.terminals.find(t => t.name === TERMINAL_NAME);
  if (existing) {
    return existing;
  }
  return vscode.window.createTerminal({ name: TERMINAL_NAME });
}

/**
 * Wraps a file path in quotes appropriate for the current platform so that
 * paths containing spaces are handled correctly.
 */
function quoteForShell(filePath: string): string {
  if (process.platform === "win32") {
    // CMD / PowerShell: double-quote
    return `"${filePath}"`;
  }
  // bash / zsh: single-quote (safest for arbitrary characters)
  return `'${filePath.replace(/'/g, "'\\''")}'`;
}
