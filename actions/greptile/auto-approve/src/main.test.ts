import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getInput: vi.fn(),
  info: vi.fn(),
  setFailed: vi.fn(),
  graphql: vi.fn(),
  paginate: vi.fn(),
  getContent: vi.fn(),
  listFiles: vi.fn(),
  listReviews: vi.fn(),
  addLabels: vi.fn(),
  removeLabel: vi.fn(),
  createComment: vi.fn(),
  listComments: vi.fn(),
  updateComment: vi.fn(),
  comments: [] as { id: number; user: { login: string }; body: string }[],
  createReview: vi.fn(),
  dismissReview: vi.fn(),
}));

vi.mock("@actions/core", () => mocks);
vi.mock("@actions/github", () => ({
  context: {
    repo: { owner: "owner", repo: "repo" },
    payload: { pull_request: { number: 1, base: { sha: "base" } } },
  },
  getOctokit: () => ({
    graphql: mocks.graphql,
    paginate: mocks.paginate,
    rest: {
      repos: { getContent: mocks.getContent },
      pulls: {
        listFiles: mocks.listFiles,
        listReviews: mocks.listReviews,
        createReview: mocks.createReview,
        dismissReview: mocks.dismissReview,
      },
      issues: {
        addLabels: mocks.addLabels,
        removeLabel: mocks.removeLabel,
        createComment: mocks.createComment,
        listComments: mocks.listComments,
        updateComment: mocks.updateComment,
      },
    },
  }),
}));

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  mocks.getInput.mockImplementation(
    (name: string) =>
      ({
        "protected-paths": ".github/protected.txt",
        "github-token": "token",
      })[name] ?? "",
  );
  mocks.getContent.mockResolvedValue({ data: "src/**" });
  mocks.comments = [];
  mocks.paginate.mockImplementation(async (method: unknown) => {
    if (method === mocks.listComments) {
      return mocks.comments;
    }
    return method === mocks.listFiles ? [{ filename: "src/first.ts" }, { filename: "src/second.ts" }] : [];
  });
});

it.each([
  {
    slug: "rewrites-earlier-decision",
    comments: [
      {
        id: 7,
        user: { login: "author" },
        body: "**Greptile auto-approve** at old: quoted by a person",
      },
      {
        id: 8,
        user: { login: "github-actions[bot]" },
        body: "<!-- sticky-comment: deploy-instructions -->",
      },
      {
        id: 9,
        user: { login: "github-actions[bot]" },
        body: "**Greptile auto-approve** at old: approved.",
      },
      {
        id: 10,
        user: { login: "github-actions[bot]" },
        body: "**Greptile auto-approve** at older: approved.",
      },
    ],
    rewrittenId: 9,
  },
  {
    slug: "posts-without-earlier-decision",
    comments: [
      {
        id: 7,
        user: { login: "author" },
        body: "**Greptile auto-approve** at old: quoted by a person",
      },
      {
        id: 8,
        user: { login: "github-actions[bot]" },
        body: "<!-- sticky-comment: deploy-instructions -->",
      },
    ],
    rewrittenId: undefined,
  },
])("$slug", async ({ comments, rewrittenId }) => {
  mocks.getContent.mockResolvedValue({ data: "other/**" });
  mocks.graphql.mockResolvedValue({
    repository: {
      pullRequest: {
        state: "OPEN",
        isDraft: false,
        headRefOid: "head",
        changedFiles: 2,
        body: "<!-- greptile_confidence_score:3 -->",
        editor: { login: "greptile-apps" },
        labels: { nodes: [] },
      },
    },
  });
  mocks.comments = comments;

  await import("./main");

  if (rewrittenId === undefined) {
    await vi.waitFor(() => expect(mocks.createComment).toHaveBeenCalledOnce());
    expect(mocks.updateComment).not.toHaveBeenCalled();
  } else {
    await vi.waitFor(() => expect(mocks.updateComment).toHaveBeenCalledOnce());
    expect(mocks.updateComment).toHaveBeenCalledWith({
      owner: "owner",
      repo: "repo",
      comment_id: rewrittenId,
      body: expect.stringMatching(/^\*\*Greptile auto-approve\*\* at head: not approved:/),
    });
    expect(mocks.createComment).not.toHaveBeenCalled();
  }
  expect(mocks.setFailed).not.toHaveBeenCalled();
});

