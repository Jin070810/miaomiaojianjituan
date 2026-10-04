import { appendFileSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { validateRun } from './release-manifest.mjs';

const shaPattern = /^[a-f0-9]{40}$/;
const sameRepo = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const requireValue = (ok, message) => { if (!ok) throw new Error(message); };
export function eligiblePullRequest(pr, repository, permission) {
  return Boolean(pr && pr.state === 'open' && !pr.draft && pr.base?.ref === 'main'
    && sameRepo(pr.base.repo?.full_name, repository) && sameRepo(pr.head?.repo?.full_name, repository)
    && shaPattern.test(pr.head?.sha) && /^(feature|fix|security|chore|hotfix)\/[A-Za-z0-9_./-]+$/.test(pr.head?.ref)
    && ['admin', 'maintain', 'write'].includes(permission));
}
export function validateDispatch({ ref, sha, number, pr, repository, permission }) {
  requireValue(shaPattern.test(sha), 'Invalid CI source commit');
  if (!number) { requireValue(ref === 'refs/heads/main', 'Main CI dispatch requires main'); return 'main'; }
  requireValue(/^[1-9][0-9]*$/.test(number) && String(pr?.number) === number, 'Invalid CI pull request');
  requireValue(eligiblePullRequest(pr, repository, permission), 'Untrusted CI pull request');
  requireValue(ref === `refs/heads/${pr.head.ref}` && sha === pr.head.sha, 'CI dispatch is no longer the exact PR head');
  return 'pull_request';
}
export function selectCiRun(runs, { repository, sha, branch }) {
  return runs.filter(run => run.path === '.github/workflows/ci.yml'
    && ['push', 'pull_request', 'workflow_dispatch'].includes(run.event)
    && sameRepo(run.repository?.full_name, repository) && sameRepo(run.head_repository?.full_name, repository)
    && run.head_sha === sha && run.head_branch === branch)
    .sort((a, b) => Number(b.id) - Number(a.id) || Number(b.run_attempt) - Number(a.run_attempt))[0] ?? null;
}
export function planAutomaticRelease(run, { repository, mainSha }) {
  validateRun(run, { repository, commit: run.head_sha, runId: String(run.id) });
  requireValue(shaPattern.test(mainSha), 'Invalid main head');
  if (mainSha !== run.head_sha) return { eligible: false, reason: 'superseded' };
  return { eligible: true, commit: run.head_sha, runId: String(run.id), attempt: Number(run.run_attempt) };
}
export async function resolveReleasePlan(api, { repository, automatic, runId, commit, source, attempt }) {
  requireValue(/^[1-9][0-9]*$/.test(String(runId)), 'Invalid source CI run');
  const archived = !automatic && source === 'server-archive';
  if (archived) requireValue(/^[1-9][0-9]*$/.test(String(attempt)), 'Invalid archived CI attempt');
  const base = `repos/${repository}`;
  const run = await api(`${base}/actions/runs/${runId}${archived ? `/attempts/${attempt}` : ''}`);
  if (automatic) {
    const current = await api(`${base}/git/ref/heads/main`);
    return planAutomaticRelease(run, { repository, mainSha: current.object.sha });
  }
  validateRun(run, { repository, commit, runId: String(runId) });
  if (archived) requireValue(Number(run.run_attempt) === Number(attempt), 'Wrong archived CI attempt');
  return { eligible: true, commit, runId: String(runId), attempt: run.run_attempt };
}
export function nextReleaseVersion(tags, commit) {
  requireValue(shaPattern.test(commit), 'Invalid version commit');
  const versions = tags.filter(tag => /^v\d+\.\d+\.\d+$/.test(tag.name)).map(tag => {
    requireValue(/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag.name), 'Non-canonical version tag');
    const parts = tag.name.slice(1).split('.').map(Number);
    requireValue(parts.every(Number.isSafeInteger), 'Version number exceeds safe integer range');
    return { ...tag, parts };
  });
  const existing = versions.filter(tag => tag.sha === commit);
  requireValue(existing.length < 2, 'Multiple version tags point to the release commit');
  if (existing.length) return existing[0].name;
  versions.sort((a, b) => b.parts[0] - a.parts[0] || b.parts[1] - a.parts[1] || b.parts[2] - a.parts[2]);
  const [major, minor, patch] = versions[0]?.parts ?? [0, 0, 0];
  requireValue(Number.isSafeInteger(patch + 1), 'Version patch exceeds safe integer range');
  return `v${major}.${minor}.${patch + 1}`;
}

