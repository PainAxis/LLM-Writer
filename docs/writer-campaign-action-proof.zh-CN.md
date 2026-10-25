# Campaign action 私有验证证明

[English](writer-campaign-action-proof.md) | [简体中文](writer-campaign-action-proof.zh-CN.md)

状态：全本地回归及同源中英文各两轮 Node profile 已通过；原生 profile 及全部 13 项必要 CI 仍为 **NOT RUN（未运行）**。本文说明合同、限制和验收门槛，不是整体修复验收通过报告。[存储分配合同](writer-campaign-storage.zh-CN.md)与[长篇验收合同](writer-agent-longform-acceptance.zh-CN.md)仍须分别满足。

## 保留失败与修正目标

前一项 CPU 修正尚未关闭时延门槛。PR #46 合并提交为 `d098d27ba53a2edebbd1d7ec8dd49166cd81ec8f`，但 [main run 40170296500](https://github.com/PainAxis/LLM-Writer/actions/runs/40170296500) 的 Node 中文 profile 停在 966,686 已提交正文 scalar、120 已完成任务、121 次 fixture 调用及 486 笔已提交操作；一项未结 allocation 保留 U = 1,927,388 字节。原生 IndexedDB 中英文均完成 1,000,000 scalar、123 任务及 494 笔操作，但不能替代失败的 Node 门槛。

诊断显示某次 commit 选择了 action 剩余预算：当时约剩 1,981.314 毫秒，该操作耗时约 1,981.780 毫秒，action 已运行约 9,999.599 毫秒。配置仍为每 operation 3,000 毫秒、每 action 10,000 毫秒。phase 只说明在哪个阶段观察到到期，不能证明仅该次 commit 的 CPU 耗尽累计预算；先前工作、IO 和运行时调度同样计入。

普通已有任务 step 原需五次完整历史语义重放：初始读取，以及 reserve、dispatch intent、保留响应、接受 artifact 四次提交。候选方案改为一次完整冷读语义重放，加四次完整历史 raw 精确复读；每个新转移仍完整验证。启动、恢复和控制路径的阶段数可能不同。

## 私有权限与生命周期

`actionProof.ts` 管理 repository 本地池，`store.ts` 收集并核验证明，`engine.ts` 经既有 repository 方法传递可选 scope。scope 是仅由创建它的 repository 私有 `WeakMap` 识别的不透明 token，不是调用者提供的标志、hash 或 TypeScript 类型断言。它绑定一个 campaign 和一个 engine Run；私有当前 raw head 必须与调用者预期 head 完全一致。

私有 snapshot 与返回给调用者的对象及 Map 断开引用。新转移的前置业务状态、存储基线和活动引用来自私有已验证状态，不依赖公开 snapshot 的可变字段。修改返回的 checkpoint、artifact、request、receipt 或 Map 不能污染证明。

每个 repository 实例最多保留一个获准 scope 的证明，单 scope 操作 single-flight。准入不会让其他 action 排队等待缓存。缺失、外来、过期或未获准的 token 不授予加速权限；不带 scope 的普通调用保持冷读。注入的 repository wrapper 仍收到正常 read/commit，未转发可选 scope 的 wrapper 只是没有加速，不绕过其验证或超时接口。

证明不跨 command、repository、tab、恢复 Run 或重启传递。完成、abort、超时、stop/dispose、冲突、错误、不可变值不一致或重放时按相应路径清除证明。迟到 IO 不得恢复已清除条目或授予派发 permit。容量／准入不足只禁用优化，不能单凭缓存失败把合法读取或已确认持久提交改成失败。

## 每次加速转移之前都精确复读

1. 首次 scoped read 执行既有完整冷读校验器，收集实际 IO 返回的不可变 key/raw-string：manifest、全部 checkpoint 和 receipt，以及 receipt 引用的全部历史 request/artifact，包含非活动修订、已结算 origin、被替换 artifact 和脱离任务索引的未结义务。未完成的重放不构成证明。
2. 下一次 commit 仍权威查询 operation receipt 并检查身份冲突；重新读取 head、catalog 及下一 checkpoint key。head 必须精确匹配，经验证的 catalog 前缀须保持至当前 campaign，successor 必须不存在。
3. 再次通过 IO 读取每个已收集的不可变 key，每批最多 32 条不可变记录加 head。批次还以已记录 key/value 字节不超过 1 MiB 为目标，必要时允许单条本身有界的记录独占一批。每批 head 必须一致，每个历史 value 都须与该 key 先前验证过的 raw 字符串逐字相等。
4. 缺失或变化字节一律拒绝。语义等价 JSON、空白变化、等长替换或重新封 hash 的记录都不算相等。raw 完全相等时，才无需重复历史解析、canonical 序列化、hash、文本指标和账本重放；不是只看 hash、head、抽样或活动索引。
5. 最终 head/catalog-prefix/successor 防护继续重新读取。catalog 前缀规则允许另一个 campaign 追加，不允许重排／删除。新转移仍完整验证状态及 epoch、task/candidate/dependency 血缘、不可变 request 身份和阶段、精确响应接受、正文计数、allocation 守恒、真实序列化写入量及取消／恢复保护。
6. CAS 仍核对精确旧 raw head、不可变目标只创建及既有 `canCommit` 边界；供应商授权仍须先确认持久 dispatch intent。仅在 CAS 明确确认成功后，以已完整验证的预期写入 raw 字符串扩展证明，而不是相信随后重读碰巧看到的字节。下一阶段仍须复读这些新条目。