it.each([
  { slug: "protected-before-score", body: "", editor: "author", dryRun: false },
  {
    slug: "protected-with-score",
    body: "<!-- greptile_confidence_score:5 -->",
    editor: "greptile-apps",
    dryRun: false,
  },
  {
    slug: "protected-below-score",
    body: "<!-- greptile_confidence_score:3 -->",
    editor: "greptile-apps",
    dryRun: false,
  },
  { slug: "protected-dry-run", body: "", editor: "author", dryRun: true },
])("$slug", async ({ body, editor, dryRun }) => {
  mocks.graphql.mockResolvedValue({
    repository: {
      pullRequest: {
        state: "OPEN",
        isDraft: false,
        headRefOid: "head",
        changedFiles: 2,
        body,
        editor: { login: editor },
        labels: { nodes: [] },
      },
    },
  });
  if (dryRun) {
    const getInput = mocks.getInput.getMockImplementation()!;
    mocks.getInput.mockImplementation((name: string) => (name === "dry-run" ? "true" : getInput(name)));
  }

  await import("./main");

  if (dryRun) {
    await vi.waitFor(() => expect(mocks.info).toHaveBeenCalledWith("dry run: post the decision as a PR comment"));
    expect(mocks.addLabels).not.toHaveBeenCalled();
    expect(mocks.createComment).not.toHaveBeenCalled();
  } else {
    await vi.waitFor(() => expect(mocks.createComment).toHaveBeenCalledOnce());
    expect(mocks.addLabels).toHaveBeenCalledWith(expect.objectContaining({ labels: ["AUTOAPPROVE: DECLINED"] }));
    const comment = mocks.createComment.mock.calls[0][0].body;
    expect(comment).toContain("AUTOAPPROVE: DECLINED");
    expect(comment).toContain('- "src/first.ts"\n- "src/second.ts"');
    expect(comment).toContain("`.github/protected.txt`");
  }
  expect(mocks.createReview).not.toHaveBeenCalled();
  expect(mocks.setFailed).not.toHaveBeenCalled();
});

it.each([
  { slug: "unprotected-before-score", body: "", editor: "author" },
  { slug: "unprotected-below-score", body: "<!-- greptile_confidence_score:3 -->", editor: "greptile-apps" },
])("$slug", async ({ body, editor }) => {
  mocks.getContent.mockResolvedValue({ data: "other/**" });
  mocks.graphql.mockResolvedValue({
    repository: {
      pullRequest: {
        state: "OPEN",
        isDraft: false,
        headRefOid: "head",
        changedFiles: 2,
        body,
        editor: { login: editor },
        labels: { nodes: [{ name: "AUTOAPPROVE: DECLINED" }] },
      },
    },
  });

  await import("./main");

  if (body === "") {
    await vi.waitFor(() =>
      expect(mocks.info).toHaveBeenCalledWith("no Greptile score or protected path restriction: post no PR comment"),
    );
    expect(mocks.createComment).not.toHaveBeenCalled();
  } else {
    await vi.waitFor(() => expect(mocks.createComment).toHaveBeenCalledOnce());
    expect(mocks.createComment.mock.calls[0][0].body).not.toContain("AUTOAPPROVE: DECLINED");
  }
  expect(mocks.addLabels).toHaveBeenCalledWith(expect.objectContaining({ labels: ["AUTOAPPROVE: ALLOW"] }));
  expect(mocks.removeLabel).toHaveBeenCalledWith(expect.objectContaining({ name: "AUTOAPPROVE: DECLINED" }));
  expect(mocks.createReview).not.toHaveBeenCalled();
  expect(mocks.setFailed).not.toHaveBeenCalled();
});
