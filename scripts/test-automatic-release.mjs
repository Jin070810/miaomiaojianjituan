import assert from 'node:assert/strict';
import { test } from 'node:test';
import { eligiblePullRequest, selectCiRun, planAutomaticRelease, nextReleaseVersion, validateDispatch, integrateOne, allocateVersion, resolveReleasePlan, releaseRecord } from './automatic-release.mjs';
import { observeRelease } from './observe-production-release.mjs';

const repository = 'Example/points';
const sha = 'a'.repeat(40);
const otherSha = 'b'.repeat(40);
const pr = { number: 7, state: 'open', draft: false, user: { login: 'owner' }, base: { ref: 'main', repo: { full_name: repository } }, head: { ref: 'fix/example', sha, repo: { full_name: repository } } };
const run = { id: 123, run_attempt: 2, status: 'completed', conclusion: 'success', path: '.github/workflows/ci.yml', event: 'push', head_branch: 'main', head_sha: sha, repository: { full_name: repository }, head_repository: { full_name: repository } };

test('only ready, same-repository PRs by writers can enter automatic integration', () => {
  assert.equal(eligiblePullRequest(pr, repository, 'write'), true);
  for (const candidate of [{ ...pr, draft: true }, { ...pr, state: 'closed' }, { ...pr, base: { ...pr.base, ref: 'release/old' } }, { ...pr, head: { ...pr.head, repo: { full_name: 'Fork/points' } } }]) assert.equal(eligiblePullRequest(candidate, repository, 'admin'), false);
  for (const permission of ['read', 'triage', undefined]) assert.equal(eligiblePullRequest(pr, repository, permission), false);
});

test('dispatch validates the exact current branch and never publishes a PR as main', () => {
  assert.equal(validateDispatch({ ref: 'refs/heads/fix/example', sha, pr, repository, permission: 'admin', number: '7' }), 'pull_request');
  assert.equal(validateDispatch({ ref: 'refs/heads/main', sha, repository, number: '' }), 'main');
  for (const change of [{ ref: 'refs/heads/main' }, { sha: otherSha }, { number: '8' }, { permission: 'read' }]) assert.throws(() => validateDispatch({ ref: 'refs/heads/fix/example', sha, pr, repository, permission: 'admin', number: '7', ...change }));
});

test('only successful exact main CI from authenticated API may deploy; stale main is skipped', () => {
  assert.equal(planAutomaticRelease(run, { repository, mainSha: sha }).eligible, true);
  assert.equal(planAutomaticRelease({ ...run, event: 'workflow_dispatch' }, { repository, mainSha: sha }).eligible, true);
  assert.deepEqual(planAutomaticRelease(run, { repository, mainSha: otherSha }), { eligible: false, reason: 'superseded' });
  for (const change of [{ conclusion: 'failure' }, { status: 'in_progress' }, { event: 'pull_request' }, { head_branch: 'fix/example' }, { path: '.github/workflows/fake.yml' }, { head_repository: { full_name: 'Fork/points' } }]) assert.throws(() => planAutomaticRelease({ ...run, ...change }, { repository, mainSha: sha }));
});

test('a newer failed or running CI cannot be hidden behind an older success', () => {
  const valid = { ...run, event: 'pull_request', head_branch: 'fix/example' };
  assert.equal(selectCiRun([valid], { repository, sha, branch: 'fix/example' }).conclusion, 'success');
  assert.equal(selectCiRun([valid, { ...valid, id: 124, conclusion: 'failure' }], { repository, sha, branch: 'fix/example' }).conclusion, 'failure');
  assert.equal(selectCiRun([{ ...valid, head_sha: otherSha }], { repository, sha, branch: 'fix/example' }), null);
});

test('versions increase numerically and retries reuse the one tag already on the commit', () => {
  const tags = [{ name: 'v1.9.9', sha: otherSha }, { name: 'v1.11.0', sha: otherSha }, { name: 'scratch', sha: otherSha }];
  assert.equal(nextReleaseVersion(tags, sha), 'v1.11.1');
  assert.equal(nextReleaseVersion([...tags, { name: 'v1.11.1', sha }], sha), 'v1.11.1');
  assert.throws(() => nextReleaseVersion([...tags, { name: 'v1.11.1', sha }, { name: 'v1.11.2', sha }], sha));
  assert.throws(() => nextReleaseVersion([{ name: 'v999999999999999999999.0.0', sha: otherSha }], sha));
});

