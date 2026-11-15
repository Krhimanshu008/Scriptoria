import { spawn } from "child_process";
import path from "path";
import fs from "fs";

/**
 * Executes a pipeline_bridge CLI command from Node.js, passing optional stdin and returning parsed JSON.
 */
export async function runPipelineBridge<T = any>(
  command: string,
  args: string[] = [],
  stdinData?: string,
  timeoutMs: number = 30000
): Promise<T> {
  let rootDir = process.cwd();
  let bridgeScript = path.resolve(rootDir, "backend", "scripts", "pipeline_bridge.py");

  if (!fs.existsSync(bridgeScript)) {
    rootDir = path.resolve(process.cwd(), "..");
    bridgeScript = path.resolve(rootDir, "backend", "scripts", "pipeline_bridge.py");
  }

  return new Promise<T>((resolve, reject) => {
    const child = spawn("python", [bridgeScript, command, ...args], {
      cwd: rootDir,
      env: { ...process.env, PYTHONPATH: path.resolve(rootDir, "backend") },
    });

    let stdout = "";
    let stderr = "";

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`pipeline_bridge command '${command}' timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0 && !stdout.trim()) {
        reject(new Error(`Command failed with code ${code}: ${stderr}`));
        return;
      }
      try {
        const trimmed = stdout.trim();
        // Locate first '{' or '[' and last matching '}' or ']'
        const firstBrace = trimmed.indexOf("{");
        const lastBrace = trimmed.lastIndexOf("}");
        const firstBracket = trimmed.indexOf("[");
        const lastBracket = trimmed.lastIndexOf("]");

        let jsonCandidate = trimmed;
        if (firstBrace !== -1 && lastBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
          jsonCandidate = trimmed.slice(firstBrace, lastBrace + 1);
        } else if (firstBracket !== -1 && lastBracket !== -1) {
          jsonCandidate = trimmed.slice(firstBracket, lastBracket + 1);
        }

        const parsed = JSON.parse(jsonCandidate);
        resolve(parsed as T);
      } catch (err) {
        // Return raw text if not JSON
        resolve({ output: stdout, stderr, code } as unknown as T);
      }
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    if (stdinData) {
      child.stdin.write(stdinData);
      child.stdin.end();
    }
  });
}