旧 operation receipt 重放或相同并发 CAS 获胜，走独立验证 receipt 加完整冷读，不从调用者 snapshot 扩展证明。ACK 丢失在持久证据确立结果前仍为未知，内存中的拟写入对象不是成功证据。不新增供应商调用、退款、重试权限或历史修复。

## 边界、复杂度与不变的存储信任

每个 repository 实例保留的不可变 key/value UTF-8 载荷合计最多 67,108,864 字节，sealed proof 还须不超过已验证累计写入 W。条目上限为 `4 × 2,048 + 1 = 8,193`。收集期间即执行限制，不能等 seal 后再截断。超限丢弃整份证明，不留下部分可信历史；每个 action 最多尝试收集一次。

证明保留 raw 字符串和有界元数据，不保留整个历史的解析对象副本。当前解析 artifact/request 仍限 512 条 wanted 记录，含 prior artifact 和 open allocation，并遵守既有活动载荷上限。catalog 前缀最多 32 个已验证 ID。成功提交后的 proof extension 若超限，提交仍成功，后续校验改走冷读。

raw 字节上限**不是 JavaScript 堆上限**。UTF-16 字符串、Map/key/对象开销、分离的私有／公开活动对象图、临时 IO 值、解析／hash 分配和 GC 都占内存；字符串驻留共享不是保证。多个 repository 实例及 tab 各有池。序列化保留量和堆采样必须分开报告，均不能冒充整个应用的内存上界。

设 B 为历史序列化字节，k 为 action 的转移数，候选仍需一次完整语义读取及 k 次完整 raw 复读。历史 IO 为 O((k + 1)B)，raw 比较最坏 O(kB)；随历史增长的整个 campaign 仍有二次累计历史 IO。这不是 O(delta) 恢复、持久可信索引或无界历史方案，只减少同一 action 内重复语义工作。

既有非原子的观察→CAS 窗口不变：各 readonly 批次分别读取历史，写事务核对 head 和新写目标，不在同一事务中核对全部历史 value。绕 repository 的 raw writer 可在某记录最后被观察后、CAS 前修改它而不改 head。旧 verifier 和本证明均不保证原子历史快照或每一瞬间都发现变化；下次验证仍须复读全部历史 key。若要求保护至 CAS 线性化点，须另行评审 IO／事务合同，不能暗中假定更强的底层不可变性。

本项不迁移 wire schema、不增加持久 proof 记录、不改存储记账或 `blobStore.ts`、不提高限制。v2 validator 与 W/U/P 守恒仍是权威；v1 仍只读，未知／损坏字节保留并拒绝。128 任务、2,048 操作、64 KiB 文本、1 MiB 单记录、64 MiB 累计写入限制均保持不变且有限。

## 明确的截止时间收紧

候选替换现在在初始读取之前创建 Run，并把同一个 Run 传给替换 receipt 和 operation-artifact 重放查询。它们因此共同消耗当前 action 剩余的 10 秒，而非脱离 Run、仅受单操作计时约束。这是实际执行约束收紧，**不是纯性能等价**：过去可超出累计 action 预算完成的重放，现在可能超时。

名义 3 秒 IO operation 与 10 秒 action 上限没有提高，也不在各阶段重新计时。恢复保留既有独立预留行为，不继承证明权限。性能验收必须包含替换／重放回归，而非只测正常 step 吞吐。

## 测量与验收门槛

中英文分别使用不变的 123 任务／60 正文任务 geometry，在 Node 注入原子 IO 和原生 IndexedDB 中运行。成功须为 1,000,000 已提交正文 scalar、123 完成任务、恰好 123 次 fixture 调用、零记账不一致，且完成状态无未结 allocation。报告 W/U/P、提交操作数、raw IO 次数／字节、有界批次／记录峰值及独立冷 repository／进程重启成本。Node 与原生事务的计量边界需标明，不能直接互换读取计数。

