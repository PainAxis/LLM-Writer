/* global process */
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const directory = await mkdtemp(path.join(os.tmpdir(), 'llm-release-smoke-'))
const script = fileURLToPath(new URL('./prepare-release.mjs', import.meta.url))
try {
  execFileSync('git', ['init', '--quiet'], { cwd: directory })
  execFileSync('git', ['-c', 'user.name=Release Smoke', '-c', 'user.email=release-smoke@example.invalid', 'commit', '--allow-empty', '--quiet', '-m', 'synthetic fixture'], { cwd: directory })
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: directory, encoding: 'utf8' }).trim()
  await writeFile(path.join(directory, 'package.json'), JSON.stringify({ version: '1.0.0' }))
  await writeFile(path.join(directory, 'CHANGELOG.md'), '# Changelog\n\n## [1.0.0]\n\nSynthetic release notes.\n')
  const preload = path.join(directory, 'mock-api.mjs')
  await writeFile(preload, `
    const scenario = process.env.RELEASE_TEST_CASE
    globalThis.fetch = async url => {
      const path = new URL(url).pathname
      let body
      let status = 200
      if (path.endsWith('/releases/tags/v1.0.0')) {
        body = scenario === 'published' ? { draft: false } : null
        status = body ? 200 : 404
      } else if (path.endsWith('/git/ref/heads/main')) {
        body = { object: { sha: scenario === 'moved-main' ? '0'.repeat(40) : process.env.RELEASE_SHA } }
      } else if (path.endsWith('/actions/workflows/ci.yml/runs')) {
        body = { workflow_runs: scenario === 'missing-ci' ? [] : [{
          id: 123, run_attempt: 1, head_sha: process.env.RELEASE_SHA,
          head_branch: 'main', event: scenario === 'pr-ci' ? 'pull_request' : 'push',
          status: 'completed', conclusion: 'success', html_url: 'https://example.invalid/ci/123',
          head_repository: { full_name: scenario === 'fork-ci' ? 'someone/fork' : process.env.GITHUB_REPOSITORY },
        }] }
      } else if (path.endsWith('/actions/runs/123/attempts/1/jobs')) {
        body = { jobs: ['ci-quality', 'ci-browser'].map(name => ({ name, status: 'completed',
          conclusion: name === 'ci-browser' && scenario === 'failed-browser' ? 'failure' : 'success' })) }
      } else throw new Error('Unexpected API path: ' + path)
      return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
    }
  `)
  for (const scenario of ['passed', 'moved-main', 'missing-ci', 'pr-ci', 'fork-ci', 'failed-browser', 'published']) {
    await rm(path.join(directory, 'release'), { recursive: true, force: true })
    const output = path.join(directory, 'output.txt')
    await writeFile(output, '')
    const result = spawnSync(process.execPath, ['--import', preload, script], {
      cwd: directory, encoding: 'utf8', env: {
        ...process.env, GITHUB_REPOSITORY: 'test/fixture', RELEASE_SHA: sha,
        GH_TOKEN: 'synthetic-token', GITHUB_OUTPUT: output, RELEASE_TEST_CASE: scenario,
      },
    })
    const outputs = await readFile(output, 'utf8')
    if (scenario === 'passed') {
      assert.equal(result.status, 0, result.stderr)
      assert.match(outputs, /publish=true\ntag=v1\.0\.0/)
      const info = JSON.parse(await readFile(path.join(directory, 'release/build-info.json'), 'utf8'))
      assert.equal(info.commit, sha)
      assert.equal(info.ci, 'https://example.invalid/ci/123')
      assert.match(await readFile(path.join(directory, 'release/notes.md'), 'utf8'), /Synthetic release notes/)
    } else if (scenario === 'published') {
      assert.equal(result.status, 0, result.stderr)
      assert.equal(outputs, 'publish=false\n')
    } else {
      assert.notEqual(result.status, 0, `${scenario} must prevent release`)
      assert.equal(outputs, '', 'Rejected candidates must not enable publication')
      await assert.rejects(readFile(path.join(directory, 'release/build-info.json')))
    }
  }
  console.log('✓ Release requires the exact main SHA and successful quality/browser CI; PRs, forks and failed checks cannot publish')
  console.log('✓ Published versions are left untouched; new packages record source SHA and CI evidence')
} finally {
  await rm(directory, { recursive: true, force: true })
}
