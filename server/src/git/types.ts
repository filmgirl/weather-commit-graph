export interface FileChange {
  path: string;
  added: number;
  deleted: number;
  /** Binary files report `-` for both counts; churn math must skip them. */
  binary: boolean;
}

export interface CommitRecord {
  sha: string;
  authorName: string;
  authorEmail: string;
  /** Author date, which is when the work happened rather than when it was rebased. */
  date: Date;
  subject: string;
  files: FileChange[];
}

export interface RepoIdentity {
  /** Canonical, symlink-resolved absolute path to the working tree. */
  path: string;
  name: string;
  headSha: string;
  branch: string | null;
}
