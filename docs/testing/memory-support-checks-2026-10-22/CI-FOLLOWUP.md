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
