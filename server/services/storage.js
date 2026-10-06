// File storage for processed images. Local disk is the only implementation; the
// interface (put / remove / cleanup) is small enough that an S3 or R2 version could
// replace it without touching the media logic.
//
// Safety: callers pass a bare file name, never a path. Names must match FILE_NAME,
// are resolved inside the upload directory, and are written atomically (temp file +
// rename) so a half-written image is never served.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export const FILE_NAME = /^[a-f0-9]{32}-\d{1,4}\.webp$/;
const TEMP_SUFFIX = '.partial';

export function createLocalStorage({ dir }) {
  const root = path.resolve(dir);

  function resolve(name) {
    if (typeof name !== 'string' || !FILE_NAME.test(name)) throw new Error(`Refusing unsafe storage name: ${JSON.stringify(name)}`);
    const full = path.join(root, name);
    if (path.dirname(full) !== root) throw new Error('Refusing path outside the upload directory');
    return full;
  }

  return {
    async put(name, buffer) {
      const target = resolve(name);
      const temp = `${target}.${crypto.randomBytes(6).toString('hex')}${TEMP_SUFFIX}`;
      try {
        await fs.writeFile(temp, buffer, { flag: 'wx' }); // wx: never overwrite an existing file
        await fs.rename(temp, target);
      } catch (err) {
        await fs.rm(temp, { force: true });
        throw err;
      }
    },

    async remove(name) {
      await fs.rm(resolve(name), { force: true });
    },

    // Startup housekeeping: delete temp files left by a crash mid-write.
    async cleanupPartials() {
      await fs.mkdir(root, { recursive: true });
      const leftovers = (await fs.readdir(root)).filter((f) => f.endsWith(TEMP_SUFFIX));
      await Promise.all(leftovers.map((f) => fs.rm(path.join(root, f), { force: true })));
      return leftovers.length;
    },
  };
}
