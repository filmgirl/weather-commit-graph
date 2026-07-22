import { gitLines } from './exec.ts';

/**
 * Byte size of every tracked file at HEAD, keyed by path.
 *
 * Used as the complexity half of the hotspot score. Bytes rather than line count
 * is deliberate: `ls-tree -l` reports sizes straight from the object database, so
 * this stays cheap even on a large repository, and relative size is all the score
 * needs.
 */
export async function readFileSizes(repoPath: string): Promise<Map<string, number>> {
  const sizes = new Map<string, number>();

  await gitLines(repoPath, ['ls-tree', '-r', '-l', 'HEAD'], (line) => {
    // <mode> <type> <sha> <size>\t<path>
    const tab = line.indexOf('\t');
    if (tab === -1) return;

    const meta = line.slice(0, tab).trim().split(/\s+/);
    const filePath = line.slice(tab + 1);
    if (meta[1] !== 'blob') return;

    const size = Number(meta[3]);
    if (!Number.isFinite(size)) return;
    sizes.set(filePath, size);
  });

  return sizes;
}
