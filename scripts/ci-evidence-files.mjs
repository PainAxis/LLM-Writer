// Audited, exact source paths only. Adding a file requires reviewing its producer.
// Backups, traces, text exports and downloaded mindmap images stay runner-local.
const files = (directory, names) => names.map(name => `artifacts/${directory}/${name}`)
const factGraph = files('browser-memory-fact-graph', [
  'report.json', 'source-edge-light.png', 'future-identity-disclosed.png',
  'clue-graph-dark.png', 'clue-graph-mobile.png', 'failure.png',
])
export const CI_EVIDENCE_GROUPS = Object.freeze(Object.fromEntries(Object.entries({
  'memory-capacity': files('memory-capacity', [
    'comparison.json', 'paired/baseline-a-all.json', 'paired/baseline-b-all.json',
    'paired/candidate-a-all.json', 'paired/candidate-b-all.json',
  ]),
  'memory-cold-index': files('memory-cold-index', [
    'baseline-a-million.json', 'baseline-b-million.json', 'candidate-a-million.json',
    'candidate-b-million.json', 'comparison-million.json', 'baseline-a-ten-million.json',
    'baseline-b-ten-million.json', 'candidate-a-ten-million.json', 'candidate-b-ten-million.json',
    'comparison-ten-million.json',
  ]),
  'memory-full-scan': [
    ...files('memory-full-scan', ['dense-128.json', 'dense-512.json', 'dense-4096.json']),
    ...files('browser-memory-full-scan', ['report.json', 'complete-4096-current-source.png', 'revised-lab-source.png', 'failure.png']),
  ],
  'memory-support': [
    ...files('memory-support-code', ['report.json']),
    ...files('browser-memory-support', ['report.json', 'desktop-two-premise-supported.png', 'mobile-individual-premises.png', 'failure.png']),
  ],
  'memory-novel-scan': files('browser-memory-novel-scan', [
    'report.json', 'desktop-reviewed-bridge.png', 'mobile-three-premise-review.png', 'failure.png',
  ]),
  'memory-stress': files('memory-stress', [
    'local.json', 'local-million.json', 'local-three-million.json', 'local-ten-million.json', 'hybrid.json', 'hybrid-progress.json',
  ]),
  'memory-browser-stress': files('browser-memory-stress', [
    'report.json', 'long-range-source-evidence.png', 'revised-long-novel-evidence.png', 'reloaded-persisted-revision.png', 'failure.png',
  ]),
  'graph-backup-mobile': [
    ...files('browser-graph-backup', [
      'report.json', 'source-confirmed-inference.png', 'restored-confirmation-and-evidence.png',
      'restored-early-clue-with-future-hidden.png', 'restored-new-prose-old-fact-excluded.png', 'failure.png',
    ]),
    ...files('browser-mobile', [
      'report.json', '390-memory-controls.png', '390-touch-edge-evidence.png', '390-relation-form.png',
      '390-revised-source.png', '390-backup-confirmation.png', '390-navigation-drawer.png', 'failure-390.png',
      '320-memory-controls.png', '320-touch-edge-evidence.png', '320-relation-form.png',
      '320-revised-source.png', '320-backup-confirmation.png', '320-navigation-drawer.png', 'failure-320.png',
    ]),
  ],
  'writer-memory-browser': files('browser-writer-memory', [
    'report.json', 'reviewed-distant-clue.png', 'revised-old-chapter-evidence.png',
    'candidate-warning-390.png', 'continue-evidence-390.png', 'chapter-evidence-390.png', 'optimize-evidence-390.png',
    'candidate-warning-320.png', 'continue-evidence-320.png', 'chapter-evidence-320.png', 'optimize-evidence-320.png',
    'long-manuscript-reviewed-evidence.png', 'long-mixed-source-memory-lab.png', 'long-mixed-source-writer-preview.png',
    'mixed-identifier-memory-lab.png', 'mixed-identifier-reviewed-writer.png', 'mixed-identifier-revised-memory-lab.png',
    'unanswered-candidate-memory-lab.png', 'unanswered-candidate-writer.png', 'selected-partial-identifier-source.png',
    'capacity-fallback-late-source-memory-lab.png', 'capacity-fallback-revised-writer.png', 'failure.png',
  ]),
  'writer-memory-stress': files('writer-memory-stress', ['report.json', 'million.json', 'ten-million.json']),
  'fact-graph-review': factGraph,
  browser: [
    ...files('browser', [
      'report.json', 'failure.png', '01-mock-api-configured.png', '02-editor-persisted-after-reload.png',
      '03-cancelled-stream-preserves-partial.png', '04-chapter-switch-does-not-cross-write.png',
      '05-docx-real-parser-output.png', '06-restored-backup-editor.png', '07-indexeddb-hydrated-after-reload.png',
      '08-short-article-cancel-clear.png', '09-short-story-dialog-cancellation.png', '10-short-story-unmount-aborts.png',
      '11-novel-metadata-persisted.png', '12-tools-generated-title.png', '16-mindmap-edits-persisted.png',
      '17-assistant-policy-restored.png', '18-virtual-assistant-history.png', '19-unified-corpus-backup.png',
      '20-dark-mindmap-draft.png', '21-shared-writing-goals.png.png', '22-first-visit-book-analysis.png',
      '22-first-visit-tools.png', '23-independent-novels-first-tab.png', '23-independent-novels-second-tab.png',
      '23-conflict-retains-draft.png', '24-concurrent-goal-increments.png', '25-short-story-exact-selection.png',
      '26-chapter-event-links.png', '27-book-analysis-library.png', '28-api-draft-isolation.png',
      '29-book-analysis-scope.png', '30-writer-outline-and-polish.png', '31-management-correctness.png',
      '32-tools-contracts.png', '33-billing-empty-state.png', '33-billing-filters-and-trends.png',
      '34-generation-budget-request.png', '34-generation-budget-settings.png',
      '35-anthropic-gateway-budget.png', '35-anthropic-gateway-settings.png',
    ]),
    ...files('browser-extensions', ['report.json', 'extensions-passed.png', 'failure.png']),
    ...files('browser-memory', ['report.json', 'clue-light.png', 'future-disclosed-at-80.png', 'clue-dark.png', 'clue-mobile.png', 'failure.png']),
    ...files('browser-memory-hybrid', ['report.json', 'hybrid-evidence.png', 'provider-fallback.png', 'failure.png']),
    ...factGraph,
  ],
  'writer-agent': files('browser-writer-agent', ['report.json', 'desktop-reviewed-draft.png', 'mobile-reviewed-draft.png', 'failure.png']),
}).map(([group, sources]) => [group, Object.freeze(sources)])))

// Only these five reports contain raw request collections. Graph-backup rows are
// request bodies themselves; the other producers wrap bodies with metadata.
export const REQUEST_PROJECTIONS = Object.freeze({
  'artifacts/browser-memory-novel-scan/report.json': Object.freeze({ requests: 'wrapped' }),
  'artifacts/browser-memory-support/report.json': Object.freeze({ requests: 'wrapped' }),
  'artifacts/browser-writer-memory/report.json': Object.freeze({ modelRequests: 'wrapped', retrievalRequests: 'wrapped' }),
  'artifacts/browser-memory-fact-graph/report.json': Object.freeze({ modelRequests: 'wrapped' }),
  'artifacts/browser-graph-backup/report.json': Object.freeze({ modelRequests: 'body' }),
})
