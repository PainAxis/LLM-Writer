# Writer/Lab mount preconditions for all 52 browser scenarios

This is a test timing contract, not a browser pass. It was derived from the actual production templates after CI run 39839903136 exposed an assertion against a control that did not exist yet. No production condition is changed to satisfy the script.

## Production gates shared by all three Writer modes

- `Writer.vue`: chapter / continuation / polishing each pass their memory slot only while their own `show*Dialog` is true. All use the same `writerMemoryState` and `WriterMemoryContext` component.
- `ChapterGenerateDialog.vue`, `ContinueDialog.vue`, `OptimizeDialog.vue`: each renders the memory slot inside its dialog. Element Plus may retain a closing dialog shell during animation; tests wait for the dialog to become hidden. The Writer slot's `v-if` does not retain the memory subtree.
- `WriterMemoryContext.vue`: the panel and memory toggle exist once the slot is mounted; search/provider controls require `enabled`; the entire result block requires `enabled && result`. `MemorySupportCheck` and the approve button are both **inside that result block**. Selection changes their availability, not their existence.
- `MemorySupportCheck.vue`: its root/toggle exist when the parent mounts it. Question, prepare/close controls and status require `state.enabled`; preview requires `state.preview`; send additionally requires phase `ready`; running requires phase `running`; assessment requires an assessed result while not running. Empty selection disables prepare and Writer approval.
- `useWriterMemoryOwner`: user close/entry transition synchronously clears result, selection, approval, support preview/result/run ownership but retains the author's memory/support enabled preferences. The narrowly marked, already-approved chapter launch transfers only the writing lease and invalidates support.
- Memory Lab is different: its support component is mounted at route level, not under a Writer result block. Its enabled/off/unverified controls therefore cannot be used to infer Writer mount timing.

## Node-state timeline, identical controls across chapter / continuation / polishing

| Step | Dialog / memory panel | Search | Candidate result | Support root / toggle | Support preview / output | Approve |
|---|---|---|---|---|---|---|
| Fresh document, dialog closed | hidden / absent | absent | absent | absent | absent | absent |
| Open fresh dialog | visible / present; memory unchecked | absent | absent | absent | absent | absent |
| Enable memory, before retrieval | visible / present; checked | present | absent | absent; do not ask whether checked | absent | absent |
| Successful fresh retrieval, no selection | visible / present | present | present | present, unchecked on fresh owner | absent; question/prepare absent while support off | present, disabled |
| Select exact original references | visible / present | present | present | present, still unchecked | absent | present, enabled |
| Explicit approval before support check | visible / present | present | present | present | absent | present; approved marker visible |
| Enable support, prepare current selection | visible / present | present | present | present, checked | ready preview/send after local prepare; no automatic HTTP | prior approval cleared |
| Send / held response | visible / present | present | present | present, checked | running, no assessed answer | present, disabled |
| Valid assessed result | visible / present | present | present | present, checked | cited assessment present | enabled but not approved |
| Author approves for writing | visible / present | present | present | present | no automatic writing | approved marker visible |
| User closes dialog | wait until hidden; slot absent | absent | absent | absent, even though preferences retained | absent | absent |
| Same-document reopen | visible / present; memory still checked | present | absent | absent, not unchecked | absent | absent |
| Ignore-abort HTTP 200 arrives after reopen | unchanged, same `performance.timeOrigin` | present | remains absent | remains absent | remains absent | remains absent; no new HTTP |
| Author explicitly searches again | same document / present | present | new result present, none selected | remounted, checked because preference survived | no old preview/answer/assessment | present, disabled; support prepare also disabled |

### Mode-specific writing completion

- **Continuation:** stream completes into the dialog's `.result-content`; the test checks it, then manually cancels. Memory owner revocation follows actual user closure. It does not append or save prose in this test.
- **Polishing:** stream completes into its own `.result-content`; the test checks it, then manually cancels. The same memory component and closure rules apply. It does not replace or save prose in this test.
- **Chapter generation:** the controller intentionally closes the workspace **before** requesting text. Only the private synchronous, already-approved handoff preserves the writing lease; support is cleared. The test observes the writing request, then dialog hidden, generated editor content, and completed saving indicator. It never queries a support toggle inside the closed dialog. Existing real controller/stream unit tests cover normal/default-off/failed/cross-chapter launch and non-cancellable commit behavior.