function integrationApi({ pull = pr, prRuns = [{ ...run, event: 'workflow_dispatch', head_branch: pr.head.ref }], mainRuns = [run], permission = 'write', mergeError, dispatchError } = {}) {
  const calls = [];
  let refreshed = false;
  const api = async (route, options = {}) => {
    calls.push({ route, ...options });
    if (route.endsWith('/git/ref/heads/main')) return { object: { sha: otherSha } };
    if (route.includes('runs?head_sha=')) return { workflow_runs: route.includes(otherSha) ? mainRuns.map(r => ({ ...r, head_sha: otherSha })) : prRuns };
    if (route.includes('/pulls?')) return [pull];
    if (route.endsWith('/permission')) return { permission };
    if (route.endsWith('/pulls/7')) return structuredClone(refreshed ? { ...pull, head: { ...pull.head, sha: 'c'.repeat(40) } } : pull);
    if (route.endsWith('/update-branch')) { refreshed = true; return {}; }
    if (route.endsWith('/merge')) { if (mergeError) throw Object.assign(new Error('Guarded merge'), { status: mergeError }); return { merged: true, sha: 'd'.repeat(40) }; }
    if (route.endsWith('/dispatches')) { if (dispatchError) throw Object.assign(new Error('Dispatch failed'), { status: dispatchError }); return null; }
    throw new Error(`Unexpected API route: ${route}`);
  };
  return { api, calls, writes: () => calls.filter(c => c.method) };
}

test('automatic integration merges an exact successful head then explicitly starts main CI', async () => {
  const fixture = integrationApi();
  assert.deepEqual(await integrateOne(fixture.api, repository), { action: 'merged', pullRequest: 7, commit: 'd'.repeat(40) });
  assert.deepEqual(fixture.writes().map(c => c.body), [{ merge_method: 'squash', sha }, { ref: 'main', inputs: { pull_request_number: '' } }]);
});
test('failed CI, fork, draft, read-only author, and protected merge rejection cannot integrate', async () => {
  for (const options of [{ prRuns: [{ ...run, head_branch: pr.head.ref, conclusion: 'failure' }] }, { permission: 'read' },
    { pull: { ...pr, draft: true } }, { pull: { ...pr, head: { ...pr.head, repo: { full_name: 'fork/points' } } } }, { mergeError: 405 }, { mergeError: 409 }]) {
    const fixture = integrationApi(options);
    assert.equal((await integrateOne(fixture.api, repository)).action, 'no-eligible-change');
    assert.equal(fixture.writes().some(c => c.route.endsWith('/dispatches')), false);
  }
});
test('missing main CI repairs the merge dispatch gap before another merge', async () => {
  const fixture = integrationApi({ mainRuns: [] });
  assert.equal((await integrateOne(fixture.api, repository)).action, 'main-ci-dispatched');
  assert.equal(fixture.writes().length, 1);
  assert.equal(fixture.writes()[0].body.ref, 'main');
});
test('token-generated PR approval is replaced by exact PR branch CI dispatch', async () => {
  const fixture = integrationApi({ prRuns: [{ ...run, head_branch: pr.head.ref, event: 'pull_request', conclusion: 'action_required' }] });
  assert.equal((await integrateOne(fixture.api, repository)).action, 'pr-ci-dispatched');
  assert.deepEqual(fixture.writes()[0].body, { ref: pr.head.ref, inputs: { pull_request_number: '7' } });
});
test('behind branch is refreshed with CAS, then its new SHA receives CI', async () => {
  const fixture = integrationApi({ pull: { ...pr, mergeable_state: 'behind' } });
  const result = await integrateOne(fixture.api, repository, { wait: async () => {} });
  assert.equal(result.action, 'branch-refreshed');
  assert.equal(result.commit, 'c'.repeat(40));
  assert.deepEqual(fixture.writes()[0].body, { expected_head_sha: sha });
  assert.equal(fixture.writes().some(c => c.route.endsWith('/merge')), false);
});
test('a dispatch failure after merging is visible instead of pretending nothing happened', async () => {
  const fixture = integrationApi({ dispatchError: 409 });
  await assert.rejects(integrateOne(fixture.api, repository), /Dispatch failed/);
  assert.equal(fixture.writes().filter(c => c.route.endsWith('/merge')).length, 1);
});
test('archive recovery validates its original attempt instead of a later failed rerun', async () => {
  const paths = [];
  const api = async route => { paths.push(route); return { ...run, run_attempt: 1 }; };
  const result = await resolveReleasePlan(api, { repository, automatic: false, runId: '123', commit: sha, source: 'server-archive', attempt: '1' });
  assert.equal(result.attempt, 1);
  assert.deepEqual(paths, [`repos/${repository}/actions/runs/123/attempts/1`]);
  await assert.rejects(resolveReleasePlan(api, { repository, automatic: false, runId: '123', commit: sha, source: 'server-archive', attempt: '../2' }));
});
test('tag creation races reuse only the same target and never move another version', async () => {
  for (const target of [sha, otherSha]) {
    const writes = [];
    const api = async (route, options = {}) => {
      if (route.includes('/tags?')) return [{ name: 'v1.11.0', commit: { sha: otherSha } }];
      if (options.method) { writes.push(options); throw Object.assign(new Error('Exists'), { status: 422 }); }
      return { object: { type: 'commit', sha: target } };
    };
    if (target === sha) assert.equal(await allocateVersion(api, repository, sha), 'v1.11.1');
    else await assert.rejects(allocateVersion(api, repository, sha), /another commit/);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].method, 'POST');
  }
});
test('release records require the matching successful attempt with maintenance open', () => {
  const journal = { id: '999-1', commit: sha, status: 'succeeded', exitCode: 0, maintenanceEngaged: false, version: 'v1.11.1' };
  const manifest = { commit: sha, repository, ci: { runId: '123', runAttempt: 2 }, migrations: [], images: { app: {}, worker: {} } };
  const expected = { repository, commit: sha, runId: '999', attempt: '1' };
  assert.equal(releaseRecord(journal, manifest, expected).deployment, '999-1');
  for (const change of [{ status: 'failed' }, { id: '998-1' }, { maintenanceEngaged: true }, { commit: otherSha }]) assert.throws(() => releaseRecord({ ...journal, ...change }, manifest, expected));
  assert.throws(() => releaseRecord(journal, { ...manifest, commit: otherSha }, expected));
});

