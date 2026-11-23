import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export function walk(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(path));
    else if (entry.isFile() && entry.name.endsWith('.js')) files.push(path);
  }
  return files.sort();
}

export async function loadModules(directory) {
  const modules = [];
  for (const file of walk(directory)) {
    const loaded = await import(pathToFileURL(file).href);
    modules.push({ file, module: loaded.default });
  }
  return modules;
}
