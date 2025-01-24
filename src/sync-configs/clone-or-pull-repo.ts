import * as fs from "fs";
import * as path from "path";
import simpleGit, { SimpleGit } from "simple-git";
import { STORAGE_DIR } from "./sync-configs";
import { Target } from "./targets";

// Clean up any stale git lock files
function cleanupGitLocks(repoPath: string) {
  const lockFiles = [path.join(repoPath, ".git", "index.lock"), path.join(repoPath, ".git", "HEAD.lock")];

  for (const lockFile of lockFiles) {
    if (fs.existsSync(lockFile)) {
      try {
        fs.unlinkSync(lockFile);
        console.log(`Removed stale lock file: ${lockFile}`);
      } catch (error) {
        console.warn(`Failed to remove lock file ${lockFile}:`, error);
      }
    }
  }
}

function getRequiredEnvVar(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} environment variable must be set`);
  }
  return value;
}

const ACTOR = getRequiredEnvVar("ACTOR");
const EMAIL = getRequiredEnvVar("EMAIL");

async function shouldConfigureGitCredentials(repoPath: string): Promise<boolean> {
  const fixturesPath = path.join(__dirname, "..", "fixtures");
  return repoPath.startsWith(fixturesPath);
}

async function configureLocalGitCredentials(git: SimpleGit, repoPath: string): Promise<void> {
  if (await shouldConfigureGitCredentials(repoPath)) {
    await git.addConfig("credential.helper", "store", false, "local");
    await git.addConfig("user.name", ACTOR, false, "local");
    await git.addConfig("user.email", EMAIL, false, "local");
  }
}

export async function cloneOrPullRepo(target: Target, defaultBranch: string): Promise<void> {
  const repoPath = path.join(__dirname, STORAGE_DIR, target.localDir);
  const token = process.env.AUTH_TOKEN;

  if (!token && process.env.GITHUB_ACTIONS) {
    throw new Error("AUTH_TOKEN is not set");
  }

  if (fs.existsSync(repoPath)) {
    // Clean up any stale locks before git operations
    cleanupGitLocks(repoPath);
    // The repository directory exists; initialize git with this directory
    const git: SimpleGit = simpleGit(repoPath);

    if (await git.checkIsRepo()) {
      try {
        await configureLocalGitCredentials(git, repoPath);
        console.log(`Fetching updates for ${target.url}...`);
        await git.fetch("origin");
        await git.reset(["--hard", `origin/${defaultBranch}`]);
        console.log(`Successfully updated ${target.url}`);
      } catch (error) {
        console.error(`Error updating ${target.url}:`, error);
        throw error;
      }
    } else {
      console.error(`Directory ${repoPath} exists but is not a git repository.`);
    }
  } else {
    // The directory does not exist; create it and perform git clone
    try {
      console.log(`Cloning ${target.url}...`);
      fs.mkdirSync(repoPath, { recursive: true });
      cleanupGitLocks(repoPath);
      const git: SimpleGit = simpleGit();
      await git.clone(target.url, repoPath);
      // After clone, fetch to ensure we have all refs
      await git.cwd(repoPath).fetch("origin");
      await git.reset(["--hard", `origin/${defaultBranch}`]);
      const localGit = git.cwd(repoPath);
      await configureLocalGitCredentials(localGit, repoPath);
      console.log(`Successfully cloned ${target.url}`);
    } catch (error) {
      console.error(`Error cloning ${target.url}:`, error);
      throw error;
    }
  }
}