const healthy = mode => ({ state: 'healthy', commit: sha, integrity: mode === 'integrity' ? true : null });
async function observe(probe, options = {}) {
  let time = 0;
  return observeRelease(probe, { commit: sha, deployment: '999-1', durationMs: 90_000, intervalMs: 30_000,
    now: () => time, wait: async ms => { time += ms; }, ...options });
}
test('observation certifies elapsed healthy time plus initial and final integrity checks', async () => {
  const modes = [];
  const result = await observe(async mode => { modes.push(mode); return healthy(mode); });
  assert.equal(result.status, 'passed');
  assert.deepEqual(modes, ['integrity', 'health', 'health', 'integrity']);
  assert.equal(Date.parse(result.finishedAt) - Date.parse(result.startedAt), 90_000);
});
test('busy locks and transient failures reset healthy observation time, without affecting newer writers', async () => {
  let count = 0;
  const result = await observe(async mode => ++count === 2 ? { state: 'busy' } : healthy(mode));
  assert.equal(result.status, 'passed');
  assert.equal(result.samples.length, 6);
  assert.equal(Date.parse(result.finishedAt), 150_000);
});
test('repeated outage, wrong version, or final failed reconciliation cannot pass observation', async () => {
  for (const probe of [async () => { throw new Error('offline'); }, async () => ({ state: 'healthy', commit: otherSha }), async () => ({ state: 'healthy', commit: sha, integrity: false })]) {
    const result = await observe(probe);
    assert.equal(result.status, 'failed');
    assert.equal(result.samples.length, 3);
  }
});
test('a new host-locked deployment is recorded as superseded, never a completed 30 minute pass', async () => {
  const result = await observe(async () => ({ state: 'superseded', successor: '1000-1', successorStatus: 'succeeded' }));
  assert.equal(result.status, 'superseded');
  assert.equal(result.samples.length, 1);
});
