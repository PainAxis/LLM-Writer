# PR #40 browser-hook correction / 浏览器钩子修正

## English

The original retained reports and source manifests describe the reviewed tree `fe3085754fd3cedfe256b7756254cadcccc695b6` (remote head `b9f3b91991b580517216958eb38b91ad378b0d34`). They are historical evidence and are not relabeled as measurements of this correction. Production source is unchanged.

[First CI run](https://github.com/PainAxis/LLM-Writer/actions/runs/39829985687), job `120003254563`, actually passed 34 browser scenarios, including all 25 frozen semantic protocol cases. Scenario 06 then timed out waiting for a test injection flag. It did not establish a production freshness failure. See the retained `ci-first-browser-excerpt.log` (trailing whitespace normalized, timestamps/content preserved).

The old test wrapped `Response.json()`/`text()`. The installed SDK instead uses `readResponseBodyAsText` → `readResponseWithSizeLimit` → `response.body.getReader()`. Therefore neither old wrapper observed consumption. The correction installs a one-shot reader wrapper on the next synthetic chat HTTP response, records every consumed byte, and mutates the committed chapter title only at actual body EOF, before the adapter/SDK returns its parsed reply. It restores fetch immediately when the matched request starts, including failure paths, and does not change production code or replay the request.

The browser assertion now requires HTTP 200, actual EOF, byte count equal to the fixture's complete response, source-changed rejection, no assessment, cleared preview and cleared selected evidence. No case was removed and the declared 52-scenario/25-semantic denominators are unchanged. The exact helper is also exercised through the real production bounded adapter and SDK with chunked mocked HTTP: source unchanged at dispatch, changed only after complete consumption, exactly one dispatch and original fetch restored. This local check proves hook integration, not the browser's final freshness outcome; the corrected browser suite still requires CI.

A separate existing graph/backup/mobile job was canceled by its 12-minute overall deadline after Playwright dependency setup alone consumed 11 minutes 34 seconds; seven graph scenarios had passed. Both that job and the new support job now allow 20 minutes for setup plus execution. Actual graph and mobile test steps each retain a finite 4-minute limit; the support browser step has a 6-minute limit. No test assertion or case is weakened.

No new real-provider attempt was made. The previously failed Go test remains one attempted / zero assessed / six not run, with usage and cost unknown. No local browser was installed or launched.

## 简体中文

原始报告与源码清单对应已审阅树 `fe3085754fd3cedfe256b7756254cadcccc695b6`，保留为历史证据，不冒充本次测试修正后的测量。生产源码没有改变。

首次 CI 的新浏览器套件实际通过 34 场景，其中包括全部 25 个冻结语义协议用例；随后场景 06 等待测试注入标记超时。这不等于已证实生产来源校验失效。原因是旧钩子包住 Response.json/text，而当前 SDK 直接读取 ReadableStream reader，两者没有交点。

修正后的测试仅对下一次合成聊天 HTTP 响应安装一次性 reader 钩子，完整消费真实响应到 EOF 后才修改已保存章节标题。浏览器断言必须核对 HTTP 200、完整字节数、来源已改变提示，以及结论、预览和旧选择全部撤销。52 场景与 25 语义分母不变，没有删除用例或放宽来源校验。相同钩子已加入生产 bounded adapter + 实际 SDK 的分块模拟 HTTP 回归，检查发送前未改源、消费后真实改源、恰好一次调用和 fetch 还原；浏览器最终结果仍须本次 CI 验证。

既有 graph/backup/mobile 作业的依赖安装耗时 11 分 34 秒，在七项备份场景通过后触及总计 12 分钟时限而被取消。现为该作业和新增 support 作业提供总计 20 分钟的安装与执行余量，同时给 graph、mobile 实际测试各 4 分钟、support 浏览器测试 6 分钟的独立有限上界，不削弱断言。

没有新增真实服务调用、没有本地安装或启动浏览器。真实 Go 结果仍是 1 次尝试、0 次有效判断、后 6 例未运行，实际用量和费用未知。

## Correction validation / 修正本地验证

Zero-warning lint, all **91** smoke suites and production build passed again. The original direct Node invocation of the aggregate runner correctly rejected missing npm runner context before any suite; the subsequent documented npm command passed. Both logs are retained. `ci-fix-validation.json` records the current 212-path manifest and unchanged production source tree.

零警告 lint、全部 **91** smoke 与生产构建已再次通过。首次直接 Node 调用聚合脚本因缺少 npm 上下文而在任何套件开始前拒绝；随后按规定 npm 命令通过，两份日志均保留。补充清单记录本次 212 个路径及不变的生产源码树。


## Second CI attempt: Writer candidate-relative locator

Run [39833809302](https://github.com/PainAxis/LLM-Writer/actions/runs/39833809302) on `9fe242650344df7847fba51b100950855506d675` passed 46 support browser scenarios, including case 06 at real HTTP EOF, all 25 semantic cases, all late-result invalidations and the 600-chapter Lab path. Case 47 stopped at the first Writer selection before any writing request. The retained unmodified `ci-second-browser-report.json` records 46 passed / 1 failed / 5 not executed, 44 support calls, 0 writing calls and 0 unmocked external requests. Its DOM diagnostic explicitly contains both correct chapter 588/590 original excerpts and revisions. This was not evidence of missing retrieval.

The test supplied a dialog-rooted locator inside `filter({ has: ... })`, although Playwright evaluates the inner locator relative to each candidate card. The correction makes only that inner quote locator candidate-relative and additionally asserts exact quote text before checking the author's checkbox. No production files, cases, source/approval guards or 52/25/50/62 completion denominators change. The prior graph/backup/mobile job fully passed this time. Exact revised-head browser execution remains required; local Chromium is still not launched.

## 第二次 CI：Writer 候选内相对选择器

同一运行已通过 46 个支持检查浏览器场景，包括真实 HTTP EOF 后的源失效、第 25 个语义用例、全部旧结果撤销与 600 章 Memory Lab 路径。第 47 个场景在首次 Writer 勾选前中止，尚无写作请求。保留报告原始字节，记录 46 通过 / 1 失败 / 5 未执行、44 次支持检查、0 次写作、0 次非模拟外部请求；页面诊断明确显示第 588/590 章准确原文及修订，因此不把此故障误报为检索漏召回。

根因是 `has` 内层本应相对候选卡查找，却再次从 dialog 根节点开始。仅修正这一测试定位作用域，且增加勾选前原文完全相等断言，不改生产、源校验、作者批准或 52/25/50/62 验收分母。本轮图谱/备份/移动端 job 已完整通过。修正后精确 head 的浏览器验收仍待 CI，不以局部通过代替全部完成。


## Third CI attempt and production owner correction

Run [39836010886](https://github.com/PainAxis/LLM-Writer/actions/runs/39836010886), head `e437713f142d2f71e9c1cfbe547b0c2ff15dadf8`, passed 47 browser scenarios, including the complete 600-chapter continuation/check/author-approval/writing path. The next polishing journey failed before retrieval because repeated same-hash navigation reused the Writer route instance and its explicitly enabled memory setting. The complete, unmodified report is retained as `ci-third-browser-report.json`; 48 attempted / 47 passed / 1 failed / 4 not executed is not a full pass.

Auditing all remaining scenarios uncovered a separate **production lifecycle defect**: the dialog-close watcher only cancelled retrieval-busy operations, while support checks had their own busy state. Closing a pending support check could leave its owner and approval/preview state alive. The correction must synchronously revoke all three Writer entry-point owners on user closure/entry transitions while preserving the author's enabled preferences. The existing chapter-generation controller intentionally closes its workspace before acquiring the writing lease; only that private, synchronous, already-approved launch handoff may preserve the lease, and even that handoff revokes support-check capability/output. A broad `isBusy` exception or a blanket close/revoke would be incorrect.

Independent fresh-instance journeys now cross a fixture-only document before opening Writer, so both default-off assertions test real defaults. The close/reopen scenario uses only the real buttons in the same document, does not reload or reconfigure retrieval, and makes the controlled transport ignore abort and deliver HTTP 200. It then checks that candidates, selections, support preview/answer/assessment and approval remain absent while both author-enabled switches stay enabled. All 52 / 25 / 50 / 3 / 62 case, semantic, support, writing and source denominators remain unchanged. Production changes require renewed independent review, local full regression and exact-head CI, not inheritance of the earlier static approval.

## 第三次 CI 与生产 owner 修复

该运行通过 47 个浏览器场景，包括 600 章续写的支持核对、作者批准和真实生产写作适配链。随后润色场景尚未检索，就因同 hash 导航复用了作者已开启记忆的路由实例，错误触发“默认关闭”断言。原始报告保留 48 已执行 / 47 通过 / 1 失败 / 4 未执行，不称全套通过。

完整生命周期检查另发现真实生产缺陷：关闭对话框仅取消检索 busy，未撤销独立的支持检查 owner。修复同步处理三入口用户关闭和切换，保留作者已开启的开关，但清掉批准、候选与语义输出。章节生成既有“先关工作区、再取得写作 lease”时序必须保留；只有私有同步标记确认的、已批准启动交接才保留写作 lease，且仍撤销支持检查能力/结果，不用笼统 busy 豁免。

各独立业务场景明确创建新实例检查默认值；关闭重开场景只在同一文档内真实点击，不借重载或修改provider帮生产清状态，并让响应忽略取消后仍成功返回200，再验证候选、选中、预览、答案、判断与批准均未复活，两个作者开关保留。52 / 25 / 50 / 3 / 62 全部分母不减。生产已变化，须新一轮独立审阅、完整本地回归与准确head CI。