## All browser groups and their node preconditions

| Group | Cases | Surface / prerequisite before assertions |
|---|---:|---|
| 01 default-off / local retrieval | 1 | Lab route support is mounted; do not reuse this fact for Writer. |
| 02 semantic fixture | 25 | Lab search completes, references selected, support enabled, ready preview, explicit send; wait for assessed current-source output. |
| 03 private request / duplicate send | 1 | Lab has ready preview before DOM-only mutation and send clicks. |
| 04 malformed/transport/refusal controls | 6 | Lab has a ready selected-source plan; after dispatch expect unverified, not assessed. |
| 05 source changes during response | 1 | Lab held response; committed body changes before release; result must be invalidated. |
| 06 source changes at actual EOF | 1 | Lab ready/held response; hook records actual complete HTTP bytes before source-title mutation; publication must fail. |
| 07 nine ownership invalidations | 9 | Lab ready/held response; each selected change has its own setup/recovery; navigation returns to Lab before querying route-local nodes. |
| 08 full-scan lifecycle | 1 | Lab support stays mounted, but incomplete full-scan state makes preparation unavailable. |
| 09 long-novel Lab | 1 | New Lab fixture, local-only retrieval, two late exact originals selected, ready preview then explicit assessment. |
| 10 long Writer modes | 3 | Fresh document for each mode; memory toggle default off. Before retrieval result/support/approve must be absent. After search support checkbox exists and is off; select exact originals, prepare/check, re-approve, then write. Completion uses the mode-specific rules above. |
| 11 Writer close/reopen late success | 1 | Fresh small Writer, search mounts support/off. Close held check; same-document reopen has no result/support/approve. Release HTTP 200 and prove no revival/no automatic request **before** any new search. Then explicit search remounts retained support/on with no selection/preview/approval. |
| 12 mobile citation/cancel | 1 | Lab route at 390 px; ready/running checks before cancel/citation layout assertions. |
| 13 gold mutation oracle | 1 | Pure frozen fixture assertions, no UI mount assumption. |
| **Total** | **52** | **25 semantic cases, 50 support calls, 3 Writer calls, 62 selected-source transmissions unchanged.** |

The same-document case captures the request baseline after the held request is recorded but **before closing**, verifies actual memory-slot removal with a page-wide panel count of zero, and records `newRequestsDuringCloseReopen` across close → reopen → late HTTP success before its final explicit retrieval. That new retrieval is authorized by the test action and may use the already configured mock retrieval provider; it must create zero additional support or writing calls. `sameDocument` is backed by equality of `performance.timeOrigin`, not just a report literal. A Node actual-SFC SSR matrix complements the existing real owner/composable races; neither substitutes for the complete production browser CI.

## 中文时序核对

三种 Writer 入口共享同一模板门槛：对话框可见才挂记忆组件；开启记忆才挂检索区；取得非空 result 后才挂支持组件和批准按钮。是否选中依据只影响可用性，不影响支持开关是否存在。开启支持后才有问题／准备／状态，再由 preview 和 phase 决定发送、运行中或判断结果。

因此检索前必须断言支持组件不存在，不能把“不存在”当“未勾选”。同实例关闭后，作者开关的内存偏好可保留，但结果、批准和支持子树全部撤销；重开时仍不存在。先保持同一 performance.timeOrigin，释放忽略取消但返回 200 的旧请求，验证没有复活、没有新请求；记录零自动请求后，再明确点击新检索，才检查重新挂载的支持开关仍开启、选择为空、准备／批准禁用、旧预览／答案不返回。

续写／润色在各自对话框显示结果后人工关闭。章节生成沿用“已批准启动交接先关窗、再请求正文和保存”的真实流程，不在已关闭对话框里查询支持控件。Lab 的支持组件在路由中直接挂载，与 Writer 不同。上表逐组列出全部 52 场景前提，25／50／3／62 分母不减少。新增实际 SFC 的 Node SSR 检查只验证模板挂载，不冒充浏览器通过；完整 CI 仍必须执行。
