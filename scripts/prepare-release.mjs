/* global process */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'

const repository = process.env.GITHUB_REPOSITORY
const sha = process.env.RELEASE_SHA
assert.match(repository || '', /^[\w.-]+\/[\w.-]+$/)
assert.match(sha || '', /^[a-f0-9]{40}$/)
assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), sha)

async function api(path, allowMissing = false) {
  const response = await fetch(`https://api.github.com/repos/${repository}/${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${process.env.GH_TOKEN}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })
  if (allowMissing && response.status === 404) return null
  if (!response.ok) throw new Error(`GitHub API ${response.status}: ${path}`)
  return response.json()
}

const { version } = JSON.parse(await readFile('package.json', 'utf8'))
assert.match(version, /^\d+\.\d+\.\d+$/, 'Release requires a stable semantic version')
const tag = `v${version}`
const existing = await api(`releases/tags/${tag}`, true)
if (existing) {
  assert.equal(existing.draft, false, 'An existing draft needs to be completed before another release')
  await appendFile(process.env.GITHUB_OUTPUT, 'publish=false\n')
  console.log(`${tag} is already published; no changes made.`)
} else {
  const main = await api('git/ref/heads/main')
  assert.equal(main.object.sha, sha, 'Release must target the current main revision')
  const response = await api(`actions/workflows/ci.yml/runs?branch=main&event=push&head_sha=${sha}&status=success&per_page=100`)
  const run = response.workflow_runs.find(item => item.head_sha === sha && item.head_branch === 'main'
    && item.event === 'push' && item.status === 'completed' && item.conclusion === 'success'
    && item.head_repository.full_name === repository)
  assert.ok(run, 'This exact main revision must have a successful CI run')
  const { jobs } = await api(`actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`)
  for (const name of ['ci-quality', 'ci-browser']) {
    assert.ok(jobs.some(job => job.name === name && job.status === 'completed' && job.conclusion === 'success'), `${name} must pass`)
  }
  const changelog = await readFile('CHANGELOG.md', 'utf8')
  const section = changelog.split(`## [${version}]`)[1]?.split('\n## ')[0]?.trim()
  assert.ok(section, `CHANGELOG.md must document ${version}`)
  await mkdir('release', { recursive: true })
  await writeFile('release/build-info.json', JSON.stringify({ version, tag, commit: sha, ci: run.html_url }, null, 2) + '\n')
  await writeFile('release/notes.md', `${section}\n\nSource: ${sha}\n\nValidation: ${run.html_url}\n\nDownload the dist ZIP, extract it, and serve its contents with a static HTTP server. Configure your own AI provider in the app. Data is stored in your browser; export a backup before moving to another origin.\n`)
  await appendFile(process.env.GITHUB_OUTPUT, `publish=true\ntag=${tag}\n`)
  console.log(`Prepared ${tag} at ${sha} after both CI checks passed.`)
}
