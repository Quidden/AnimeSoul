import { spawn } from "node:child_process";
export function command(args, options = {}) {
  const cli = process.env.npm_execpath;
  if (!cli || !/\.[cm]?js$/.test(cli)) throw new Error("Run through a pnpm script.");
  return spawn(process.execPath, [cli, ...args], { stdio: "inherit", ...options });
}
export async function run(args) {
  const child = command(args);
  const code = await new Promise((resolve, reject) => {
    child.once("exit", resolve);
    child.once("error", reject);
  });
  if (code !== 0) throw new Error("Command failed: pnpm " + args.join(" "));
}
