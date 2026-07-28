import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "packages/react/src/styles.css");
const dest = join(root, "packages/react/dist/styles.css");

mkdirSync(dirname(dest), { recursive: true });
copyFileSync(src, dest);
console.log("Copied styles.css → dist/");