export function githubClient(token) {
  requireValue(Boolean(token), 'Missing GitHub token');
  return async (route, { method = 'GET', body, allow404 = false } = {}) => {
    requireValue(route.startsWith('repos/') && !route.includes('://') && !route.includes('..'), 'Invalid GitHub API route');
    const response = await fetch(`https://api.github.com/${route}`, {
      method, redirect: 'error', signal: AbortSignal.timeout(20_000),
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (allow404 && response.status === 404) return null;
    if (!response.ok) { const error = new Error(`GitHub ${method} failed (HTTP ${response.status})`); error.status = response.status; throw error; }
    return response.status === 204 ? null : response.json();
  };
}
export async function allPages(api, route, key) {
  const rows = [];
  for (let page = 1; page <= 10; page++) {
    const value = await api(`${route}${route.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
    const batch = key ? value[key] : value;
    requireValue(Array.isArray(batch), 'Unexpected GitHub list response');
    rows.push(...batch);
    if (batch.length < 100) return rows;
  }
  throw new Error('GitHub list exceeded bounded pagination; refusing partial evidence');
}
const emit = values => {
  const text = Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join('');
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, text);
  else process.stdout.write(text);
};
async function permissionFor(api, base, login) {
  try { return (await api(`${base}/collaborators/${encodeURIComponent(login)}/permission`)).permission; }
  catch (error) { if ([403, 404].includes(error.status)) return null; throw error; }
}
export async function integrateOne(api, repository, { wait = sleep } = {}) {
  const base = `repos/${repository}`;
  const dispatch = (ref, number = '') => api(`${base}/actions/workflows/ci.yml/dispatches`, { method: 'POST', body: { ref, inputs: { pull_request_number: number } } });
  const runsFor = sha => allPages(api, `${base}/actions/workflows/ci.yml/runs?head_sha=${sha}`, 'workflow_runs');
  // Explicit dispatch also repairs the merge -> CI gap after a transient outage.
  const main = await api(`${base}/git/ref/heads/main`);
  const mainRun = selectCiRun(await runsFor(main.object.sha), { repository, sha: main.object.sha, branch: 'main' });
  if (!mainRun) { await dispatch('main'); return { action: 'main-ci-dispatched', commit: main.object.sha }; }
  const pulls = await allPages(api, `${base}/pulls?state=open&base=main&sort=created&direction=asc`);
  for (const listed of pulls) {
    if (listed.draft || !sameRepo(listed.head?.repo?.full_name, repository)) continue;
    let pr = await api(`${base}/pulls/${listed.number}`);
    const permission = await permissionFor(api, base, pr.user.login);
    if (!eligiblePullRequest(pr, repository, permission)) continue;
    if (pr.mergeable_state === 'behind') {
      const oldHead = pr.head.sha;
      await api(`${base}/pulls/${pr.number}/update-branch`, { method: 'PUT', body: { expected_head_sha: oldHead } });
      for (let attempt = 0; attempt < 30 && pr.head.sha === oldHead; attempt++) {
        await wait(1000); pr = await api(`${base}/pulls/${pr.number}`);
      }
      requireValue(pr.head.sha !== oldHead && eligiblePullRequest(pr, repository, permission), 'Branch refresh did not finish safely');
      await dispatch(pr.head.ref, String(pr.number));
      return { action: 'branch-refreshed', pullRequest: pr.number, commit: pr.head.sha };
    }
    if (pr.mergeable === false || pr.mergeable_state === 'dirty') continue;
    const runs = await runsFor(pr.head.sha);
    const run = selectCiRun(runs, { repository, sha: pr.head.sha, branch: pr.head.ref });
    // Token-generated PR events may await human approval on GitHub; an explicit
    // dispatch performs the same tests without introducing an approval prompt.
    if (!run || (run.conclusion === 'action_required' && !runs.some(row => row.event === 'workflow_dispatch'))) {
      await dispatch(pr.head.ref, String(pr.number));
      return { action: 'pr-ci-dispatched', pullRequest: pr.number, commit: pr.head.sha };
    }
    if (run.status !== 'completed' || run.conclusion !== 'success') continue;
    let merged;
    try {
      // GitHub atomically enforces protected-branch checks and the expected head.
      // No admin bypass, approval fabrication, checkout, or PR code execution.
      merged = await api(`${base}/pulls/${pr.number}/merge`, { method: 'PUT', body: { merge_method: 'squash', sha: pr.head.sha } });
    } catch (error) { if ([405, 409].includes(error.status)) continue; throw error; }
    requireValue(merged.merged && shaPattern.test(merged.sha), 'Merge did not produce a commit');
    await dispatch('main');
    return { action: 'merged', pullRequest: pr.number, commit: merged.sha };
  }
  return { action: 'no-eligible-change' };
}

export async function allocateVersion(api, repository, commit) {
  requireValue(shaPattern.test(commit), 'Invalid release commit');
  const base = `repos/${repository}`;
  const tags = (await allPages(api, `${base}/tags`)).map(tag => ({ name: tag.name, sha: tag.commit.sha }));
  const version = nextReleaseVersion(tags, commit);
  if (!tags.some(tag => tag.name === version && tag.sha === commit)) {
    try { await api(`${base}/git/refs`, { method: 'POST', body: { ref: `refs/tags/${version}`, sha: commit } }); }
    catch (error) { if (error.status !== 422) throw error; } // Resolve a race; never move an existing tag.
  }
  const ref = await api(`${base}/git/ref/tags/${version}`);
  const object = ref.object.type === 'tag' ? (await api(`${base}/git/tags/${ref.object.sha}`)).object : ref.object;
  requireValue(object.type === 'commit' && object.sha === commit, 'Version tag points to another commit');
  return version;
}

export function releaseRecord(journal, manifest, { commit, runId, attempt, repository }) {
  requireValue(shaPattern.test(commit) && journal.commit === commit && manifest.commit === commit, 'Inconsistent deployment commit');
  requireValue(journal.id === `${runId}-${attempt}` && journal.status === 'succeeded' && journal.exitCode === 0
    && journal.maintenanceEngaged === false, 'No successful deployment journal for this attempt');
  requireValue(/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(journal.version), 'Invalid deployed version');
  requireValue(sameRepo(manifest.repository, repository) && manifest.ci && Array.isArray(manifest.migrations), 'Inconsistent deployment manifest');
  const notes = `自动部署完成，持续观察中。\n\n<!-- deployment:${journal.id} -->\nCommit: ${commit}\nCI: ${manifest.ci.runId} / ${manifest.ci.runAttempt}\nApp: ${manifest.images.app.name}@${manifest.images.app.digest}\nWorker: ${manifest.images.worker.name}@${manifest.images.worker.digest}\nMigration inventory: ${manifest.migrations.length}\n操作者: ${journal.actor}\n完成时间: ${journal.updatedAt}\n恢复依据: ${journal.previousCommit}（迁移后优先前向修复）\n发布证据: https://github.com/${repository}/actions/runs/${runId}\n`;
  return { version: journal.version, deployment: journal.id, commit, notes };
}

async function main() {
  const repository = process.env.GITHUB_REPOSITORY;
  requireValue(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository), 'Invalid repository');
  const api = githubClient(process.env.GH_TOKEN);
  const base = `repos/${repository}`;
  const command = process.argv[2];
  if (command === 'integrate') {
    const result = await integrateOne(api, repository);
    console.log(JSON.stringify(result));
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `Automatic integration: ${JSON.stringify(result)}\n`);
  } else if (command === 'validate-dispatch') {
    const number = process.env.CI_PULL_REQUEST_NUMBER ?? '';
    const pr = number && /^[1-9][0-9]*$/.test(number) ? await api(`${base}/pulls/${number}`) : null;
    const permission = pr ? await permissionFor(api, base, pr.user.login) : null;
    emit({ purpose: validateDispatch({ repository, number, pr, permission, sha: process.env.GITHUB_SHA, ref: process.env.GITHUB_REF }) });
  } else if (command === 'plan') {
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
    const automatic = process.env.GITHUB_EVENT_NAME === 'workflow_run';
    const runId = automatic ? event.workflow_run?.id : process.env.CANDIDATE_RUN_ID;
    const plan = await resolveReleasePlan(api, { repository, automatic, runId, commit: process.env.RELEASE_COMMIT,
      source: process.env.CANDIDATE_SOURCE, attempt: process.env.CANDIDATE_ATTEMPT });
    emit({ eligible: plan.eligible, reason: plan.reason ?? '', commit: plan.commit ?? '', run_id: plan.runId ?? '', attempt: plan.attempt ?? '', automatic });
  } else if (command === 'version') {
    emit({ version: await allocateVersion(api, repository, process.env.RELEASE_COMMIT) });
  } else if (command === 'fresh') {
    const current = await api(`${base}/git/ref/heads/main`);
    emit({ eligible: process.env.AUTOMATIC !== 'true' || current.object.sha === process.env.RELEASE_COMMIT });
  } else if (command === 'record') {
    const journal = JSON.parse(readFileSync('output/release/deploy-journal.json', 'utf8'));
    const manifest = JSON.parse(readFileSync('output/release/deploy-candidate.json', 'utf8'));
    const record = releaseRecord(journal, manifest, { repository, commit: process.env.RELEASE_COMMIT, runId: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT });
    const { version } = record;
    const existing = await api(`${base}/releases/tags/${version}`, { allow404: true });
    const body = { tag_name: version, target_commitish: journal.commit, name: version, body: record.notes, draft: false, prerelease: false };
    const release = existing ? await api(`${base}/releases/${existing.id}`, { method: 'PATCH', body }) : await api(`${base}/releases`, { method: 'POST', body });
    mkdirSync('output/release', { recursive: true });
    writeFileSync('output/release/release-record.json', JSON.stringify({ id: release.id, url: release.html_url, ...record, observation: 'pending' }, null, 2));
    emit({ deployed: true, version });
  } else if (command === 'observe-record') {
    const record = JSON.parse(readFileSync('output/release/release-record.json', 'utf8'));
    const observation = JSON.parse(readFileSync('output/release/observation.json', 'utf8'));
    requireValue(record.deployment === observation.deployment && record.commit === observation.commit, 'Observation belongs to another deployment');
    requireValue(['passed', 'failed', 'superseded'].includes(observation.status), 'Invalid observation result');
    const release = await api(`${base}/releases/${record.id}`);
    if (release.body.includes(`<!-- deployment:${record.deployment} -->`)) {
      const state = { passed: '30 分钟自动观察通过', failed: '自动观察失败，需前向修复', superseded: '观察被后续发布接替，未完成本版本 30 分钟观察' }[observation.status];
      await api(`${base}/releases/${record.id}`, { method: 'PATCH', body: { body: record.notes.replace('自动部署完成，持续观察中。', `${state}。`) + `\n观察证据: ${observation.samples.length} 次采样；${observation.startedAt} 至 ${observation.finishedAt}\n` } });
    }
    writeFileSync('output/release/release-record.json', JSON.stringify({ ...record, observation: observation.status }, null, 2));
  } else throw new Error('Unknown automatic release command');
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
