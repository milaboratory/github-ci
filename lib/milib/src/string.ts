/**
 * Count number of <substr> fragments inside <str>.
 * Full <substr> is searched in <str>:
 *   countOccurrences("FFmmmmmFFFmmmFmmFFmmmFFF", "FF") // returns '4'
 */
export function countOccurrences(str: string, substr: string): number {
  let index = 0;
  let startIndex = 0;
  const searchStrLen = substr.length;

  if (searchStrLen === 0) {
    return 0;
  }

  let count = 0;

  while ((index = str.indexOf(substr, startIndex)) > -1) {
    count = count + 1;
    startIndex = index + searchStrLen;
  }

  return count;
}
