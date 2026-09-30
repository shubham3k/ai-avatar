import { access, mkdir, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { NOTES_SUBFOLDER } from "./documents.js";

/** Windows-safe file name from a note title. */
export function noteFileName(title: string): string {
  const cleaned = title
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "")
    .slice(0, 80);
  return `${cleaned || "Note"}.md`;
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

/**
 * ADR-006 §7: notes are plain Markdown files the user owns, in
 * <documents folder>/Notes. Never overwrites: "Budget.md" exists → "Budget (2).md".
 */
export async function writeNote(documentsFolder: string, title: string, content: string, now: Date = new Date()): Promise<string> {
  const folder = join(documentsFolder, NOTES_SUBFOLDER);
  await mkdir(folder, { recursive: true });
  const base = noteFileName(title).replace(/\.md$/, "");
  let path = join(folder, `${base}.md`);
  for (let n = 2; await exists(path); n += 1) path = join(folder, `${base} (${n}).md`);
  const body = `# ${title.trim() || "Note"}\n\n${content.trim()}\n\n_Created by Zara · ${now.toLocaleString("en-GB")}_\n`;
  await writeFile(path, body, { encoding: "utf-8", flag: "wx" });
  return path;
}

/** Undo for a note Zara created — only ever deletes a .md file directly inside a Notes folder. */
export async function deleteCreatedNote(path: string): Promise<boolean> {
  const absolute = resolve(path);
  if (!absolute.toLowerCase().endsWith(".md") || basename(dirname(absolute)) !== NOTES_SUBFOLDER) return false;
  try {
    await unlink(absolute);
    return true;
  } catch {
    return false;
  }
}
