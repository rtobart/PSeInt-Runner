/**
 * extension.ts
 *
 * VS Code extension entry point.
 *
 * Architecture:
 *   activate()
 *     └─ registers command "pseintRunner.run"
 *           └─ reads the active .psc document
 *           └─ calls parse()      (parser.ts)   → ProgramNode AST
 *           └─ calls transpile()  (transpiler.ts) → JavaScript string
 *           └─ calls runInTerminal() (runner.ts)  → executes in terminal
 *
 * The extension activates whenever VS Code opens a file whose language is
 * "pseint" (i.e. any .psc file), as declared in package.json.
 */

import * as vscode from "vscode";
import { parse } from "./parser";
import { transpile } from "./transpiler";
import { runInTerminal } from "./runner";

/**
 * Called by VS Code when the extension is activated.
 * Registers the "pseintRunner.run" command.
 */
export function activate(context: vscode.ExtensionContext): void {
  const runCommand = vscode.commands.registerCommand(
    "pseintRunner.run",
    async () => {
      // ── Validate active editor ─────────────────────────────────────────────

      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage(
          "PSeInt Runner: no active editor. Please open a .psc file first."
        );
        return;
      }

      const document = editor.document;
      if (document.languageId !== "pseint") {
        vscode.window.showWarningMessage(
          "PSeInt Runner: the active file does not appear to be a PSeInt (.psc) file."
        );
        // Allow the user to continue if they explicitly ran the command
      }

      // Save any unsaved changes before running
      if (document.isDirty) {
        await document.save();
      }

      const source = document.getText();
      const filePath = document.fileName;

      // ── Parse ──────────────────────────────────────────────────────────────

      let ast;
      try {
        ast = parse(source);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`PSeInt Runner – parse error: ${msg}`);
        return;
      }

      // ── Transpile ──────────────────────────────────────────────────────────

      let jsCode: string;
      try {
        jsCode = transpile(ast);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`PSeInt Runner – transpile error: ${msg}`);
        return;
      }

      // ── Execute ────────────────────────────────────────────────────────────

      try {
        await runInTerminal(jsCode, filePath);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`PSeInt Runner – execution error: ${msg}`);
      }
    }
  );

  context.subscriptions.push(runCommand);
}

/**
 * Called by VS Code when the extension is deactivated.
 * No cleanup is needed for this extension.
 */
export function deactivate(): void {
  // nothing to clean up
}