候选观测新增有界、无正文的 proof 计数、堆采样、action 分位数和全部 bounded operation 的计时直方图。最终源码证据须证明实际采集，不能从代码存在推断结果：

- proof 计数区分冷读尝试／完成、完整 exact pass、已匹配记录／字节、通过验证并到达 CAS 的转移、保留峰值及白名单 disposal/fallback 原因。匹配量可含最终失败 pass 的已完成工作，转移计数也含 cold fallback 和失败 CAS 尝试。`completed` disposal 表示显式关闭 scope，包含 abort/finally 清理，不表示用户 action 成功；这些计数均不能单独代表持久成功。
- action 计时报告采样数和 min/p50/p95/max，对最多 123 个取整 step 时长样本求 nearest-rank 分位数。要观察后期 action 余量，而非仅报告总耗时或把一个最大值当保证。
- operation 计时覆盖每次 `bounded()` 首个胜出结果，包括 success/error/abort/timeout 及同步调用错误，不只记录超时。固定 phase 行记录次数、结果分类计数、min/max 和定长直方图；迟到结果不重复计数。由直方图导出的分位数是近似区间，不是精确样本。既有 phase／所选预算超时诊断作为独立证据保留。
- 可用时采样 Node process 或 Chromium `performance.memory`。baseline、sampled peak 和 final 不是实际分配峰值、证明独占内存或 GC pause 测量，Chromium 还可能分桶。采集不可用／失败须如实标记，不能填零或视为通过；不强制 GC，不上传 heap dump。

必要回归包括全部历史记录类型、旧非活动历史、各 engine 阶段前后同 head 损坏、调用者对象修改、外来／已释放 scope、准入／容量边界、并发／重入、迟到完成、取消／替换、catalog/successor 防护、CAS abort/false/guard-false、ACK 丢失及仅保存冷重启。关键路径须经真实 engine/repository 和原生 IDB，不仅测独立 proof mock。保留独立冷读、精确 wire、记账、超时、预算、UI 全部既有套件，以及 Campaign 12 场景和作者 Agent 90 场景。

在指定 runner 上测得实质且可重复的 action/operation 余量，不出现所选预算超时或新增病态堆行为。贴近截止的一次通过不足以宣称时延问题修复；对任意慢硬件或运行时不作普遍 wall-time 保证。

## 实测结果及剩余门槛

| 精确最终源码门槛 | 状态 |
|---|---|
| 全部本地回归，含 proof 和替换截止案例 | 已通过 lint、严格类型、build、128 套测试 |
| Node 中英文百万 scalar profile 及冷 repository 读取 | 各两轮通过；[本地证据](testing/writer-campaign-proof-2026-10-25/REPORT.zh-CN.md) |
| 原生 IDB 边界案例、双语 profile 及冷进程重启 | NOT RUN |
| 绑定源码的 proof、action/operation 计时及堆采样证据 | Node 两轮均已采集；原生待测 |
| 全部 13 项必要 CI 及合并后 main 跟进 | NOT RUN |
| 真正自主中英文各百万字符小说及文学／连续性审计 | NOT RUN |

待补项须取得实际最终 source/harness/build 身份绑定的结果，不把不同修订的历史通过拼接成修复验收。重复合成正文只测协议几何，不证明规划、文学质量、创造性或长程一致性。

## 证据处理

完整正文、请求／响应全集、原始备份、trace 和 store dump 留在本地。仅上传专用闭合 schema、无正文的派生报告／manifest，限定计数、计时摘要、有界枚举和源码身份白名单。未知字段拒绝；不得包含 raw key、campaign/operation ID、正文、凭据、原始错误 stack 或可重建载荷全集。堆采样数字可以报告，heap dump 不可上传。

未提交运行的 commit ID 只表示 checkout 基线，不代表修改后源码；须用精确 source/harness digest 及前后 manifest 绑定实测字节，区分 Node 源码摘要与浏览器实际 build 摘要。失败／未完成测量保留。原始备份和正式证据不当作临时材料清理；profile、CI 或文学验收尚未发生时不能称为通过。

本地观察：中文 action 最大 2,220/2,365 ms、英文 1,763/1,810 ms，timeout/error/abort 均为零。heap、完整 operation 细节、失败基线及尚待原生／CI 门槛见[精简证据](testing/writer-campaign-proof-2026-10-25/REPORT.zh-CN.md)；不表示本修正已整体验收。
