import * as fs from 'fs';

/**
 * https://github.com/<owner>/<repo> when the repository being built is public
 * on github.com, the only case where npm adds provenance on its own. The
 * event payload says whether the repository is private.
 */
export function publicSourceRepository(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const { GITHUB_SERVER_URL: server, GITHUB_REPOSITORY: repository, GITHUB_EVENT_PATH: eventPath } = env;
  if (server !== 'https://github.com' || !repository || !eventPath || !fs.existsSync(eventPath)) {
    return undefined;
  }
  const event = JSON.parse(fs.readFileSync(eventPath, 'utf8')) as { repository?: { private?: boolean } };
  return event.repository?.private === false ? `${server}/${repository}` : undefined;
}
