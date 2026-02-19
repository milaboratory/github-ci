import * as util from "./util";
import { test, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

let tempDir: string;
let testDir: string;

beforeAll(async () => {
  // Create temp directory
  tempDir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "expandPaths-test-"),
  );

  // Change to temp directory
  process.chdir(tempDir);

  // Create test directory structure
  testDir = path.join(tempDir, "test-dir");
  await fs.promises.mkdir(testDir, { recursive: true });
  await fs.promises.mkdir(path.join(testDir, "subdir"), { recursive: true });

  // Create test files
  await fs.promises.writeFile(path.join(testDir, "test1.txt"), "content1");
  await fs.promises.writeFile(path.join(testDir, "test2.txt"), "content2");
  await fs.promises.writeFile(
    path.join(testDir, "subdir", "f3.txt"),
    "content3",
  );
});

afterAll(async () => {
  // Clean up temp directory
  if (tempDir) {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  }
});

test("expandPaths", async () => {
  // Test expanding a directory path
  const paths = await util.expandPaths(["test-dir"]);

  // Sort paths for consistent comparison
  const sortedPaths = paths.sort();
  const expectedPaths = [
    "test-dir/subdir/f3.txt",
    "test-dir/test1.txt",
    "test-dir/test2.txt",
  ].sort();

  expect(sortedPaths).toEqual(expectedPaths);
});

test("expandPaths with single file", async () => {
  // Test expanding a single file path
  const paths = await util.expandPaths(["test-dir/test1.txt"]);
  expect(paths).toEqual(["test-dir/test1.txt"]);
});

test("expandPaths with multiple paths", async () => {
  // Test expanding multiple paths
  const paths = await util.expandPaths(["test-dir/test1.txt", "test-dir/subdir"]);

  // Sort paths for consistent comparison
  const sortedPaths = paths.sort();
  const expectedPaths = ["test-dir/test1.txt", "test-dir/subdir/f3.txt"].sort();

  expect(sortedPaths).toEqual(expectedPaths);
});

test("expandPaths with non-existent path", async () => {
  // Test expanding a non-existent path
  const paths = await util.expandPaths(["non-existent-dir"]);
  expect(paths).toEqual([]);
});
