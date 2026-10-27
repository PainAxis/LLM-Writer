/** Zero-SDK pure compiler population. This never awards positive generation-task credit. */
import { runCreativeCompilerControls, runCreativeContextCapacityControl } from './lib/creative-pilot-compiler-controls'
import { CREATIVE_COMPILER_IDS } from './lib/creative-pilot-registry'
import { emptyCreativeControl } from './lib/creative-pilot-report'
const rows = CREATIVE_COMPILER_IDS.map(emptyCreativeControl)
const contextCapacity = emptyCreativeControl('M06')
async function main() {
  try {
    await runCreativeCompilerControls(rows)
    await runCreativeContextCapacityControl(contextCapacity)
    process.stdout.write(JSON.stringify({ status: 'pass', scope: 'pure_compiler_controls', sdkRequests: 0, positiveGenerationTasksAwarded: 0, rows, contextCapacity }) + '\n')
  } catch {
    process.stdout.write(JSON.stringify({ status: 'failed', scope: 'pure_compiler_controls', sdkRequests: 0, positiveGenerationTasksAwarded: 0, rows, contextCapacity }) + '\n')
    process.exitCode = 1
  }
}
void main()
