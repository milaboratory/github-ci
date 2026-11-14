// Converts the PR files from the GitHub API into the paths that the action checks.

// ChangedFile has the fields of a "list pull request files" item that the action uses.
export interface ChangedFile {
  filename: string;
  // added, removed, modified, renamed, copied, changed or unchanged.
  status: string;
  previous_filename?: string | null;
}

// changedPaths returns each path that the PR touches, once, in the order of the files.
// All statuses give their filename: a removed file has its old path in filename, and the removal
// of a protected file must not get an approval. A renamed or copied file also gives its old path.
export function changedPaths(files: ChangedFile[]): string[] {
  const paths = new Set<string>();
  for (const file of files) {
    paths.add(file.filename);
    if (file.previous_filename) {
      paths.add(file.previous_filename);
    }
  }
  return [...paths];
}
