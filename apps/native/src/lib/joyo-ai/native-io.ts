import { Directory, File, Paths } from "expo-file-system";

import type { FileIo } from "./file-kv";

const DIR = "joyo-ai";

const dir = (): Directory => new Directory(Paths.document, DIR);

/** Joyo AI's files: `<documents>/joyo-ai/<key>.json`. */
export const nativeFileIo: FileIo = {
  async read(name) {
    const file = new File(dir(), name);
    if (!file.exists) return null;
    return file.text();
  },
  async write(name, text) {
    const folder = dir();
    if (!folder.exists) folder.create({ intermediates: true });
    new File(folder, name).write(text);
  },
  async remove(name) {
    const file = new File(dir(), name);
    if (file.exists) file.delete();
  },
  async clear() {
    const folder = dir();
    if (folder.exists) folder.delete();
  },
};
