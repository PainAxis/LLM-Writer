# Writer integration boundary audit / Writer 集成边界核对

The second actual PR #41 run passed the first 15 scenario groups, including complete long A/B and continuation beyond 512 candidates. Its sixteenth group failed before any Writer call because the test searched for a model annotation paraphrase that the existing safety bridge intentionally does not expose. Production is unchanged. This document describes test assertions, not a passed browser run.

第二轮 PR #41 实测前 15 组通过，包括长篇全 A/B 和超过 512 候选的续批。第 16 组在任何 Writer 调用前失败，原因是脚本按模型标注摘要查找卡片，而既有安全桥刻意不展示该非逐字摘要。生产不改；以下是测试边界，不是浏览器通过声明。

| Boundary / 边界 | Required observable / 必须观察到的结果 |
| --- | --- |
| Fresh Writer document / 新 Writer 文档 | New document token, saved graph byte-equivalent, API configuration unchanged; memory/embedding/rerank default off; no result/approval. / 文档标记变化，图谱不变；开关初始关闭，无结果和批准。 |
| Search complete / 检索完成 | Search enabled and result visible, no selected evidence, approval disabled. / 检索结束、结果挂载，候选未选中，不能批准。 |
| Relation display, both searches / 两次关系展示 | Exactly one indexed relation card; exact endpoints, safe predicate 原文关联, provenance flags, full original quote, original revision, chapter ordinal/title and UTF-16 offsets. Original annotation paraphrase absent. / 唯一卡片及完整原文/修订/位置，模型摘要不进入安全结果。 |
| Author approval, both searches / 两次作者批准 | Approved visible, exact success notice, search enabled after all source-validation awaits. Only then change cutoff or generate. / 等待批准及校验全部结束后，才改披露范围或生成。 |
| Earlier cutoff / 提前截止 | Approval revoked; completed new search contains zero relation cards. / 批准撤销；新检索完成后无越界关系。 |
| Generation envelope / 实际生成输入 | Same persisted relation ID; safe predicate; explicit/model/confirmed flags; all original anchor fields match; plot explanations, original model predicate and future canary absent. Saved graph unchanged. / 持久 ID、原始依据、来源不变；不得带入标注解释或未来内容。 |
| Continue / 续写 | Actual result content before closing. / 结果真实出现后关闭。 |
| Polish / 润色 | Actual result content before closing. / 结果真实出现后关闭。 |
| Chapter / 正文生成 | Dialog closed, editor contains generated text, success notification after persistence and final guard, saving indicator absent, independent committed-content read matches. / 窗口关闭及编辑器内容不足以证明保存；另验成功通知与已提交正文。 |
| Old-chapter scenario / 修改旧章 | Restore/mutate only after prior chapter commit; all three completed Writer searches exclude old relation, no approval; Lab plot empty state and refresh enabled, no error; original annotations remain stored. / 等前场景落盘后再独立恢复；须等空态加载完成，不能把尚未加载当无标注。 |
| Mobile / 移动端 | Held request observed before cancel; zero late candidates; new explicit scan and complete three-premise review, bounds and 44px cancel target. / 取消前请求已被观察；重新授权扫描后核对三前提与布局。 |

Implementation references: `writerContext.ts` safe predicate mapping and relation serialization; `WriterMemoryContext.vue` indexed card and `result` mount gate; `useWriterMemoryContext.ts` asynchronous approval; `useWriterChapterContentGeneration.ts` post-commit success; `PlotLinksPanel.vue` asynchronous graph/empty-state gate. Actual SFC SSR provides a lightweight regression for the bridge and rendered fields. It does not replace Playwright/CI.

Frozen browser requirements stay **20 groups / 834 A + 667 B = 1,501 scan calls / 3 Writer calls / 1,388,842 original UTF-16 units / 3,354 spans / 568 proposals**. No production, workflow, fixture, scenario or safety assertion is relaxed. The prior failed reports remain historical evidence.

浏览器固定门槛及分母不变。SSR 不替代真实浏览器验收；历史失败报告原样保留。
