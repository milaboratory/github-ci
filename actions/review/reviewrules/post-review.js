const fs = require('fs');

const MARKER_PREFIX = '<!-- reviewrules:';

const marker = (key) => `${MARKER_PREFIX}${key} -->`;

const markerKeys = (body) =>
  (body || '')
    .split(MARKER_PREFIX)
    .slice(1)
    .map((rest) => rest.slice(0, rest.indexOf(' -->')));

const ruleFindings = (report) =>
  (report.rules || [])
    .filter((rule) => rule.verdict === 'FAIL')
    .flatMap((rule) =>
      (rule.findings || []).map((finding) => ({
        path: finding.file,
        line: finding.line,
        key: `${rule.rule_id}:${finding.file}:${finding.line}`,
        text: `**${rule.rule_id}** (${rule.severity})\n\n${finding.message}`,
      })),
    );

const hypothesisText = (check) =>
  [
    `**Bug confirmed** (${check.hunt})`,
    check.question,
    check.scenario && `**Input that breaks it:** ${check.scenario}`,
    check.edit && `**Fix:** ${check.edit}`,
    ...(check.evidence || []).map((line) => `- ${line}`),
  ]
    .filter(Boolean)
    .join('\n\n');

const hypothesisFindings = (report) =>
  ((report.correctness || {}).hypotheses || [])
    .filter((check) => check.verdict === 'CONFIRMED')
    .map((check) => {
      const at = /^([^\s:]+):(\d+)/.exec(check.at || '') || [];
      return {
        path: at[1],
        line: Number(at[2]),
        key: `hypothesis:${check.at}:${check.question}`,
        text: hypothesisText(check),
      };
    });

// The right-side lines of each file patch; GitHub accepts a line comment only on these lines.
const commentableLines = (files) => {
  const lines = new Map();
  for (const file of files) {
    const right = new Set();
    let next = 0;
    for (const row of (file.patch || '').split('\n')) {
      const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(row);
      if (hunk) {
        next = Number(hunk[1]);
      } else if (row.startsWith('+') || row.startsWith(' ')) {
        right.add(next);
        next += 1;
      }
    }
    lines.set(file.filename, right);
  }
  return lines;
};

const reviewBody = (report, outside) => {
  const cost = (report.cost_estimate || {}).total_usd;
  const head = `**reviewrules**: ${(report.rules || []).length} rule checks, cost estimate $${Number(cost || 0).toFixed(2)}.`;
  if (outside.length === 0) return head;
  const rows = outside.map(
    (f) => `- \`${f.path || '?'}:${f.line || '?'}\` ${f.text.replace(/\n+/g, ' ')} ${marker(f.key)}`,
  );
  return [head, 'Findings outside the diff lines:', ...rows].join('\n\n');
};

module.exports = async ({ github, context, core, reportPath }) => {
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const pull = context.payload.pull_request;
  const target = { owner: context.repo.owner, repo: context.repo.repo, pull_number: pull.number, per_page: 100 };

  const files = await github.paginate(github.rest.pulls.listFiles, target);
  const comments = await github.paginate(github.rest.pulls.listReviewComments, target);
  const reviews = await github.paginate(github.rest.pulls.listReviews, target);
  const postedKeys = new Set([...comments, ...reviews].flatMap((item) => markerKeys(item.body)));
  const lines = commentableLines(files);

  const inline = [];
  const outside = [];
  for (const finding of [...ruleFindings(report), ...hypothesisFindings(report)]) {
    if (postedKeys.has(finding.key)) continue;
    const onDiff = finding.path && (lines.get(finding.path) || new Set()).has(finding.line);
    (onDiff ? inline : outside).push(finding);
  }

  if (inline.length === 0 && outside.length === 0) {
    core.info('reviewrules: no new findings');
    return;
  }

  await github.rest.pulls.createReview({
    owner: target.owner,
    repo: target.repo,
    pull_number: target.pull_number,
    commit_id: pull.head.sha,
    event: 'COMMENT',
    body: reviewBody(report, outside),
    comments: inline.map((finding) => ({
      path: finding.path,
      line: finding.line,
      side: 'RIGHT',
      body: `${finding.text}\n\n${marker(finding.key)}`,
    })),
  });
  core.info(`reviewrules: posted ${inline.length} line comments and ${outside.length} findings in the review body`);
};
