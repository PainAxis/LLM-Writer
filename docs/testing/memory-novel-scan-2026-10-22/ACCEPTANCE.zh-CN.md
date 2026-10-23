# 候选扫描：已验证功能基线与交付门槛

[English](ACCEPTANCE.md) | [简体中文](ACCEPTANCE.zh-CN.md)

[PR #41](https://github.com/PainAxis/LLM-Writer/pull/41) 已有完整代码／测试验证基线：[run 39948664256 attempt 1](https://github.com/PainAxis/LLM-Writer/actions/runs/39948664256) 的**全部十一项必要任务通过**。候选浏览器报告于 2026-10-23 12:00:23 UTC 完成，记录 **20/20 通过、0 失败、0 未运行**。本记录验证这一有限实现基线，**不**宣称随后交付 head 已通过 CI、PR #41 已合并，或其 main 已通过。最终交付另按下文门槛核实。

## 准确基线身份

- PR head：`8b5ac0af7ef01c0fb29953ed3dec11f941748026`。
- 等价本地快照：`2817825b5775d705a45655abe5122af22665fd3b`。
- 原始浏览器报告记录的实际 Actions checkout：`b8127b7155a3453d1d76593976f3983724f169e8`。
- checkout parents：main `7e2ae7d50c96f59894a8c96c9efb5d53aac4bfb9` 与上述 PR head。
- 三个基线提交身份均对应 tree **`9d88d35fe13375b36f5cd57676dca968e1a7d64a`**。它们是不同提交，不混用 SHA 标签。
- 冻结候选语料 SHA256：`6d54c1cc1a02d0fe1b4b7580b21c8e5fb02d13f15e9f712b853e6721b67a8206`。

后续文档／证据提交的整体 tree 身份必然不同。生产、package 与 fixture 保持本基线内容不变。执行文件仅修改浏览器 harness 的备份／trace 本地输出路径，以及 `.github/workflows/ci.yml` 的报告／截图上传白名单；场景、断言与预算不变。其自身准确 head 仍须完成独立审阅和全部必要 CI。

## 四条有限工作线分别核对

- [x] **第 1 条：冷索引、新实例恢复与来源加载。** PR #38 已合并至 `ed83bfef9903e8870ecf8b2b7ff2f47da6d2b5fc`，所记录 main 检查已通过。[固定语料 ABBA 对照](../../memory-cold-index.zh-CN.md)证明 132 万和 1,050 万字符的目标冷构建／新实例中位数下降，完整检索结果及评分不变，并如实保留 CPU／内存和变慢路径。历史正文加载对照仍单列。新实例重建和剩余全库成本属于公开限制，不是未关闭的第五条工作线。
- [x] **第 2 条：明确授权的全范围语义容量。** PR #39 的九项 PR 任务及 16 个全扫描浏览器场景通过，合并至 `73e730a848c3272ad5a243d028cec65ad5b72c8b`，随后 [main run 39822084525](https://github.com/PainAxis/LLM-Writer/actions/runs/39822084525) 通过。[合同与证据](../../memory-full-range-semantics.zh-CN.md)覆盖零请求计划、明确开始、同向量流式等价、全部合格来源／必要前提、累计预算，以及分别验收的 Writer／生命周期边界，同时保留 2,000 条／32 MiB 向量缓存。受控 46/46 查询不证明真实模型语义或可回答性。
- [x] **第 3 条：可选引用支持核对。** [PR #40 验收记录](../memory-support-checks-2026-10-22/ACCEPTANCE.zh-CN.md)保留无阻塞审阅、run 39844019935 attempt 2 十项必要 PR 任务全过、合并 `7e2ae7d50c96f59894a8c96c9efb5d53aac4bfb9`，以及 run 39848961580 十项 main 任务全过。实际证据包括 52/52 浏览器场景、25 语义用例、50 次核对及三次 Writer、62 选中来源、27 引用和 26/26 必要前提；独立 600 章场景不扩大 25 例语义分母。核对意见不批准 Writer 依据，不进入写作提示词。首个被取消的 Writer attempt 仍不算通过。
- [x] **第 4 条功能基线：A 已披露原文覆盖、B 有限连接与图谱 v2 作者审阅。** 上述 PR #41 基线通过全部十一项任务及 20 组候选浏览器场景。下方逐项实测证明完整长篇 A/B、真实 >512 续批、明确作者审阅、图谱／CAS／备份保护、三个分别完成的 Writer 入口、过期来源拒绝及移动端审阅／取消。这验收有限实现／测试范围，不代表任意关系完整、真实模型质量或最终 head 已交付。

## 第 4 条：实际执行观察

下列结果来自原始报告的 `requests`、`tests`、`longForm` 与 `capacity` 字段，不只是抄写 `expected` 断言。

- **完整执行：**20 组全部通过，没有失败或跳过。语料错误、浏览器错误、被阻止请求及未模拟请求均为零。
- **派发及原文总量：** **834 A + 667 B = 1,501 次扫描**，另有**三次 Writer**；扫描传输包含 **1,388,842 原文 UTF-16 单位／3,354 spans**，收到 **568 个候选响应**。仅扫描的序列化输入为 **3,404,501 字符／6,148,689 UTF-8 字节**；不含三次 Writer 输入，也不是 token 用量或费用。
- **长篇 A/B：**共 600 章／1,320,000 原文单位，其中已披露 599 章／**1,317,800 单位**。完整 A 发出 **599 次调用**，保留 cue 的 B 发出**九次调用**，B 传输 16,000 原文单位。这是该有限长篇场景的完整受控运行，不是 1,050 万全文模型运行。
- **真实满池续批：** **180 A + 537 B = 717 次尝试**，首批明确忽略 511 个候选，`campaignContinued: true`。同一 campaign 在 512 候选池后继续保留的 B 工作，不重发已完成任务，也不重置累计预算账本。
- **授权、持久化与生命周期：**零调用预览与 A/B 分别开始；明确保存及已提交 CAS 确认；Settings 备份／恢复；追加预算与部分审阅；失败后不隐式重试；取消／来源／披露／外部图谱／导航改变后拒绝忽略 abort 的迟到响应；已发布但未保存候选失效。部分覆盖不会冒充完整。既有完整 CI 同时保留 v1 内存归一化、v2 全前提保存及未知未来版本拒绝不覆盖。
- **三个 Writer 入口分别完成：**续写、润色、章节正文生成各恰好**一次 Writer 请求**，含**一个选中关系**、**零个直接选中的原文条目**、**一个完整 1,000 单位关系原文 anchor**、**零个 plotLinks**，且**没有未来 canary**。三个入口分别选择同一条持久关系。这一 Writer 关系 anchor 与三前提伏笔候选不是同一分母。真实卡片和请求保留相同持久关系 ID、安全 predicate `原文关联`、端点、出处及原文／修订／位置；模型标注摘要和伏笔解释不进入 Writer。图谱作者确认不等于本次选择或批准。两次批准均等待来源验证完成。章节路径验证持久化后的成功通知，并独立读取已提交正文，不把关闭窗口或编辑器可见内容当作保存完成。
- **旧章与移动端：**修改引用章节后，三个完成态 Writer 检索均排除失效关系，Lab 伏笔不可见，同时保存标注仍在。390px 路径先观察到 held 请求再取消，拒绝迟到候选，随后重新明确扫描并审阅完整三前提候选，校验取消目标和布局。

[Writer 边界表](post-safe-writer-bridge/WRITER-BOUNDARIES.md)说明被测生产边界。之前的 Node／实际 SFC SSR 回归是补充，不替代本次完整 CI 浏览器执行。独立 `ci-memory-novel-scan` 继续位于旧 `test:browser` 聚合之外。

## 两轮历史失败仍是失败

1. [Run 39850088338](https://github.com/PainAxis/LLM-Writer/actions/runs/39850088338)，head `9ec833968272e19a9a66a11de2a36b05ba1848a0`，tree `d64e2b449206490f156211391e6147baaee7e548`：**1 通过／1 失败／18 未运行**，25 次 mock 扫描，零次 Writer。场景 02 在 CAS 前把 busy／disabled 当作已完成确认。原始报告与身份保留于 `post-confirmation-waits/ci-first-*`。
2. [Run 39944749373](https://github.com/PainAxis/LLM-Writer/actions/runs/39944749373)，head `65a64d7952854dff50ef5785057c241d5a1563fd`，合成 checkout `2d8870de15105ec486dd166b76b5c8d4f714d818`，tree `66b185e635facd342b4a2f23bb59293939a0b7be`：**15 通过／1 失败／4 未运行**，1,475 次 mock 扫描，零次 Writer，1,387,733 原文单位和 3,311 spans。完整长篇 A/B 及 >512 续批通过，但 Writer 定位器错误期待模型标注摘要，而非既有安全 predicate。剩余 Writer 路径未获验收。原始报告仍无损压缩保留于 `post-safe-writer-bridge/ci-second-browser-report.json.gz`，身份与 jobs 单列。

每个失败 head 另有十项任务成功。这些是历史结果，没有移植或拼接成新 head 的十一项通过。后两次 harness 修正没有改生产、workflow、package 或 fixture。[历史报告](REPORT.zh-CN.md)、原本地测量及两份失败原始报告均保留。

## 十一项基线与最终交付规则

功能基线的下列任务均在 run 39948664256 attempt 1 以 success 完成：`ci-memory-capacity`、`ci-memory-cold-index`、`ci-memory-full-scan`、`ci-memory-support`、`ci-memory-novel-scan`、`ci-memory-stress`、`ci-memory-browser-stress`、`ci-graph-backup-mobile`、`ci-writer-memory`、`ci-quality` 和 `ci-browser`。[保留的任务记录](accepted-ci-39948664256/jobs.json)与[派生摘要](accepted-ci-39948664256/summary.json)将结果绑定准确 head／checkout／tree。

共同工程门槛继续要求已提交来源而非编辑草稿、每条前提修订／披露校验、不泄露未来信息、明确选择及批准、拒绝过期／迟到／取消／被取代结果、安全处理保存失败／并发写，并分别验证每个 Writer 入口。上方四轨记录及本次完整基线执行提供相应有限证据；mock 语义响应从不等于质量认证。

合并前，最终交付 head 必须**独立审阅无阻塞，并在该准确 head 通过全部十一项必要任务**。核实生产／package／fixture 与功能基线不变，harness 输出／workflow 附件策略仅有上述有限变化。合并后再单独核实实际 merge 身份／tree 及 main 运行。[PR #41](https://github.com/PainAxis/LLM-Writer/pull/41)及其关联检查是实时交付记录；功能基线的绿灯不预先批准后续 head。不需要仅为了记录自身上一轮文档提交通过而不断创建新提交。

**只有这些实际交付事实确认后，才开始第四阶段实施。** 此前只做设计。有限入口保持为授权工具 → 检索 → 草稿 → 作者审阅，明确允许清单、步骤／时间／请求限制、取消、过期拒绝及可见审计；不暗中应用正文或扩大权限。阶段二存储／编辑器／共享摘要、可选运行服务、Pi 架构及新的真实模型测试都不是新增前置项。

## 持久证据与未改变的限制

`accepted-ci-39948664256/` 保留 `browser-report.json.gz`、`summary.json`、`jobs.json`、`novel-scan-job.log`、`desktop-reviewed-bridge.png`、`mobile-three-premise-review.png`、`documentation-validation.json` 及独立 `SHA256SUMS`。成功浏览器原始 JSON 共 **7,338,074 字节**，SHA256 为 **`1a9bd5c6df6e5e0a7c6e828872efd6292941b46def5107b182acc9c0851dee34`**；无损解压保留这些精确字节。派生摘要与原始观察分开。[桌面审阅截图](accepted-ci-39948664256/desktop-reviewed-bridge.png)和[移动端三前提截图](accepted-ci-39948664256/mobile-three-premise-review.png)随运行保留，不替代实际断言。

浏览器全部由 CI 执行，没有安装或运行本地浏览器。固定受控语料仍同时报告**全故事 12/18、已披露 12/17、合同内 12/12**，六个 negative controls 另列。A 覆盖所有已披露已保存正文窗口，不代表所有可能 cue 或关系；有限 B 仍漏掉不支持的路由、未提取的 cue／key、任意四前提以上链及未来才披露的别名。历史 1,050 万观察是准备／几何／一次受控调用／预算暂停／取消，不是全文 A+B 推理；16 MiB 是出处 payload 上限，不是总进程内存。

候选扫描验收未调用真实模型。先前获准的 Go 仍为**1 次传输失败、0 项判断、6 项停止／未运行，实际用量和费用未知**。没有重试；受控成功及缺失用量都不能证明真实模型质量、浏览器到服务商的 CORS 支持或费用为零。

## 完整备份仅本地保留与附件策略

成功运行的完整合成备份（8,156 字节；SHA256 `341930c856501f5783b48d992d01b4b4e5bfd35e4ffa537757172d04f2af28c5`）保留于现有工程工作区的持久本地证据目录，**不放入本 Git tree，也不再上传**。其内容仅为八章固定合成文本（247 原文单位）及 P01/P06 受控图谱结果；本记录仅保留校验哈希，不嵌入备份载荷。

先前已创建的 run 39948664256 附件确曾包含该备份和 trace；不删除这些历史远端对象，也不倒称其从未上传。后续候选扫描 CI 仅按明确白名单上传 `report.json`、`desktop-reviewed-bridge.png`、`mobile-three-premise-review.png` 与可选 `failure.png`。完整导出与 trace 存在上传目录以外的运行器本地临时目录；这一临时 CI 目录**不等于长期备份保存**。trace 可能含种入的章节正文和完整图谱结果，因此也排除。保留的成功报告仅含有界受控 HTTP 证据／计数，不含备份对象；截图展示审阅 UI，而非完整导出。备份／恢复断言及全部 20 组／1,501 次扫描加三次 Writer 的门槛不变。

最终交付因此包含文档／证据及这一有限附件策略修正，不再宣称 harness／workflow 完全不变；新准确 head 仍须独立审阅及全部十一项 CI。

仅本地输出策略修订已通过构建（14,913.005 毫秒）、零警告 lint（9,487.954 毫秒）、全部 97 套 smoke（195,971.669 毫秒）、语法检查及两个预期在 P01 拒绝的变异控制。执行前后 383 项源码／配置／harness 哈希保持一致；[保留验证记录](local-backup-policy/validation.json)和[输出策略检查](local-backup-policy/policy-checks.json)与历史浏览器基线分开。没有运行本地浏览器；最终交付 head 仍须其自身十一项 CI。
